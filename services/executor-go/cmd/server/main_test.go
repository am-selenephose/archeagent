package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"archeagent/executor/internal/sandbox"
)

// Keep JSON decoding, validation, and Docker argv construction real; replace
// only the external Docker execution so handler tests launch no containers.
type argvRunner struct{}

func (argvRunner) Run(_ context.Context, spec sandbox.Spec) (sandbox.Result, error) {
	args, err := sandbox.Args(spec)
	return sandbox.Result{Stdout: strings.Join(args, "\n")}, err
}

func TestExecuteDefaultsReadOnlyRootFS(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/v1/execute", strings.NewReader(`{
		"image": "node:24-alpine",
		"command": ["true"],
		"work_dir": "/workspace/repo",
		"timeout_seconds": 1,
		"memory_megabytes": 64,
		"cpus": 1
	}`))
	response := httptest.NewRecorder()
	server{runner: argvRunner{}}.execute(response, request)
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
			request := httptest.NewRequest(http.MethodPost, "/v1/execute", strings.NewReader(`{
				"image": "node:24-alpine",
				"command": ["true"],
				"work_dir": "/workspace/repo",
				"timeout_seconds": 1,
				"memory_megabytes": 64,
				"cpus": 1,
				"read_only_rootfs": `+test.setting+`
			}`))
			response := httptest.NewRecorder()
			server{runner: argvRunner{}}.execute(response, request)
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
