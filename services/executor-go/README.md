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

The executor does not claim VM-grade isolation. Docker is the current boundary. The runner contract is intentionally replaceable by gVisor, Kata Containers, or Firecracker later.
