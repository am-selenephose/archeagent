package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"archeagent/executor/internal/sandbox"
)

const maxExecutionBodyBytes = 256 * 1024

type bodyRead struct {
	data []byte
	err  error
}

func readExecutionBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	controller := http.NewResponseController(w)
	deadline, _ := ctx.Deadline()
	_ = controller.SetReadDeadline(deadline)
	defer func() {
		_ = r.Body.Close()
		if ctx.Err() == nil {
			_ = controller.SetReadDeadline(time.Time{})
		}
	}()
	done := make(chan bodyRead, 1)
	go func() {
		data, err := io.ReadAll(io.LimitReader(r.Body, maxExecutionBodyBytes+1))
		done <- bodyRead{data: data, err: err}
	}()
	select {
	case <-ctx.Done():
		// net/http serializes Body.Read and Body.Close. Interrupt the underlying
		// transport before Close so cancellation cannot wait behind a read lock.
		_ = controller.SetReadDeadline(time.Now())
		_ = r.Body.Close()
		return nil, ctx.Err()
	case result := <-done:
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if len(result.data) > maxExecutionBodyBytes {
			return nil, errors.New("execution body limit exceeded")
		}
		return result.data, result.err
	}
}

type server struct {
	runner         sandbox.Runner
	policy         sandbox.ExecutionPolicy
	addr           string
	secretHash     [sha256.Size]byte
	authConfigured bool
}

func newServer(runner sandbox.Runner, addr, secret string, policy sandbox.ExecutionPolicy) (server, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return server{}, errors.New("executor requires a literal loopback listener")
	}
	ip := net.ParseIP(host)
	portNumber, portErr := strconv.Atoi(port)
	if ip == nil || !ip.IsLoopback() || portErr != nil || portNumber < 1 || portNumber > 65535 {
		return server{}, errors.New("executor requires a literal loopback listener")
	}
	if len(secret) < 32 || len(secret) > 4096 || strings.ContainsAny(secret, " \t\r\n") {
		return server{}, errors.New("invalid local execution authentication configuration")
	}
	return server{runner: runner, addr: addr, policy: policy, secretHash: sha256.Sum256([]byte(secret)), authConfigured: true}, nil
}

func (s server) health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok","service":"archeagent-executor"}`))
}

func (s server) execute(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !s.authConfigured {
		http.Error(w, "executor unavailable", http.StatusServiceUnavailable)
		return
	}
	if r.Host != s.addr || len(r.Header.Values("Authorization")) > 1 || len(r.Header.Values("Origin")) > 1 || len(r.Header.Values("Sec-Fetch-Site")) > 1 {
		http.Error(w, "local execution request denied", http.StatusForbidden)
		return
	}
	origin := r.Header.Get("Origin")
	site := r.Header.Get("Sec-Fetch-Site")
	if (origin != "" && origin != "http://"+s.addr) || (site != "" && (site != "same-origin" || origin != "http://"+s.addr)) {
		http.Error(w, "local execution request denied", http.StatusForbidden)
		return
	}
	authorization := r.Header.Get("Authorization")
	if len(authorization) < len("Bearer ")+32 || len(authorization) > len("Bearer ")+4096 || !strings.HasPrefix(authorization, "Bearer ") {
		http.Error(w, "local execution authentication required", http.StatusUnauthorized)
		return
	}
	digest := sha256.Sum256([]byte(strings.TrimPrefix(authorization, "Bearer ")))
	if subtle.ConstantTimeCompare(digest[:], s.secretHash[:]) != 1 {
		http.Error(w, "local execution authentication required", http.StatusUnauthorized)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if r.Context().Err() != nil {
		http.Error(w, "execution canceled", http.StatusRequestTimeout)
		return
	}

	body, err := readExecutionBody(w, r)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			http.Error(w, "execution request canceled", http.StatusRequestTimeout)
		} else {
			http.Error(w, "invalid execution spec", http.StatusBadRequest)
		}
		return
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()

	spec := sandbox.Spec{ReadOnlyRootFS: true}
	if err := decoder.Decode(&spec); err != nil {
		http.Error(w, "invalid execution spec", http.StatusBadRequest)
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		http.Error(w, "invalid execution spec", http.StatusBadRequest)
		return
	}

	if err := spec.Validate(); err != nil {
		http.Error(w, "invalid execution spec", http.StatusBadRequest)
		return
	}
	if err := s.policy.Validate(spec); err != nil {
		http.Error(w, "execution policy denied", http.StatusForbidden)
		return
	}

	result, err := s.runner.Run(r.Context(), spec)
	if errors.Is(err, context.Canceled) || r.Context().Err() != nil {
		http.Error(w, "execution canceled", http.StatusRequestTimeout)
		return
	}
	if len(result.Stdout) > sandbox.MaxOutputBytes {
		result.Stdout = result.Stdout[:sandbox.MaxOutputBytes]
		result.OutputTruncated = true
	}
	if len(result.Stderr) > sandbox.MaxOutputBytes {
		result.Stderr = result.Stderr[:sandbox.MaxOutputBytes]
		result.OutputTruncated = true
	}
	if err != nil && !result.TimedOut && !result.OutputTruncated {
		http.Error(w, "execution failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if result.TimedOut {
		w.WriteHeader(http.StatusRequestTimeout)
	} else if result.OutputTruncated {
		w.WriteHeader(http.StatusUnprocessableEntity)
	}
	_ = json.NewEncoder(w).Encode(result)
}

func main() {
	addr := os.Getenv("ARCHEAGENT_EXECUTOR_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8788"
	}

	policy := sandbox.ExecutionPolicy{}
	for name, setting := range map[string]*bool{
		"ARCHEAGENT_EXECUTOR_ALLOW_NETWORK":       &policy.AllowNetwork,
		"ARCHEAGENT_EXECUTOR_ALLOW_WRITABLE_ROOT": &policy.AllowWritableRootFS,
	} {
		value := os.Getenv(name)
		if value != "" && value != "true" && value != "false" {
			log.Fatal("invalid operator execution policy configuration")
		}
		*setting = value == "true"
	}
	s, err := newServer(sandbox.DockerRunner{Policy: policy}, addr, os.Getenv("ARCHEAGENT_EXECUTOR_TOKEN"), policy)
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.health)
	mux.HandleFunc("/v1/execute", s.execute)

	log.Printf("archeagent executor listening on %s", addr)
	httpServer := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 910 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	if err := httpServer.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
