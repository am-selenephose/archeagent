# Local execution ledger — 2026-10-12

## Latest durable adversarial continuation — four fixes verified

Parent review reproduced and repaired publisher lock-inode replacement,
restart/request racing, reopening after close and schema-prefix lookalike
acceptance. Final source checks: 25 focused / 545 full-suite host tests,
25 confinement probes, fresh-parent recovery, TypeScript/lint/build and Go
race/vet/modules, all exit 0. Earlier dirty work and publication hold preserved.
[Current evidence](DURABLE_ADVERSARIAL_REVIEW_2026_10_13.md).
External independent review remains unverified; no real source or model launched.

## Durable storage implementation — local gates passed, review held

Added native immutable HMAC-protected generation publication, an openat2/inode-
checked descriptor-bind launcher, serialized private multi-client worker IPC,
exact actor/UUID retry binding and new-worker recovery. Actual development
tests retrieved Concord task, conflict, ownership/handoff and private inbox
records after restart. Late store replacement and publication-target aliases
are covered by adversarial fixtures. The full verifier returned exit 0: 22
focused host tests / 4 files, 542 full-suite host tests / 44 files, 25 isolation
probes, separate-parent recovery, TypeScript/lint/build and Go race/vet/modules.
See [the exact execution receipt](DURABLE_EXECUTION_RECEIPT_2026_10_13.md).
External independent review and hardware power-loss testing remain unverified.
No real source, collector, model session, recorder or publication is enabled.
Product **FAIL/HOLD** remains in force; executed local gates do not grant release
authority or prove genuine agent collaboration.

## Historical approved SQLite repair update — 2026-10-13

The owner approved a repository-owned acquisition/isolation repair. Implemented
fixed bubblewrap worker with a private writable staging tmpfs, read-only host
mounts, kernel-state acquisition checks and unchanged Concord migrations/tools.
Current isolated probe: exact 25/25; focused host tests: 6/6 plus 29 required
nested adapter tests; full suite: 526 host tests/42 files. TypeScript, lint,
production build, Go race (28 top-level/82 cases), vet and module verification
all exit 0 after the final source edits. A separate read-only reviewer reran
the probe/focused tests and found no actionable outside-write defect in this
fixed-launcher scope. It is not the required Concord second model session.

**Storage boundary PASS_EPHEMERAL_PROCESS; operational architecture PARTIAL;
product remains FAIL/HOLD.** Durability, restart recovery and operational IPC
are missing. Real-source initializer, MCP launcher, receipt collection,
recorder/source integration and second-agent gate remain disabled.
Current evidence/commands/changed files:
[SQLite isolation repair receipt](SQLITE_ISOLATION_REPAIR_2026_10_13.md).

The entries below preserve the historical pre-repair audit. Their raw upstream
alias diagnostic still documents the failure of unconfined acquisition, not
the current isolated worker. Earlier architecture-approval requests have now
been satisfied; publication remains held and all work remains uncommitted.

## Historical implementation ledger

Plan: `docs/superpowers/plans/2026-10-12-archeagent-local-product-completion.md`
Approved source baseline: `25d14a9a5c47992e7e4d4198eb97a89c536de61a`.
Publication hold: active. Work resumed on 2026-10-13 after interrupted workers;
existing uncommitted changes were reviewed and preserved.

## Rulings

- Owner explicitly authorized implementation now; no additional specification/plan approval stop. Cost if wrong: local reversible changes only; publication stays held.
- Preserve the existing linked worktree; do not create another checkout or modify shared Git configuration. Runtime state must not follow git-common-dir.
- Skip skill telemetry and outside-repository configuration writes because the owner required local-only work.
- Use parallel independent implementation/testing where it improves quality; root reviews combined interfaces and a fresh reviewer audits the final changes. No current subagent is evidence of the required Concord two-Codex workflow.
- Dependency add's `--allow-build=better-sqlite3` replaced the existing project allowBuilds map. Restore the already-approved `esbuild:true` and existing `sharp:false`/`unrs-resolver:false` from HEAD, retaining only the scoped new SQLite permission. This restores existing policy rather than bypassing a new approval gate. Cost if wrong: dependency install fails closed; do not enable blanket scripts.
- Independent authority review reopened Task 1: CPU=0.001 serialized as zero/unset quota. Adapter was interrupted immediately. Root added failing ineffective-quota and precision regressions, then chose a documented local 0.01 CPU floor with unrounded decimal argv. Cost if wrong: unsupported tiny quotas fail closed rather than executing without a cap. Adapter resumes only after fresh GREEN.

## Progress

- Task 1: authority gate verified on 2026-10-13. Root ran `pnpm exec vitest run tests/release/release-lease.test.ts tests/evaluator.test.ts`: 131/131, exit 0. `go test -race -count=1 ./...` and `go vet ./...` in executor: exit 0, both packages pass. Logs: `.local-audit/20261013-r8HwXX/authority-{vitest,go}.log`. Lease reviewer additionally reproduced/fixed mutable-ID replay race (1 failed/91 passed RED, 92/92 GREEN). Full final-source suite remains pending.
- Task 1 independent review: Important CPU quota defect reproduced. Root regression RED: two top-level tests fail; GREEN after minimum/precision fix: uncached Go race suite (28 top-level tests), vet, module verification all exit 0. Logs: `cpu-quota-red.log`, `cpu-quota-green.log` under the same private evidence directory. Adapter interruption/hold was honored and can now be lifted. Actual Docker isolation/daemon cleanup remains explicitly unqualified.
- Task 2: **FAIL/HOLD**, not pending or ready. Genuine Concord/SDK adapter exists and 29 focused scripted protocol tests pass. Independent review reproduced a late database-alias write/migration before rejection. Export symlink/hardlink and cleanup defects were repaired. Native/pinned SQLite exposes no supported non-following acquisition option. Production initialization/runtime/private-store acquisition are now unconditionally held, with no environment/JSON escape hatch. No genuine model session launched.
- Task 3: dependency hold. Pure local-auth controller is implemented/tested (signed scoped cookie, server registry, expiry/revocation, host/origin and failure/session limits). It is **not wired to recorder HTTP endpoints**. Projection, API authentication-before-source-I/O and operational recorder UI remain unimplemented because Task 2 failed. No fake activity substituted.
- Task 4: dependency hold. Pure process capture, relevant-tree manifests, strict Ed25519 envelope signing/verification and redacted metadata helpers are tested; production collector/storage/key generation and source/task joins are deliberately disabled. Signed protocol fixtures are not real task execution receipts or model/session proof. Receipt/tree tests: 50/50; collector CLI reports HOLD, exit 2.
- Task 5: UI repairs implemented and exercised in the actual browser before the final dependency rebuild. Candidate selection, gate expansion, winner isolation, keyboard selection, fetch failure/retry, cross-tab theme synchronization/reload persistence, dark/light, desktop/mobile/tablet dimensions, anchors, normal-motion transform changes and reduced motion were observed. AXUNO actual platform glyph rendering was confirmed. Low-level screenshot calls timed out; supported browser screenshot calls succeeded. A final-build browser recheck failed when the browser connection disappeared/reconnection timed out; do not claim whole-product browser acceptance. Final local build HTTP checks return 200.
- Task 6: available independent gates run. After SDK repair: 41 files/549 Vitest tests pass on owned PostgreSQL/Redis URLs; lint, TS, production build, frozen install pass. Go race: 28 top-level tests/82 cases across two packages; vet/module verification pass. Formal wrapper exit 0, negative-control TLC exit 12 as expected; provider fixture and synthetic routing pass (not real-model performance). Full audit remains exit 1 with one high dev-only braces advisory; production audit exit 0/zero advisories. Genuine session prerequisite gate is not reached.

## 2026-10-13 incidents and final scope

- A new default-source hold regression was incorrectly run before installing its hold. Its RED invocation created empty production-named local schemas/identity. Read-only inspection confirmed zero tasks/agents/events. Exactly those three files and their two inspection-created WAL/SHM sidecars were moved into ignored `.local-audit/20261013-r8HwXX/quarantined-empty-init/`; this is recoverable, is not activity evidence, and is disclosed. Current `.concord` contains only an empty test-harness directory.
- The final underlying-acquisition diagnostic ran in a fresh explicitly scripted fixture after the SDK update: `sqlite-acquisition-negative.ts`, exit 1, `gate:FAIL`, target created outside state directory, 11 tables migrated before refusal. Its target is owned private audit evidence, not an unrelated repository/database. A prior first diagnostic attempt failed to compile due to top-level await; the final async-main diagnostic executed successfully and demonstrated the actual failing gate.
- SDK 1.30.0 was flagged by current audit; root pinned/deduplicated 1.31.0 for root and Concord's dependency. Original build permissions were preserved. Registry lookup and install rejected braces 3.0.4 (not published); its attempted override was removed, retaining the explicit unresolved development advisory rather than an uninstallable lockfile.
- Separate build output `.next-local-completion` avoids touching the user's running `.next` preview. ESLint/TS exclude this generated output/private diagnostics where appropriate without excluding application/test source. Final local preview: `127.0.0.1:34686`; user's `34684` service remains unchanged.
- No local implementation commit, push, merge, PR, deployment, email or font publication. All completed and incomplete changes are preserved for review. A new storage acquisition architecture needs owner direction before dependent work resumes.

Final evidence and exact reproduction: `docs/concord/LOCAL_PRODUCT_COMPLETION.md`.
