# Archeagent Local Product Completion Implementation Plan

## Execution status — 2026-10-13

Implementation proceeded locally. Authority/UI/input repairs and independent
checks are preserved. **STOP at Task 2 storage-isolation FAIL**: pinned SQLite
pathname acquisition can mutate a late alias target before rejection. Real
initialization/launch/collection are disabled; no model session/publication.
Available gates: 549/549 Vitest, lint/TS/build, Go race/vet and formal control
pass. Full dependency audit retains one development advisory. See
`docs/concord/LOCAL_PRODUCT_COMPLETION.md` for exact receipts, incidents, UI
evidence and unfinished dependent requirements; do not read the original task
list below as a completion claim.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an isolated, authenticated local Flight Recorder with independently captured execution receipts and a readable working UI, then stop at the real second-Codex-session gate.

**Architecture:** Reuse pinned Concord 0.13.0 handlers behind a fixed staging-root/actor adapter. Read its committed records through a separate read-only SQLite connection; keep sessions, invocations and signed execution receipts in a staging-private companion database. Preserve the evaluator and fixture route as explicitly reported-signal tools, never release authority.

**Tech Stack:** Node 24, Next 16.3.8/React 19, TypeScript, Zod, Ed25519, Concord 0.13.0/native SQLite, Go, Vitest, TLA+.

**Spec:** `docs/superpowers/specs/2026-10-12-archeagent-local-product-completion-design.md`

## Global Constraints

- Work only in `/home/nur/Projects/archeagent-final-staging`; no publication, push, merge, deploy, recruiter email or shared Git/config mutation.
- The only permitted state root is this staging checkout's `.concord/`.
- Concord agent launch depends on passing the fixed-root isolation gate.
- Access sessions expire after 15 minutes, with at most 64 active sessions.
- Evaluator/review-gate body limit: 262,144 actual bytes and 10-second deadline. Credential limit: 4,096 actual bytes and 5-second deadline.
- Timeline: at most 100 rows/page; overview: at most 256 tasks; projected/export response: at most 1 MiB.
- Release maximum declared lifetime: 15 minutes; receipt, access and release keys are separate.
- Browser actions are read-only coordination views, never execution/release commands.
- Preserve existing functional routes and material animation; exact private AXUNO remains unmodified/unpublished. Approved UI revision uses AXUNO display lettering and existing Jost for operational text.
- All tests use isolated owned PostgreSQL/Redis fixtures; never ambient production defaults.
- Synthetic protocol records and test fixtures are labeled as such, not genuine model sessions.
- Reserve task-specific completion acceptance for the actual builder/reviewer pair; until then completion is fail-closed.

## Review Focus

- Correctly signed malformed leases must fail before replay state consumption.
- A linked worktree must never redirect SQLite/export writes into its git-common-dir checkout.
- Authentication must deny before filesystem/database acquisition, including exports and task IDs.
- Interrupted/out-of-order cross-database records must remain incomplete rather than inferred completed.
- Missing/untracked source files, output truncation, command failure or mid-check tree changes must invalidate completion evidence.

## Task 1: Close authority defects

**Files:** `src/core/release/release-lease.ts`, `tests/release/release-lease.test.ts`, `src/lib/evaluator.ts`, `tests/evaluator.test.ts`, `services/executor-go/internal/sandbox/{spec.go,docker.go,spec_test.go}`, executor server/tests as required by its existing boundary.

**Interfaces:** Preserve `issueReleaseLease`, `verifyReleaseLease`, `consumeReleaseLease`, `evaluateCandidate`, `evaluateRun`, and Go `Spec.Validate`/`BuildDockerArgs` callers.

- [ ] RED: signed invalid/future/non-ISO/inverted/overlong lease and invalid context time are rejected without nonce consumption; contradictory/zero test counts never pass; leading-hyphen/invalid Docker references cannot reach argv construction.
- [ ] GREEN: validate envelope/claims/time before signature/context/replay; enforce 15-minute lifetime in issuer and verifier; derive test-gate pass from consistent positive counts; validate image grammar and require safe execution policy/authentication.
- [ ] Run focused Vitest and `go test -race -count=1 ./...`; review each diff independently. Record exact command/count/exit and negative results.

## Task 2: Fixed staging runtime and isolation proof

**Files:** `src/server/concord/local-paths.ts`, `local-runtime.ts`, `adapter.ts`, `private-store.ts`, `scripts/concord-local-mcp.ts`, `scripts/concord-local-init.ts`, package/lockfile, `tests/concord-local-adapter.test.ts`.

**Interfaces:** `resolveLocalPaths()` has a compiled fixed staging root and no caller-selected path; `openLocalRuntime(actorId, captureRunId)` returns bound genuine repositories/server with an owned close method; `getLocalIdentity()` returns source instance/capture metadata, not model proof. Companion store exposes allowlisted invocation/receipt metadata.

- [ ] Verify pinned upstream exports/native SQLite imports before starting a runtime.
- [ ] RED: linked worktree, foreign root/workspace/acting actor, symlink/WAL/SHM/export/special-file and incompatible local-ipc endpoint tests; capture invocation outcomes without message text.
- [ ] GREEN: reuse actual Concord workflow tools with a fixed selector and pull-only dispatcher; add own endpoint registration/inbox-drain helpers; validate writes and serialize exports with incomplete-on-export-failure labeling.
- [ ] Prove no historical/common-dir store mutation and no stock CLI invocation. If this gate fails, stop all dependent recorder/session work.

## Task 3: Authenticated read-only projection

**Files:** `src/server/concord/{auth.ts,projection.ts,http.ts}`, `src/server/http/bounded-json.ts`, `/api/concord/` session/overview/timeline/task/export routes, existing evaluator/review-gate routes and focused tests.

**Interfaces:** `authorizeLocalRequest(request)` validates host/cross-site/session before source I/O; `readProjection(query)` opens readonly/fileMustExist SQLite and returns a versioned allowlisted snapshot with source/run/revisions and `releaseAuthorized:false`; `readBoundedJson(request, bytes, deadlineMs)` enforces actual streamed bytes and body deadline.

- [ ] RED: denial before I/O, wrong/missing secret, host/origin mismatch, expiry/logout/rotation/replay, no-store, source-path/secret redaction, active WAL, foreign IDs/cursor, missing schema/source, bounded paging and partial acquisition.
- [ ] GREEN: bounded signed HttpOnly SameSite=Strict session registry; independent read transaction; task-specific genuine records and computed conflicts; no fixture fallback or upstream migrator in reader.
- [ ] Harden existing reported-signal routes without changing evaluator meaning; verify all old routes/tests remain working.

## Task 4: Independent execution receipts

**Files:** `src/server/concord/{tree-manifest.ts,execution-receipts.ts}`, `scripts/concord-capture-check.ts`, `scripts/concord-verify-receipt.ts`, focused receipt tests.

**Interfaces:** `captureTreeManifest()` returns paths/modes/content hashes and a versioned digest including allowed untracked/staged/unstaged source; `captureCheck({taskId,actorId,checkId})` maps an allowlisted check ID to direct argv; `verifyExecutionReceipt(envelope, expectedScope)` uses only the configured collector key and current source/task/tree.

- [ ] RED: wrong key, tamper, forged JSON success, cross-task/run/source, missing expected file, changed tree, failed/timed-out/truncated process, divergent duplicate and out-of-order companion/source acquisition.
- [ ] GREEN: capture process exit/output with bounded lifetime/output; sign canonical `archeagent.execution-receipt.v1` envelope; serialize idempotent byte-identical storage; retain original logs privately and expose metadata only.
- [ ] Independently rerun a real allowlisted check and compare its scope/tree/result; never turn a checksum into source authentication.

## Task 5: Functional UI and repair pass

**Files:** existing page/layout/theme/lifecycle files, `src/components/{evaluation-workspace,flight-recorder}.tsx`, `src/lib/` browser request/theme helpers, scoped component/request tests, design status docs.

**Interfaces:** Existing fixture loader/evaluator outputs remain reported/fixture data. Recorder consumes only authenticated versioned projections. Candidate selection changes inspection, never winner identity. Completion control remains absent/blocked pending real review.

- [ ] RED: request/body hang, abort/unmount, theme storage sync, winner/no-winner, candidate/gate inspection, semantic navigation/statuses, auth/empty/error/paused/stale/source-change cases.
- [ ] GREEN: console-first compact hierarchy, readable Jost operational text plus unchanged private AXUNO display font, separated statistics, responsive candidate inspector, subordinate fixture lifecycle detail, genuine recorder sign-in/out/filter/select/refresh/pause/export controls.
- [ ] Preserve full-bleed pearl/obsidian moving layers; add documented page-local Dark Reader lock. Fix anchors, narrow navigation, nested overflow, touch/focus/readability and announcements.
- [ ] Browser-test desktop/tablet/mobile both themes, all controls, retries/logout, actual AXUNO platform glyphs, changing normal-motion frames and reduced motion separately. Restore browser emulation after checks. Screenshots stay private.

## Task 6: Independent full verification and real-session handoff

**Files:** `docs/concord/LOCAL_PRODUCT_COMPLETION.md`, `docs/concord/TWO_CODEX_SESSION_GATE.md`, scoped completion-contract stub/tests, private execution ledger/receipts.

**Interfaces:** `assessCompletion(...)` remains blocked with a reason until the real builder/reviewer pair implements and reviews the task-specific accepted-review/signed-receipt join. It must never infer successful collaboration from protocol tests.

- [ ] Provision owned loopback disposable PostgreSQL/Redis; run full `pnpm verify`, TypeScript, Go race/vet, formal negative control, audit/walkthrough and independent adversarial review against final source.
- [ ] Record counts, versions, commands and exits including failures/limitations. Inspect private-state/font exclusion and tracked artifact safety.
- [ ] Verify launcher/help/per-invocation Codex override prerequisites without launching model sessions; document exact builder/reviewer commands, real overlap/message/accept/handback sequence and reserved implementation requirement.
- [ ] Stop for manual genuine second-session startup if necessary. Report PARTIAL until actual thread/tool-call/message/handoff/review/receipt linkage is observed. Do not push/merge/deploy/email.

## Execution ruling

The owner's explicit instruction to implement now and not stop at another specification supersedes the skill's additional plan-approval pause. Use this reviewed plan as the local execution checklist. Independent non-overlapping repairs may run concurrently; gate-dependent components do not start until their prerequisite is proven. Local task commits are allowed only after fresh checks and an explicit named-file staging review.
