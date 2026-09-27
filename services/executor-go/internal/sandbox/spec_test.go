package sandbox

import (
	"strings"
	"testing"
)

func baseSpec() Spec {
	return Spec{
		Image:           "node:24-alpine",
		Command:         []string{"npm", "test"},
		Environment:     map[string]string{"CI": "1"},
		WorkDir:         "/workspace/repo",
		TimeoutSeconds:  120,
		MemoryMegabytes: 1024,
		CPUs:            1.5,
		NetworkEnabled:  false,
		ReadOnlyRootFS:  true,
	}
}

func TestArgsFailClosedDefaults(t *testing.T) {
	args, err := Args(baseSpec())
	if err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(args, " ")
	for _, required := range []string{
		"--network=none",
		"--read-only",
		"--cap-drop=ALL",
		"--security-opt=no-new-privileges",
		"--pids-limit=256",
	} {
		if !strings.Contains(joined, required) {
			t.Fatalf("missing hardened arg %s", required)
		}
	}
}

func TestArgsAreDirectArgv(t *testing.T) {
	spec := baseSpec()
	spec.Command = []string{"printf", "%s", "hello; touch /tmp/x"}
	args, err := Args(spec)
	if err != nil {
		t.Fatal(err)
	}

	if args[0] != "run" {
		t.Fatal("docker invocation must be direct argv")
	}
	if args[len(args)-1] != "hello; touch /tmp/x" {
		t.Fatal("command argument was unexpectedly rewritten")
	}
}

func TestRejectsInvalidImage(t *testing.T) {
	spec := baseSpec()
	spec.Image = "node:24;curl-evil"
	if _, err := Args(spec); err == nil {
		t.Fatal("expected invalid image to be rejected")
	}
}
