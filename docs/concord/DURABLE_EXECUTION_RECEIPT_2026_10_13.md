# Durable Concord execution receipt — 2026-10-13

**Historical run; superseded by a subsequent adversarial continuation.**
This receipt accurately describes its 542-test execution. It did not cover
four later reproduced defects in publisher exclusion, restart/close and schema
restore. Those repairs and fresh 545-test gates are recorded in
[the current review receipt](DURABLE_ADVERSARIAL_REVIEW_2026_10_13.md).
Do not use this older PASS as independent qualification or real-source approval.

**Local executed gates: PASS. Qualification: PARTIAL. Product: FAIL/HOLD.**
The durable snapshot/recovery and private actor-bound IPC implementation was
executed successfully with owned disposable staging fixtures. This is not a
real-source, genuine-agent-collaboration, Flight Recorder or release claim.
Separate external security review and operational integration remain held.

Checkout: `/home/nur/Projects/archeagent-final-staging`.
Branch: `integration/archeagent-final-local`.
HEAD unchanged: `25d14a9a5c47992e7e4d4198eb97a89c536de61a`.
All changes remain local/uncommitted; publication hold is intact.

## Recorded execution

Command: `node scripts/verify-concord-durability.mjs`.
Recorded process exit: **0**, no signal/error.
Private evidence directory: `.local-audit/durable-verification-n1ASS4/`.
Machine receipt: `receipt.json`, status `PASS_LOCAL_EXECUTED_GATES`,
provenance `scripted_protocol_test`, product status `FAIL/HOLD`.
The receipt and adjacent logs were inspected after completion; zero exit alone
was not used to infer the results below. These are local execution receipts,
not authenticated model/session identity or external maintainer acceptance.

| Exact check | Actual outcome | Private log |
| --- | --- | --- |
| `node scripts/build-concord-persistence.mjs` | Both native programs compile; exit 0 | `native-build.log` |
| `node --import tsx scripts/concord-storage-verify.ts` | 25/25 confinement probes; exit 0; outside witness preserved | `isolation-25.log` |
| `pnpm exec vitest run tests/concord-durable-state.test.ts tests/concord-durable-ipc.test.ts tests/concord-sqlite-confinement.test.ts tests/concord-local-adapter.test.ts` | 22 host tests / 4 files passed; exit 0 | `focused.log` |
| `node --import tsx scripts/concord-durable-fixture.ts seed durable-store-xit653` | Real upstream workflow records checkpointed at generation 6; exit 0 | `fresh-parent-seed.log` |
| `node --import tsx scripts/concord-durable-fixture.ts recover durable-store-xit653` | New parent and worker recover equal metadata and correct ownership/handoff; exit 0 | `fresh-parent-recovery.log` |
| Explicit owned PostgreSQL/Redis URLs + `pnpm test` | 542 host tests / 44 files passed; exit 0 | `full-tests.log` |
| `pnpm exec tsc --noEmit --incremental false` | Exit 0 | `typescript.log` |
| `pnpm lint` | Exit 0 | `lint.log` |
| `ARCHEAGENT_LOCAL_BUILD=completion pnpm build` | Exit 0; existing routes retained | `production-build.log` |
| Executor `go test -race -count=1 -json ./...` | 28 top-level tests / 82 cases / 2 packages passed, zero failures; exit 0 | `go-race.log` |
| Executor `go vet ./...` | Exit 0 | `go-vet.log` |
| Executor `go mod verify` | Exit 0; all modules verified | `go-modules.log` |
| `git diff --check` | Exit 0 | `tracked-whitespace.log` |

The adapter host wrapper additionally requires the same **29 nested protocol
tests** to pass inside the confined worker. Those tests are not deleted/skipped;
do not silently combine host and nested counts into a single claimed total.
The new durable state suite contains 13 cases and the framing suite 3 cases.

Full-suite URLs were exclusively:

```text
ARCHEAGENT_TEST_DATABASE_URL=postgres://archeagent_test:archeagent_local_test_only@127.0.0.1:25469/archeagent_test
ARCHEAGENT_TEST_REDIS_URL=redis://127.0.0.1:26379/15
```

Scratch services were newly created with owner label
`codex.audit=archeagent-durability-016444bc`; cleanup verified that label before
stopping the exact returned container IDs. No matching containers remain. Their
temporary test data, fixture snapshot stores and synthetic metadata witnesses
were removed and can be recreated by the verifier. Existing production services
and the user preview were not stopped/reused.

## Recovery proof and adversarial coverage

Fresh-parent seed/recovery logs retain the same source/run identity and exact
metadata: **2 tasks, event ID 5, ownership-event ID 3, 1 handoff, 5 invocations,
5 retry records, task-version sum 5 and active WAL mode**. The recovered build
task is owned by `reviewer` and retains its two offer/accept ownership-history
entries and the actual handoff. The initial conflict was produced by two
upstream `start_work` calls claiming the same file; release/offer/accept were
actual upstream state transitions. All records are scripted fixtures, not
genuine Codex sessions or claimed code review.

The focused tests exercise repeated worker restart, addressed inbox privacy,
concurrent serialized clients, exact retry actor/payload binding, worker death
after capture, interrupted publisher stages before link/after link/after
directory fsync, corrupt/truncated/gapped generations, invalid signed manifest
and schema fixtures, recovery floors, publisher exclusion, late publication
aliases and directory substitution before descriptor acquisition. Framing
negative controls reject oversized/zero-length input and caller JSON success.

The original confinement probe again observed equal outside witness bytes,
SHA-256, inode, size and mtime with no outside target creation. SHA-256 is not
source authentication. HMAC protects the local publisher's own snapshots;
neither mechanism proves model/session identity or grants release authority.

## What remains unverified or unavailable

- No external independent review of the new native persistence/IPC layer.
- No actual hardware power-cut/storage-failure qualification; tested process
  interruption plus the implemented file/directory fsync protocol is narrower.
- No defense against a malicious host administrator/same-user owner changing
  trusted code, keys, the authorized directory inode or a coherently rolled-back
  entire store and external recovery floor.
- No encryption at rest, automatic generation compaction or retention expiry.
  The bounded store fails closed at its documented limits.
- No public/multi-user network service: operator-issued capabilities are
  multiplexed over private stdio only.
- No real source initialization, model launch, receipt collection or Flight
  Recorder integration; no genuine two-Codex-session collaboration.
- No new browser acceptance, formal-model run or dependency audit in this pass.

Therefore **do not lift any real-source or publication gate from this receipt**.

## Artifacts, reproduction and preservation

Implementation, fsync/acknowledgement semantics, field-level privacy inventory,
limits and commands: [Durable state and recovery](DURABLE_STATE_AND_RECOVERY.md).

Full reproduction:

```bash
cd /home/nur/Projects/archeagent-final-staging
node scripts/verify-concord-durability.mjs
```

It requires the documented native/runtime prerequisites, installed local test
images, and unused loopback ports 25469/26379. It creates its own fixtures and
does not fall back to production service URLs. The historical store suffix in
the recorded seed/recover commands is deleted; the verifier allocates a fresh
suffix for each reproduction.

Changed implementation files: two native sources; `durable-protocol.ts`,
`durable-supervisor.ts`, `framed-channel.ts` and the fixed `isolated-process.ts`
allowlist; four build/worker/fixture/verification scripts; two test files.
Documentation changes: `DURABLE_STATE_AND_RECOVERY.md`, this receipt,
`LOCAL_PRODUCT_COMPLETION.md` and `LOCAL_EXECUTION_LEDGER.md`.
The exact paths are listed in the implementation handoff and final response.

After verification, host `.concord` contains only an empty test-harness directory.
The private AXUNO font remains unchanged at SHA-256
`ca6332a0acc33002e6a9b61f15ab3b4e53940e6bec33bbee473464e7b916673d`.
User preview `127.0.0.1:34684` remains listening with its prior process.
The evaluator, visual shell, release controls and unrelated dirty work were
preserved. No commit/push/merge/PR/deploy/email/font publication occurred.
