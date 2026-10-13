# Enforced independent qualification attempt — 2026-10-13

**Product: FAIL/HOLD. G1: FAIL / not qualified.** No admission implementation,
operational integration, recorder, receipt collection or model-agent launch is
authorized by this receipt. The owner approved finite admission implementation
only after G1 passes. That prerequisite has not been satisfied.

## What actually changed

Created a private executable reviewer gateway and compatibility diagnostics in
`.local-audit/g1-enforced-20261013-WlR9Ue/`, plus the approved finite-admission
design. No application, native publisher, worker, supervisor, evaluator, UI,
font or release-control source was changed in this pass. All work remains local
and uncommitted. Ownership repair and the production build were not repeated.

The gateway runs supplied reviewer code with a read-only checkout mount. It
hides existing Git metadata, private audit records and old Concord stores; only
a new owned fixture subtree and private scratch/tmp are writable. It isolates
network, PID and user namespaces and drops capabilities. Its outer private
`/proc` must be writable for the production launcher to create nested namespaces;
the production SQLite worker's stricter read-only `/proc` and single writable
tmpfs boundary are unchanged.

The final author-authored enforcement probe exited **0** with five negative
controls: source-file append, source-directory file creation, source hardlink,
nested source append and host credential-path access all refused. A normal
nested executable control succeeded first; the forbidden append then failed
with actual `EROFS`, not a namespace setup failure. Seven selected source
hashes remained unchanged. This establishes the tested tool restriction, not
independent storage qualification. Separately, the author's compatibility
diagnostic used the actual native launcher and received a GET at generation 0;
that is not a successful Concord workflow or durable PUT test.

## Separate reviewer attempt — unsuccessful

Used the already running local `llama-server` at `127.0.0.1:11436`, model alias
`qwen2.5-14b-am` (Q4_K, 8192-token context), with fresh source-only review
contexts. The separate reviewer could produce code but had no unrestricted
host execution tool: all supplied code went through the fixed namespace.
This is not a Codex session, a Concord agent or external certification.

- Two native responses used invalid JSON transports and never executed.
- A third native response hit its output limit; it was incomplete and contained
  invalid imports, protocol handling and self-catching assertions. It was
  rejected without execution.
- The first IPC program failed its setup: initially the gateway's state mount
  mode, then the gateway's missing nested-namespace prerequisites prevented a
  control. Its code also omitted explicit initialization of the empty store.
- A new IPC program then failed with `ENOENT` on an invented nested `/store`
  file before any valid Concord control or adversarial case.
- A separate support peer inspected these artifacts and found additional
  vacuous/stale assertions. Its unrestricted tool profile disqualifies it as
  the G1 reviewer; its analysis is support evidence only.

**Qualified independently authored adversarial runtime passes: 0.** The five
author-authored enforcement controls and the project's existing regressions
must not be added to that count. All failed inputs, model responses and process
receipts are retained privately; none were repaired by the author and relabeled
as independently authored successful cases.

The initial nested probe also encountered setup failures. Those were not proof
of nested write rejection. The final probe explicitly requires both a successful
normal nested control and an `EROFS` denial. Compatibility repairs affected only
the private test gateway; no production acquisition boundary was relaxed.

## Fresh executed checks

From `/home/nur/Projects/archeagent-final-staging`, Node **24.19.0**, user `nur`:

```bash
PATH=/home/nur/.nvm/versions/node/v24.19.0/bin:/usr/local/bin:/usr/bin:/bin \
  /usr/bin/pnpm test tests/concord-durable-state.test.ts \
  tests/concord-durable-ipc.test.ts tests/concord-persistence-capacity.test.ts \
  tests/concord-persistence-errors.test.ts tests/concord-sqlite-confinement.test.ts \
  --maxWorkers 1
```

Exit **0**; **32/32 tests**, **5/5 files**, 43.23 seconds. These tests use owned
disposable fixtures and include existing 512-generation, 256 MiB and 10,000-row
capacity regressions. They characterize the existing hard stops; they do not
prove a new admission controller exists. No real model collaboration occurred.

```bash
PATH=/home/nur/.nvm/versions/node/v24.19.0/bin:/usr/local/bin:/usr/bin:/bin \
  /usr/bin/pnpm exec tsc --noEmit
PATH=/home/nur/.nvm/versions/node/v24.19.0/bin:/usr/local/bin:/usr/bin:/bin \
  /usr/bin/pnpm lint
/home/nur/.nvm/versions/node/v24.19.0/bin/node --check \
  .local-audit/g1-enforced-20261013-WlR9Ue/gateway.mjs
git diff --check
```

Each exited **0**. TypeScript/lint do not validate the correctness of the failed
reviewer programs in the ignored private audit directory.

The build-baseline observer compared all **239** retained baseline files by
size, mode and SHA-256: **0 differences**, exit **0**. The private AXUNO demo
remains ignored/untracked and matches its retained hash
`ca6332a0acc33002e6a9b61f15ab3b4e53940e6bec33bbee473464e7b916673d`.
No new product source change required a production rebuild. The previous build's
success is retained evidence, not a new build run. No fresh full PostgreSQL/Redis
suite, Go race suite, formal proof or browser audit was performed in this pass.

## Gate results and remaining work

| Gate | Result | Evidence / restriction |
| --- | --- | --- |
| Reviewer checkout write restriction | PASS, narrow | Final namespace enforcement probe plus successful nested control |
| G1 independent native/IPC qualification | FAIL / unqualified | No valid reviewer-authored adversarial runtime passes |
| Existing focused storage regressions | PASS | 32 tests / 5 files, exit 0 |
| Finite four-attempt admission | HOLD, not implemented | Owner's approved design waits on G1 |
| Checkpoint-free exact replay | HOLD | Existing recorded-result replay still requires a new checkpoint |
| Operational source / recorder / receipts | HOLD | Existing real-source entry points remain disabled |
| Second Codex session / collaboration | HOLD / unverified | No session launched; scripted tests do not count |

Next G1 work needs a competent separate reviewer to independently author and
run valid controls and negative cases through a technically restricted tool
boundary. Coverage remains required for acquisition/late aliasing, sidecars,
fsync/ACK interruption, corruption/recovery, actor privacy, lifecycle and finite
admission limits. Source/log inspection and a model-generated PASS are insufficient.

The gateway is a qualification harness, not a finished production security
product: host fixture storage has no aggregate quota and the reviewer has no
process/memory quota beyond execution/output and scratch bounds. Its per-run
hash check covers seven selected source files; it is not a frozen checkout or
a full dependency attestation. The final artifact manifest identifies exact
retained programs/policies/binaries but SHA-256 alone does not authenticate a
reviewer. Tool exit 0 never grants qualification (`qualificationGranted:false`).

Private artifacts: `.local-audit/g1-enforced-20261013-WlR9Ue/`, notably
`gateway.mjs`, `enforcement-probe-receipt.json`, the timestamped reviewer input,
output, program and receipt files, `storage-regressions.log`, `typecheck.log`,
`lint.log`, `build-baseline-comparison.json`, and `artifact-manifest.json`.

Only an author-authored enforcement/compatibility diagnostic can currently be
reproduced successfully:

```bash
/home/nur/.nvm/versions/node/v24.19.0/bin/node \
  .local-audit/g1-enforced-20261013-WlR9Ue/gateway.mjs probe
```

This creates a new owned disposable fixture. It does not claim G1, execute a
Concord operation or launch a model. Retain the failed reviewer artifacts rather
than overwriting them. No history was rolled over, no native limits were raised
and no acknowledged history was discarded. No GitHub action, deployment,
publication, font upload or recruiter email occurred.
