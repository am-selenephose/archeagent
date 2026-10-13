package main

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"archeagent/executor/internal/sandbox"
)

const validSpecJSON = `{"image":"node:24-alpine","command":["true"],"work_dir":"/workspace/repo","timeout_seconds":1,"memory_megabytes":64,"cpus":1}`
const testSecret = "executor-test-secret-32-bytes-long"
const testAddr = "127.0.0.1:8788"

func configuredServer(t *testing.T, runner sandbox.Runner) server {
	t.Helper()
	s, err := newServer(runner, testAddr, testSecret, sandbox.ExecutionPolicy{})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func localRequest(body string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "http://"+testAddr+"/v1/execute", strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+testSecret)
	return r
}

type observedBody struct{ read bool }

func (b *observedBody) Read([]byte) (int, error) { b.read = true; return 0, io.EOF }
func (*observedBody) Close() error               { return nil }

func TestExecuteFailsClosedWithoutLocalAuthenticationConfiguration(t *testing.T) {
	body := &observedBody{}
	request := httptest.NewRequest(http.MethodPost, "/v1/execute", nil)
	request.Body = body
	request.Header.Set("Authorization", "Bearer "+strings.Repeat("a", 32))
	response := httptest.NewRecorder()
	server{runner: argvRunner{}}.execute(response, request)
	if response.Code != http.StatusServiceUnavailable || body.read {
		t.Fatalf("unconfigured executor admitted private request: status=%d read_body=%t", response.Code, body.read)
	}
}

func TestServerRejectsPublicBindAndInvalidAuthenticationConfiguration(t *testing.T) {
	for _, addr := range []string{"0.0.0.0:8788", "[::]:8788", ":8788", "192.0.2.1:8788", "localhost:8788", "127.0.0.1:0", "127.0.0.1:65536", "127.0.0.1"} {
		t.Run(addr, func(t *testing.T) {
			if _, err := newServer(argvRunner{}, addr, testSecret, sandbox.ExecutionPolicy{}); err == nil {
				t.Fatalf("unsafe listener configuration %q accepted", addr)
			}
		})
	}
	for _, secret := range []string{"", "short", strings.Repeat("a", 4097), " " + testSecret, testSecret + "\n"} {
		if _, err := newServer(argvRunner{}, testAddr, secret, sandbox.ExecutionPolicy{}); err == nil {
			t.Fatal("invalid local execution secret accepted")
		}
	}
}

func TestExecuteDeniesWrongCredentialBeforeReadingBody(t *testing.T) {
	for _, credential := range []string{"", "Bearer wrong-secret", "Basic " + testSecret, "Bearer " + strings.Repeat("a", 4097)} {
		request := localRequest("")
		request.Header.Set("Authorization", credential)
		body := &observedBody{}
		request.Body = body
		response := httptest.NewRecorder()
		configuredServer(t, argvRunner{}).execute(response, request)
		if response.Code != http.StatusUnauthorized || body.read {
			t.Fatalf("wrong credential admitted: status=%d read_body=%t", response.Code, body.read)
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("private denial response was cacheable")
		}
	}
}

func TestExecuteRejectsForeignHostOriginAndCrossSiteRequests(t *testing.T) {
	for _, mutation := range []func(*http.Request){
		func(r *http.Request) { r.Host = "attacker.example:8788" },
		func(r *http.Request) { r.Header.Set("Origin", "https://attacker.example") },
		func(r *http.Request) { r.Header.Set("Origin", "http://"+testAddr+"/") },
		func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") },
		func(r *http.Request) { r.Header.Add("Authorization", "Bearer "+testSecret) },
	} {
		request := localRequest("")
		mutation(request)
		body := &observedBody{}
		request.Body = body
		response := httptest.NewRecorder()
		configuredServer(t, argvRunner{}).execute(response, request)
		if response.Code != http.StatusForbidden || body.read {
			t.Fatalf("foreign/ambiguous request admitted: status=%d read_body=%t", response.Code, body.read)
		}
	}
}

type oversizedResultRunner struct{}

func (oversizedResultRunner) Run(context.Context, sandbox.Spec) (sandbox.Result, error) {
	return sandbox.Result{Stdout: strings.Repeat("o", 65537), Stderr: strings.Repeat("e", 65537)}, nil
}

func TestExecuteBoundsRunnerOutputAndDoesNotReportTruncationAsSuccess(t *testing.T) {
	response := httptest.NewRecorder()
	configuredServer(t, oversizedResultRunner{}).execute(response, localRequest(validSpecJSON))
	if response.Code != http.StatusUnprocessableEntity || response.Body.Len() > 140000 {
		t.Fatalf("oversized output reported as successful or unbounded: status=%d bytes=%d", response.Code, response.Body.Len())
	}
	var result struct {
		Stdout    string `json:"stdout"`
		Stderr    string `json:"stderr"`
		Truncated bool   `json:"output_truncated"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Truncated || len(result.Stdout) != 65536 || len(result.Stderr) != 65536 {
		t.Fatalf("missing honest bounded truncation: stdout=%d stderr=%d truncated=%t", len(result.Stdout), len(result.Stderr), result.Truncated)
	}
}

func TestExecuteRejectsTrailingJSONAndOversizedWhitespace(t *testing.T) {
	for _, suffix := range []string{` {}`, ` null`, ` trailing`, strings.Repeat(" ", 256*1024)} {
		request := localRequest(validSpecJSON + suffix)
		response := httptest.NewRecorder()
		configuredServer(t, argvRunner{}).execute(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("incomplete/suffixed JSON reached execution: status=%d", response.Code)
		}
	}
}

type canceledContextRunner struct{}

func (canceledContextRunner) Run(ctx context.Context, _ sandbox.Spec) (sandbox.Result, error) {
	if ctx.Err() != nil {
		return sandbox.Result{}, ctx.Err()
	}
	return sandbox.Result{Stdout: "request context was not canceled"}, nil
}

func TestExecuteRespectsCanceledRequest(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request := localRequest(validSpecJSON).WithContext(ctx)
	response := httptest.NewRecorder()
	configuredServer(t, canceledContextRunner{}).execute(response, request)
	if response.Code != http.StatusRequestTimeout {
		t.Fatalf("canceled request reached successful execution: status=%d body=%q", response.Code, response.Body.String())
	}
}

type blockingBody struct {
	started   chan struct{}
	closed    chan struct{}
	readOnce  sync.Once
	closeOnce sync.Once
}

func (b *blockingBody) Read([]byte) (int, error) {
	b.readOnce.Do(func() { close(b.started) })
	<-b.closed
	return 0, context.Canceled
}

func (b *blockingBody) Close() error {
	b.closeOnce.Do(func() { close(b.closed) })
	return nil
}

func TestExecuteCancelsWhileReadingIncompleteBody(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	body := &blockingBody{started: make(chan struct{}), closed: make(chan struct{})}
	defer body.Close()
	request := localRequest("").WithContext(ctx)
	request.Body = body
	response := httptest.NewRecorder()
	done := make(chan struct{})
	s := configuredServer(t, argvRunner{})
	go func() { s.execute(response, request); close(done) }()
	<-body.started
	cancel()
	select {
	case <-done:
		if response.Code != http.StatusRequestTimeout {
			t.Fatalf("canceled body returned HTTP %d", response.Code)
		}
	case <-time.After(200 * time.Millisecond):
		_ = body.Close()
		<-done
		t.Fatal("request cancellation did not stop an incomplete body read")
	}
}

type readObservedConn struct {
	net.Conn
	started chan struct{}
	once    sync.Once
}

func (c *readObservedConn) Read(p []byte) (int, error) {
	c.once.Do(func() { close(c.started) })
	return c.Conn.Read(p)
}

type deadlineResponse struct {
	*httptest.ResponseRecorder
	conn net.Conn
}

func (w deadlineResponse) SetReadDeadline(deadline time.Time) error {
	return w.conn.SetReadDeadline(deadline)
}

func TestExecuteInterruptsLockedHTTPBodyReadOnCancellation(t *testing.T) {
	readerConn, writerConn := net.Pipe()
	defer readerConn.Close()
	defer writerConn.Close()
	observed := &readObservedConn{Conn: readerConn, started: make(chan struct{})}
	// Use net/http's actual request-body reader, which serializes Read and Close.
	// The pipe never opens a listener or starts an HTTP server.
	headers := "POST /v1/execute HTTP/1.1\r\nHost: " + testAddr + "\r\nAuthorization: Bearer " + testSecret + "\r\nContent-Length: 100\r\n\r\n"
	request, err := http.ReadRequest(bufio.NewReader(io.MultiReader(strings.NewReader(headers), observed)))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request = request.WithContext(ctx)
	response := deadlineResponse{ResponseRecorder: httptest.NewRecorder(), conn: readerConn}
	done := make(chan struct{})
	s := configuredServer(t, argvRunner{})
	go func() { s.execute(response, request); close(done) }()
	<-observed.started
	cancel()
	select {
	case <-done:
		if response.Code != http.StatusRequestTimeout {
			t.Fatalf("canceled HTTP body returned %d", response.Code)
		}
	case <-time.After(200 * time.Millisecond):
		_ = readerConn.Close()
		<-done
		t.Fatal("Body.Close blocked behind the active read after request cancellation")
	}
}

func TestExecuteRedactsValidationErrors(t *testing.T) {
	request := localRequest(strings.Replace(validSpecJSON, `"cpus":1`, `"cpus":1,"environment":{"secret-token-leak":"private"}`, 1))
	response := httptest.NewRecorder()
	configuredServer(t, argvRunner{}).execute(response, request)
	if response.Code != http.StatusBadRequest || strings.Contains(response.Body.String(), "secret-token-leak") || strings.Contains(response.Body.String(), "private") {
		t.Fatalf("validation error leaked request content: status=%d body=%q", response.Code, response.Body.String())
	}
}

// Keep JSON decoding, validation, and Docker argv construction real; replace
// only the external Docker execution so handler tests launch no containers.
type argvRunner struct{}

func (argvRunner) Run(_ context.Context, spec sandbox.Spec) (sandbox.Result, error) {
	args, err := sandbox.Args(spec)
	return sandbox.Result{Stdout: strings.Join(args, "\n")}, err
}

func TestExecuteDefaultsReadOnlyRootFS(t *testing.T) {
	request := localRequest(`{
		"image": "node:24-alpine",
		"command": ["true"],
		"work_dir": "/workspace/repo",
		"timeout_seconds": 1,
		"memory_megabytes": 64,
		"cpus": 1
	}`)
	response := httptest.NewRecorder()
	configuredServer(t, argvRunner{}).execute(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("execution returned HTTP %d: %s", response.Code, response.Body.String())
	}

	var result sandbox.Result
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		"--read-only",
		"--network=none",
		"--cap-drop=ALL",
		"--security-opt=no-new-privileges",
		"--pids-limit=256",
	} {
		if !strings.Contains("\n"+result.Stdout+"\n", "\n"+required+"\n") {
			t.Errorf("omitted settings did not preserve hardened Docker argument %q", required)
		}
	}
}

func TestExecutePreservesExplicitReadOnlyRootFS(t *testing.T) {
	for _, test := range []struct {
		name     string
		setting  string
		readOnly bool
	}{
		{name: "enabled", setting: "true", readOnly: true},
		{name: "disabled", setting: "false", readOnly: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := localRequest(`{
				"image": "node:24-alpine",
				"command": ["true"],
				"work_dir": "/workspace/repo",
				"timeout_seconds": 1,
				"memory_megabytes": 64,
				"cpus": 1,
				"read_only_rootfs": ` + test.setting + `
			}`)
			response := httptest.NewRecorder()
			configuredServer(t, argvRunner{}).execute(response, request)
			if !test.readOnly {
				if response.Code != http.StatusForbidden {
					t.Fatalf("unapproved writable root was not forbidden: HTTP %d", response.Code)
				}
				return
			}
			if response.Code != http.StatusOK {
				t.Fatalf("execution returned HTTP %d: %s", response.Code, response.Body.String())
			}

			var result sandbox.Result
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			readOnly := strings.Contains("\n"+result.Stdout+"\n", "\n--read-only\n")
			if readOnly != test.readOnly {
				t.Fatalf("explicit read_only_rootfs=%s produced read-only=%t", test.setting, readOnly)
			}
		})
	}
}
