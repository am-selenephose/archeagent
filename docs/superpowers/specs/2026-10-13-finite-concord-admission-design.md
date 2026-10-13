# Finite local Concord admission — implementation design

Status: direction and written design approved; implementation held until G1 passes.
G1 is not closed by the current reviewer runtime attempts.
This document is not a test receipt or permission to launch a model session.

## Binding constraints

- Work only in final-staging; preserve all existing uncommitted work.
- Keep the real-source initializer, Concord agent runner, recorder and collector
  disabled until independently qualified storage and admission gates pass.
- Preserve the current confined SQLite worker, native descriptor acquisition,
  immutable fsynced checkpoint chain, schema validation and actor privacy.
- Four total admitted domain attempts per newly initialized staging store. Reads,
  exact retries, tool-level refusals and ambiguous attempts consume the budget.
- No epoch rollover, higher caps, archive activation or deletion of history.
- No public release, GitHub mutation, deployment, font publication or email.

## G1 evidence boundary

A separate existing local model reviewer receives source, not an author's PASS
summary. Its only execution tool is a fixed namespace gateway: checkout and
native binaries read-only; old state, Git metadata and private audit artifacts
hidden; new owned fixtures and private scratch writable; no network or host
credentials; capability drop and separate PID/user namespaces. Nested namespaces
are allowed only because the tested production launcher itself requires them.
Negative probes must demonstrate that nesting cannot regain checkout write
access. An independent host observer checks source hashes after each run.

Fresh reviewer-authored adversarial code must actually run with positive controls
and concrete forbidden-effect assertions. Invalid test setup, model-generated
PASS text, an unrestricted subagent, and source/log inspection do not close G1.
This is local peer-model qualification, not external certification and not a
two-Codex-agent Concord workflow. Any uncovered required boundary stays HOLD.

## Durable budget without SQLite schema migration

Introduce a distinct strict staging envelope around the unchanged v1 worker
snapshot. The wrapper is owned by the supervisor, never supplied as authority by
a caller or worker. Persist the fixed policy identifier, attempt count 0..4,
actor policy, source/capture identity and charge/result phase. On new initialization
only, count starts at zero. Finite admission rejects legacy, malformed or absent
budgets; no adoption or reset of existing v1 histories. Keep the old diagnostic
API clearly separate and unavailable as an operational bypass.

Before each admitted domain request, retain the last acknowledged SQLite bundle,
publish it inside a wrapper with the incremented count, and wait for the native
durable ACK. Only then send the request to the worker. Publish the resulting
bundle with the same count before returning completion. Store-wide FIFO covers
all actors. The supervisor validates source identity and injects the budget;
worker output cannot change the policy or count. Recovery never automatically
executes a pending request. Charge ACK loss requires recovery, without refund.

## Native admission and capacity

Add one fixed admission-publication opcode, not caller-selectable paths, limits,
SQL or commands. Within the pinned directory's existing exclusive publisher:

```
generation + 2 <= 512
retained_bytes + 2 * (24 MiB + 84) <= 256 MiB
available_bytes >= 2 * (24 MiB + 84) + 64 MiB
retry_rows + 1 <= 10,000
attempts_used < 4
```

The byte headroom is 50,331,816 bytes; the free-space threshold is 117,440,680
bytes. Query filesystem availability through `fstatvfs` on the acquired directory
FD, with checked arithmetic and refusal on invalid/error results. Never rely on
a substituted parent pathname. Retry count comes from the fixed worker metadata
projection before charging; conservatively refuse even replay when row headroom
is unavailable. The ordinary publication remains fail-closed and bounded.

The 64 MiB availability check is not a physical reservation against unrelated
filesystem users. A concurrent space/inode loss can still cause failure. It must
produce no completion ACK, fence the worker and preserve the durable charge.
Do not promise successful execution after admission, only bounded authority and
durable acknowledgement of successfully published state.

## Acknowledgement and exact replay

Original completion means a result snapshot reached file fsync, no-overwrite
publication and directory fsync. It does not prove the caller received an ACK.
Same UUID + actor + parsed request digest returns the recorded exact result
before any Concord handler runs. It consumes a new admitted attempt and gets a
new result checkpoint; distinguish that acknowledgement from the original one.
Reordered argument keys are not automatically equivalent. SHA-256 identifies
content, not an authenticated model or external reviewer.

Checkpoint-free replay remains HOLD. Refuse when budget/headroom is unavailable;
do not execute again to manufacture an answer. Replays do not authenticate a
model session. In-memory counters, retry rows and invocation counts alone cannot
reconstruct the charged-attempt budget.

## Recovery scope and qualification

The existing HMAC chain is a local publisher integrity boundary. It does not
defeat an owner capable of replacing the authority key and whole store. A live
supervisor retains its inode and acknowledged generation floor. A fresh parent
must receive the previously retained independent floor/source identity; opening
an older complete authenticated prefix with the default floor is not proof of
anti-rollback. Do not claim hostile-owner rollback resistance.

Tests must cover charge before domain execution, fifth-call refusal with no
handler effect, exact replay without added invocation, lost charge/result ACKs,
FIFO concurrency, close/restart barriers, fresh-parent budget continuity,
legacy-budget rejection, generation/byte/retry/free-space denial, late aliases
and unchanged outside witnesses. Exercise production native publication and
confined workers, not capacity predicates alone. Existing actor/privacy and
confinement regressions remain required.

Only after G1 and admission runtime qualification may operational integration
gates be prepared. They remain unexecuted; no second Codex session is launched.
Any failed security gate stops dependent work. Final status remains FAIL/HOLD
until every required product gate has actual independently reproducible evidence.
