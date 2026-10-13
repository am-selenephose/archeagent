package sandbox

import (
	"context"
	"errors"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type Result struct {
	ExitCode        int    `json:"exit_code"`
	Stdout          string `json:"stdout"`
	Stderr          string `json:"stderr"`
	DurationMs      int64  `json:"duration_ms"`
	TimedOut        bool   `json:"timed_out"`
	OutputTruncated bool   `json:"output_truncated"`
}

const MaxOutputBytes = 64 * 1024

var ErrOutputLimitExceeded = errors.New("execution output limit exceeded")

// Keep draining process pipes after the limit without retaining more bytes.
// Returning the full write count prevents a chatty process from blocking on a
// full pipe while its execution timeout or request cancellation is pending.
type boundedOutput struct {
	strings.Builder
	truncated bool
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	written := len(p)
	remaining := MaxOutputBytes - b.Len()
	if len(p) > remaining {
		p = p[:remaining]
		b.truncated = true
	}
	_, _ = b.Builder.Write(p)
	return written, nil
}

type Runner interface {
	Run(context.Context, Spec) (Result, error)
}

type DockerRunner struct {
	Binary string
	Policy ExecutionPolicy
}

func (r DockerRunner) dockerBinary() string {
	if r.Binary == "" {
		return "docker"
	}
	return r.Binary
}

func Args(spec Spec) ([]string, error) {
	return ArgsWithPolicy(spec, ExecutionPolicy{})
}

func ArgsWithPolicy(spec Spec, policy ExecutionPolicy) ([]string, error) {
	if err := spec.Validate(); err != nil {
		return nil, err
	}
	if err := policy.Validate(spec); err != nil {
		return nil, err
	}

	args := []string{
		"run",
		"--rm",
		"--cap-drop=ALL",
		"--security-opt=no-new-privileges",
		"--pids-limit=256",
		"--memory=" + strconv.Itoa(spec.MemoryMegabytes) + "m",
		"--cpus=" + strconv.FormatFloat(spec.CPUs, 'f', -1, 64),
		"--workdir=" + spec.WorkDir,
	}

	if spec.ReadOnlyRootFS {
		args = append(args, "--read-only")
	}

	if spec.NetworkEnabled {
		args = append(args, "--network=bridge")
	} else {
		args = append(args, "--network=none")
	}

	for key, value := range spec.Environment {
		args = append(args, "--env", key+"="+value)
	}

	args = append(args, spec.Image)
	args = append(args, spec.Command...)
	return args, nil
}

func (r DockerRunner) Run(parent context.Context, spec Spec) (Result, error) {
	args, err := ArgsWithPolicy(spec, r.Policy)
	if err != nil {
		return Result{}, err
	}

	ctx, cancel := context.WithTimeout(parent, spec.Timeout())
	defer cancel()

	start := time.Now()
	cmd := exec.CommandContext(ctx, r.dockerBinary(), args...)
	cmd.WaitDelay = time.Second
	var stdout boundedOutput
	var stderr boundedOutput
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	duration := time.Since(start)

	result := Result{
		Stdout:          stdout.String(),
		Stderr:          stderr.String(),
		DurationMs:      duration.Milliseconds(),
		TimedOut:        errors.Is(ctx.Err(), context.DeadlineExceeded),
		OutputTruncated: stdout.truncated || stderr.truncated,
	}

	if cmd.ProcessState != nil {
		result.ExitCode = cmd.ProcessState.ExitCode()
	} else {
		result.ExitCode = -1
	}

	if result.TimedOut {
		return result, context.DeadlineExceeded
	}
	if ctx.Err() != nil {
		return result, ctx.Err()
	}
	if result.OutputTruncated {
		return result, ErrOutputLimitExceeded
	}

	var exitErr *exec.ExitError
	if err != nil && !errors.As(err, &exitErr) {
		return result, err
	}

	return result, nil
}
