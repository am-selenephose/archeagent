package sandbox

import (
	_ "crypto/sha256" // Register SHA-256 for Docker image digest validation.
	"errors"
	"fmt"
	"math"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/distribution/reference"
)

var envKeyPattern = regexp.MustCompile("^[A-Z_][A-Z0-9_]*$")

type Spec struct {
	Image           string            `json:"image"`
	Command         []string          `json:"command"`
	Environment     map[string]string `json:"environment"`
	WorkDir         string            `json:"work_dir"`
	TimeoutSeconds  int               `json:"timeout_seconds"`
	MemoryMegabytes int               `json:"memory_megabytes"`
	CPUs            float64           `json:"cpus"`
	NetworkEnabled  bool              `json:"network_enabled"`
	ReadOnlyRootFS  bool              `json:"read_only_rootfs"`
}

// ExecutionPolicy is operator configuration, never part of request JSON.
// Its zero value preserves network-off and a read-only container root.
type ExecutionPolicy struct {
	AllowNetwork        bool
	AllowWritableRootFS bool
}

func (p ExecutionPolicy) Validate(spec Spec) error {
	if spec.NetworkEnabled && !p.AllowNetwork {
		return errors.New("network execution requires operator policy")
	}
	if !spec.ReadOnlyRootFS && !p.AllowWritableRootFS {
		return errors.New("writable root requires operator policy")
	}
	return nil
}

func (s Spec) Validate() error {
	// Reject options explicitly before parsing and before any Docker argv exists.
	if strings.HasPrefix(s.Image, "-") {
		return errors.New("invalid container image")
	}
	if _, err := reference.ParseNormalizedNamed(s.Image); err != nil {
		return errors.New("invalid container image")
	}
	if len(s.Command) == 0 {
		return errors.New("command must not be empty")
	}
	if s.TimeoutSeconds < 1 || s.TimeoutSeconds > 900 {
		return errors.New("timeout must be between 1 and 900 seconds")
	}
	if s.MemoryMegabytes < 64 || s.MemoryMegabytes > 32768 {
		return errors.New("memory limit out of range")
	}
	// Local policy supports at least 1 ms of quota per default 100 ms CPU
	// period. Smaller values must not silently become an unset Docker limit.
	if math.IsNaN(s.CPUs) || math.IsInf(s.CPUs, 0) || s.CPUs < 0.01 || s.CPUs > 16 {
		return errors.New("cpu limit out of range")
	}
	if path.Clean(s.WorkDir) != s.WorkDir || (s.WorkDir != "/workspace" && !strings.HasPrefix(s.WorkDir, "/workspace/")) {
		return errors.New("work_dir must be a canonical path under /workspace")
	}
	for key := range s.Environment {
		if !envKeyPattern.MatchString(key) {
			return fmt.Errorf("invalid environment key %q", key)
		}
	}
	return nil
}

func (s Spec) Timeout() time.Duration {
	return time.Duration(s.TimeoutSeconds) * time.Second
}
