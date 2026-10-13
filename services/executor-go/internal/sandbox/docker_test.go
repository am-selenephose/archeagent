package sandbox

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

// The test executable acts as a controlled external process. No Docker binary,
// daemon, container or server is started by these subprocess boundary tests.
func TestMain(m *testing.M) {
	if len(os.Args) > 2 && os.Args[1] == "run" {
		switch os.Args[len(os.Args)-1] {
		case "executor-test-output-flood":
			_, _ = fmt.Fprint(os.Stdout, strings.Repeat("o", 131073))
			_, _ = fmt.Fprint(os.Stderr, strings.Repeat("e", 131073))
			os.Exit(0)
		case "executor-test-wait":
			time.Sleep(3 * time.Second)
			os.Exit(0)
		case "executor-test-exit":
			_, _ = fmt.Fprint(os.Stdout, "controlled stdout")
			_, _ = fmt.Fprint(os.Stderr, "controlled stderr")
			os.Exit(7)
		}
	}
	os.Exit(m.Run())
}

func helperRunner(t *testing.T) DockerRunner {
	t.Helper()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return DockerRunner{Binary: binary}
}

func TestDockerRunnerBoundsCapturedOutputAndMarksTruncation(t *testing.T) {
	spec := baseSpec()
	spec.Command = []string{"executor-test-output-flood"}
	result, err := helperRunner(t).Run(context.Background(), spec)
	if !errors.Is(err, ErrOutputLimitExceeded) || !result.OutputTruncated {
		t.Fatalf("truncated process reported successful: truncated=%t err=%v", result.OutputTruncated, err)
	}
	if len(result.Stdout) != 65536 || result.Stdout != strings.Repeat("o", 65536) || len(result.Stderr) != 65536 || result.Stderr != strings.Repeat("e", 65536) {
		t.Fatalf("process capture was not bounded: stdout=%d stderr=%d", len(result.Stdout), len(result.Stderr))
	}
}

func TestDockerRunnerReturnsParentCancellation(t *testing.T) {
	spec := baseSpec()
	spec.Command = []string{"executor-test-wait"}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	timer := time.AfterFunc(50*time.Millisecond, cancel)
	defer timer.Stop()
	start := time.Now()
	result, err := helperRunner(t).Run(ctx, spec)
	if !errors.Is(err, context.Canceled) || result.TimedOut || time.Since(start) > time.Second {
		t.Fatalf("parent cancellation lost: timed_out=%t err=%v elapsed=%s", result.TimedOut, err, time.Since(start))
	}
}

func TestDockerRunnerPreservesCapturedNonzeroExit(t *testing.T) {
	spec := baseSpec()
	spec.Command = []string{"executor-test-exit"}
	result, err := helperRunner(t).Run(context.Background(), spec)
	if err != nil || result.ExitCode != 7 || result.Stdout != "controlled stdout" || result.Stderr != "controlled stderr" || result.OutputTruncated || result.TimedOut {
		t.Fatalf("process result lost: %+v error=%v", result, err)
	}
}

func TestOperatorPolicyControlsRelaxationsIndependently(t *testing.T) {
	for _, test := range []struct {
		name     string
		policy   ExecutionPolicy
		network  bool
		readOnly bool
		allowed  bool
	}{
		{"network_only", ExecutionPolicy{AllowNetwork: true}, true, true, true},
		{"network_cannot_allow_writable", ExecutionPolicy{AllowNetwork: true}, true, false, false},
		{"writable_only", ExecutionPolicy{AllowWritableRootFS: true}, false, false, true},
		{"writable_cannot_allow_network", ExecutionPolicy{AllowWritableRootFS: true}, true, false, false},
		{"both", ExecutionPolicy{AllowNetwork: true, AllowWritableRootFS: true}, true, false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			spec := baseSpec()
			spec.NetworkEnabled, spec.ReadOnlyRootFS = test.network, test.readOnly
			args, err := ArgsWithPolicy(spec, test.policy)
			if !test.allowed {
				if err == nil || args != nil {
					t.Fatalf("operator policy granted an unconfigured relaxation: %q", args)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			joined := "\n" + strings.Join(args, "\n") + "\n"
			wantNetwork := "--network=none"
			if test.network {
				wantNetwork = "--network=bridge"
			}
			if !strings.Contains(joined, "\n"+wantNetwork+"\n") || strings.Contains(joined, "\n--read-only\n") != test.readOnly {
				t.Fatalf("configured policy did not preserve independent settings: %q", args)
			}
			for _, arg := range args[:len(args)-len(spec.Command)-1] {
				if strings.HasPrefix(arg, "--volume") || strings.HasPrefix(arg, "--mount") || arg == "-v" {
					t.Fatalf("host mount added to executor argv: %q", args)
				}
			}
		})
	}
}
