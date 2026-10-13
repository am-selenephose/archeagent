# Archeagent Go Executor

The executor is a small runtime boundary for untrusted engineering tasks.

It converts a validated execution specification into direct Docker argv and defaults to:

- network disabled;
- read-only container root filesystem;
- all Linux capabilities dropped;
- no-new-privileges;
- bounded PID count;
- CPU and memory quotas;
- hard execution timeout;
- loopback-only HTTP listener.

Image validation uses pinned `github.com/distribution/reference v0.6.0` before
constructing argv. Leading-hyphen images are always rejected; commands remain
arguments after the validated image. No host volume or mount option is emitted.
The working directory must be a canonical path under `/workspace`; resource
quotas must be valid and finite.
The local CPU policy permits 0.01–16 CPUs. Serialization retains the requested
decimal precision rather than rounding to two decimal places; a small limit
cannot become Docker's zero/unset quota or be rounded up to a larger limit.

Local HTTP execution requires a dedicated `ARCHEAGENT_EXECUTOR_TOKEN` supplied
in the server environment. It must contain 32–4,096 bytes without ASCII
whitespace; use a cryptographically generated secret and keep it separate from
recorder-access and release-signing credentials. There is no default token.
Requests send it in the `Authorization: Bearer ...` header. The server compares
fixed-size SHA-256 digests in constant time and retains only the configured
digest. Never place the token in a URL, public client environment, screenshot,
or source file.

`ARCHEAGENT_EXECUTOR_ADDR` defaults to `127.0.0.1:8788`. Startup rejects hostnames,
wildcard/public addresses and missing/invalid credentials before opening a
listener; use a literal loopback address and port 1–65,535. Execution requests
must use that exact Host. If Origin or browser fetch metadata is supplied, it
must describe the configured same-origin loopback endpoint. Local operator CLI
requests may omit those browser headers. There is no CORS enablement, and
private responses use `Cache-Control: no-store`.

The default operator policy rejects `network_enabled:true` and explicit
`read_only_rootfs:false`, returning HTTP 403. An operator may separately configure
`ARCHEAGENT_EXECUTOR_ALLOW_NETWORK=true` and/or
`ARCHEAGENT_EXECUTOR_ALLOW_WRITABLE_ROOT=true` in the server environment; only
the corresponding requested relaxation is enabled. Each setting accepts
exactly `true`, `false`, or an unset value (false). HTTP JSON cannot configure
this policy. Go callers use `ArgsWithPolicy` or `DockerRunner.Policy`; ordinary
`Args` always uses the restrictive policy. Recorder access never grants an
execution-policy override.

Execution JSON is limited to 262,144 actual bytes with a 10-second body deadline,
must contain one complete object without unknown fields or trailing JSON/data,
and defaults an omitted `read_only_rootfs` to true. Validation responses omit
request content. Request cancellation propagates to the body reader and child
process. The server also bounds header reads and idle connections.

The subprocess collector retains at most 65,536 bytes each of stdout and
stderr, drains subsequent bytes without retaining them, and reports
`output_truncated:true` plus `ErrOutputLimitExceeded`. The HTTP boundary applies
the same caps even to another runner implementation; truncation returns HTTP
422 rather than successful execution. Execution timeout returns HTTP 408.
Callers must inspect `exit_code`, `timed_out`, and `output_truncated`; a captured
nonzero process exit is never a passed check. JSON escaping still keeps both
output streams below a 1 MiB response bound.

Verification: `go test -race -count=1 ./...` and `go vet ./...`. Tests construct
real validated argv and use only the Go test executable as a controlled
subprocess; they launch no Docker daemon/container or HTTP server. They establish
validation, policy, request and process-capture behavior, not real Docker
isolation, daemon/container cleanup after CLI cancellation, or hostile-host
security. Local HTTP authentication does not provide remote TLS security or
protect against another process controlling the same user account.

The executor does not claim VM-grade isolation. Docker is the current boundary.
The runner contract is intentionally replaceable by gVisor, Kata Containers,
or Firecracker later.
