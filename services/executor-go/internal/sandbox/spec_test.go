package sandbox

import (
	"math"
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

// If image validation accepts Docker options, a crafted command can keep the
// Docker option parser active and override isolation before the real image.
func TestRejectsImageOptionInjectionBeforeArgv(t *testing.T) {
	for _, command := range [][]string{
		{"--network=host", "node:24-alpine", "true"},
		{"--volume=/etc:/host", "node:24-alpine", "true"},
		{"--cap-add=ALL", "--security-opt=seccomp=unconfined", "node:24-alpine", "true"},
		{"--pid=host", "--ipc=host", "node:24-alpine", "true"},
	} {
		t.Run(command[0], func(t *testing.T) {
			spec := baseSpec()
			spec.Image = "--privileged"
			spec.Command = command
			if args, err := Args(spec); err == nil || args != nil {
				t.Fatalf("image option reached argv construction: args=%q err=%v", args, err)
			}
		})
	}
}

func TestRejectsMalformedDockerImageReferences(t *testing.T) {
	for _, image := range []string{
		"", "-", "-node", ".", "/", "node:", "node::tag", "registry.example/Upper/repo",
		"repo//child", "repo/", "https://registry.example/repo", "repo@sha256:abcd",
		"repo@sha256:" + strings.Repeat("z", 64), "repo:tag@invalid:" + strings.Repeat("a", 64),
		strings.Repeat("a", 256),
	} {
		t.Run(image, func(t *testing.T) {
			spec := baseSpec()
			spec.Image = image
			if args, err := Args(spec); err == nil || args != nil {
				t.Fatalf("malformed image %q reached argv: %q (error %v)", image, args, err)
			}
		})
	}
}

func TestAcceptsDockerImageNamesTagsAndDigests(t *testing.T) {
	for _, image := range []string{
		"node", "node:24-alpine", "registry.example:5000/team/repo:v1.2",
		"[::1]:5000/team/repo:TAG", "repo@sha256:" + strings.Repeat("a", 64),
		"repo:tag@sha256:" + strings.Repeat("b", 64),
	} {
		t.Run(image, func(t *testing.T) {
			spec := baseSpec()
			spec.Image = image
			args, err := Args(spec)
			if err != nil {
				t.Fatalf("valid image %q rejected: %v", image, err)
			}
			if args[len(args)-len(spec.Command)-1] != image {
				t.Fatalf("validated image was rewritten in argv: %q", args)
			}
		})
	}
}

func TestArgsRejectsRelaxationWithoutOperatorPolicy(t *testing.T) {
	for _, settings := range []struct {
		name     string
		network  bool
		readOnly bool
	}{
		{"network", true, true},
		{"writable_root", false, false},
		{"both", true, false},
	} {
		t.Run(settings.name, func(t *testing.T) {
			spec := baseSpec()
			spec.NetworkEnabled = settings.network
			spec.ReadOnlyRootFS = settings.readOnly
			if args, err := Args(spec); err == nil || args != nil {
				t.Fatalf("unapproved execution relaxation reached argv: %q (%v)", args, err)
			}
		})
	}
}

func TestRejectsNonFiniteCPUQuota(t *testing.T) {
	for _, cpus := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		spec := baseSpec()
		spec.CPUs = cpus
		if _, err := Args(spec); err == nil {
			t.Fatalf("nonfinite CPU quota reached Docker argv: %v", cpus)
		}
	}
}

func TestRejectsCPUQuotaBelowEffectiveLocalMinimum(t *testing.T) {
	for _, cpus := range []float64{0.001, 0.0049, 0.009999, 0.0000000001} {
		spec := baseSpec()
		spec.CPUs = cpus
		if args, err := Args(spec); err == nil || args != nil {
			t.Fatalf("ineffective CPU quota reached Docker argv: cpus=%v args=%q error=%v", cpus, args, err)
		}
	}
}

func TestCPUQuotaSerializationPreservesRequestedLimit(t *testing.T) {
	for _, sample := range []struct {
		cpus float64
		want string
	}{
		{0.01, "--cpus=0.01"},
		{0.0149, "--cpus=0.0149"},
		{1.5555, "--cpus=1.5555"},
		{16, "--cpus=16"},
	} {
		spec := baseSpec()
		spec.CPUs = sample.cpus
		args, err := Args(spec)
		if err != nil {
			t.Fatalf("supported CPU quota rejected: %v", err)
		}
		found := ""
		for _, arg := range args {
			if strings.HasPrefix(arg, "--cpus=") {
				found = arg
			}
		}
		if found != sample.want {
			t.Fatalf("CPU quota was rounded or lost: got %q want %q", found, sample.want)
		}
	}
}

func TestRejectsWorkDirsOutsideCanonicalWorkspace(t *testing.T) {
	for _, workDir := range []string{
		"",
		"workspace/repo",
		"/workspaceevil",
		"/workspace/../etc",
		"/workspace/repo/../../etc",
		"/workspace/./repo",
		"/workspace/repo/../other",
		"/workspace//repo",
	} {
		t.Run(workDir, func(t *testing.T) {
			spec := baseSpec()
			spec.WorkDir = workDir
			if _, err := Args(spec); err == nil {
				t.Fatalf("expected noncanonical or outside work_dir %q to be rejected", workDir)
			}
		})
	}
}

func TestAcceptsCanonicalWorkspaceAndDescendants(t *testing.T) {
	for _, workDir := range []string{"/workspace", "/workspace/repo", "/workspace/repo/nested"} {
		t.Run(workDir, func(t *testing.T) {
			spec := baseSpec()
			spec.WorkDir = workDir
			args, err := Args(spec)
			if err != nil {
				t.Fatalf("expected canonical work_dir %q to be accepted: %v", workDir, err)
			}
			for _, arg := range args {
				if arg == "--workdir="+workDir {
					return
				}
			}
			t.Fatalf("Docker argv omitted accepted work_dir %q", workDir)
		})
	}
}
