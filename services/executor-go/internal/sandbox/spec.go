package sandbox

import (
	"errors"
	"fmt"
	"path"
	"regexp"
	"strings"
	"time"
)

var imagePattern = regexp.MustCompile("^[a-zA-Z0-9._/:@-]+$")
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

func (s Spec) Validate() error {
	if !imagePattern.MatchString(s.Image) {
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
	if s.CPUs <= 0 || s.CPUs > 16 {
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
