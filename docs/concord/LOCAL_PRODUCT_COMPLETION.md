# Archeagent local product completion — verified stop receipt

## Latest independent qualification continuation — still FAIL/HOLD

Separate read-only review contexts produced new failures, not just suite reruns.
Four local repairs were made with RED/GREEN regressions; 554 full-suite tests,
TypeScript and lint passed. Scoped IPC review completed; native review has
executed retest evidence but its final response was blocked. The final build
failed on a root-owned output directory, which was not bypassed. Operational
source/recorder/collector/second-session/publication holds remain intact.
See [the latest exact receipt](INDEPENDENT_QUALIFICATION_RECEIPT_2026_10_13.md)
and [finite limits / proposed retention](PERSISTENCE_LIMITS_AND_RETENTION_2026_10_13.md).

## Latest durable adversarial continuation — holds intact

Four defects were reproduced and repaired: replaceable publisher exclusion,
restart/request racing, restart after terminal close and schema-prefix
lookalike acceptance. Fresh gates passed: 25 focused / 545 full-suite host
tests, 25 confinement probes, new-parent recovery, TypeScript/lint/build/Go.
See [the current review receipt](DURABLE_ADVERSARIAL_REVIEW_2026_10_13.md).
This is parent self-review, not external independent approval. Real source,
model launch, collector, recorder and publication remain held; **FAIL/HOLD**.

## Durable milestone extension — local gates passed, review held

The next approved milestone now has a native immutable snapshot publisher,
descriptor-acquired persistence mount, serialized actor-bound worker IPC,
retry ledger and restart recovery implementation. See
[Durable state and recovery](DURABLE_STATE_AND_RECOVERY.md) for the implemented
flow, exact acknowledgement semantics, privacy inventory and limitations.
The full verifier completed with 22 focused / 542 full-suite host tests,
25 confinement probes and separate-parent recovery; TypeScript/lint/build/Go
checks returned exit 0. See the
[exact execution receipt](DURABLE_EXECUTION_RECEIPT_2026_10_13.md).
External independent review and operational qualification remain unverified.
Do not treat local execution PASS as complete product qualification.
Real sources, model launch, collection, recorder integration and publication
remain held; product status remains **FAIL/HOLD**.

## Historical storage-only repair update — 2026-10-13

The subsequent approved repair establishes and tests a fixed-launcher
**ephemeral** filesystem-confined SQLite boundary. See
[the current implementation and proof receipt](SQLITE_ISOLATION_REPAIR_2026_10_13.md).
The current result is scoped storage PASS, operational architecture PARTIAL,
**overall product FAIL/HOLD**. Durable storage/restart recovery and operational
source integration remain missing; all real-source/agent/collector/recorder
gates stay disabled. No publication is authorized.

The remainder of this document is the **historical pre-repair stop receipt**.
Its late-alias failure, prior test counts, browser observations and dependency
audit findings are preserved evidence, not claims about the current confined
worker. The request for storage-architecture approval below was subsequently
approved by the owner; no new approval is needed merely to implement that scope.

## Historical pre-repair receipt

Date: 2026-10-13, Asia/Karachi. **Overall: FAIL at the required storage-isolation gate.**
This is an implementation/test handoff, not another specification and not a
finished-product, collaboration or release claim.

Checkout: `/home/nur/Projects/archeagent-final-staging`.
Branch: `integration/archeagent-final-local`.
Baseline/current HEAD: `25d14a9a5c47992e7e4d4198eb97a89c536de61a`.
Changes remain uncommitted; publication hold remains active.

## What is actually implemented

- App-first fixture workbench: ranked selectable candidates, gate details,
  explicit winner independent of selected inspector, rejection reasons,
  operational typography, responsive navigation/cards/statistics and sticky
  anchor clearance. The evaluator and lifecycle illustration remain explicitly
  caller-reported fixtures, not live Concord/model activity or release authority.
- AXUNO display/Jost operational/Geist Mono numeric typography, existing
  pearl/obsidian holographic shell and continuous normal-motion background.
  Keyboard/status accessibility, abortable bounded requests, failure/retry,
  cross-tab theme synchronization and page-local Dark Reader compatibility.
- Lease verifier rejects malformed/invalid/future/inverted/expired/overlong
  authorizations before replay consumption and snapshots mutable claims.
  Existing exact-state/key/replay bindings remain required.
- Executor image-reference validation, network-off/read-only defaults,
  separate operator policy, canonical workspace boundary, literal loopback
  authenticated HTTP boundary, real body/output limits, cancellation and CPU
  minimum/full-precision serialization. Real Docker isolation/daemon cleanup
  qualification is not established by argv/helper-process tests.
- Actual upstream Concord workflow/resource handlers composed with a fixed
  staging root, operator-bound actors, peer-inbox privacy, pull-only endpoint
  registration/drain, serialized writes and allowlisted invocation records.
  These handlers have been exercised only through scripted SDK connections
  in isolated test-harness sources. **Real-source initialization and launch
  are disabled while the independent isolation gate fails.**
- Pure local-access authentication controller, byte/deadline JSON helper,
  bounded/redacted evaluator and legacy Concord review-gate HTTP routes.
  The authentication controller is not yet attached to new recorder endpoints.
- Pure real process-capture primitive, relevant-tree manifest, strict signed
  Ed25519 envelope verifier and redacted receipt metadata helpers. Their tests
  distinguish executed helper commands from signed protocol fixtures. Actual
  source-bound collection/storage/keys/task/review joins remain disabled.

## Decisive failed gate

The independent reviewer inserted a late `concord.sqlite` symlink after
preflight validation but before upstream SQLite acquisition. SQLite created
and migrated an owned audit target outside the state directory before the
runtime rejected the source. This was repeated against the final dependency
graph in a fresh, quarantined scripted fixture:

```json
{"gate":"FAIL","kind":"scripted_protocol_test","lateDatabaseAliasInjected":true,"runtimeRejected":true,"targetCreatedOutsideStateDir":true,"targetTablesAfterRefusal":11}
```

Fresh command (exit **1**):

```bash
node --import tsx .local-audit/20261013-r8HwXX/sqlite-acquisition-negative.ts
```

That diagnostic requires its owned target to be absent; it refuses a repeat
that would overwrite it. To reproduce independently, use a fresh owned target
under `.local-audit` and an explicitly scripted `.concord/test-harness` source,
never a real source or outside repository.

Evidence:

- `.local-audit/20261013-r8HwXX/sqlite-acquisition-negative.jsonl`
- `.local-audit/20261013-r8HwXX/sqlite-acquisition-negative.ts`
- `.local-audit/adapter-review.Ol6qWJ/db-alias-diagnostic.ts`
- `node_modules/better-sqlite3/src/objects/database.cpp`: its open flags expose
  only readonly/readwrite/create, not `SQLITE_OPEN_NOFOLLOW`.
- `node_modules/better-sqlite3/lib/database.js` and published Options types:
  no acquired-descriptor/non-following option.
- `node_modules/@concord-ai/concord-mcp/dist/db/connection.js`: pathname open
  followed by WAL configuration and migration.

Readonly/fileMustExist and checking afterward do not prevent that earlier
mutation. No unverified `/proc/self/fd`, installed-tooling patch, memory-copy
store or lowered safety requirement was substituted.

The separate export-alias and shutdown descriptor-leak findings were repaired:
upstream renderers emit through descriptor-validated non-following private
writes; transport/unsafe-state errors no longer skip owned database closure.
The default production initializer/runtime/companion-store now throw
`Local SQLite isolation gate is held` before database acquisition. Tests pass
for this containment, but containment is **not a repair of the underlying
acquisition API**. Quarantined protocol tests intentionally still expose it.

## Exact check receipts

All paths below are relative to the staging checkout. Full integration tests
used only the root-owned loopback PostgreSQL/Redis scratch services, never the
existing production services. Do not run bare `pnpm test` with default URLs:
these integration fixtures issue TRUNCATE/FLUSHDB.

| Command | Actual outcome | Private receipt |
| --- | --- | --- |
| Explicit isolated URLs + `pnpm test` (command below) | 41 files, 549 tests passed; exit 0 | `full-vitest-after-dependencies.log` |
| `pnpm lint` | Exit 0 | `lint-after-dependencies.log` |
| `pnpm exec tsc --noEmit --incremental false` | Exit 0 | `typecheck-after-dependencies.log` |
| `ARCHEAGENT_LOCAL_BUILD=completion pnpm build` | Production build exit 0; existing routes preserved | `build-final.log` |
| `pnpm install --frozen-lockfile` | Exit 0 | `frozen-install-after-dependencies.log` |
| Executor `go test -race -count=1 -json ./...` | 28 top-level tests, 82 cases, 2 packages passed; exit 0 | `go-race-final.jsonl` |
| Executor `go vet ./...` / `go mod verify` | Both exit 0 | Root tool receipts; modules verified |
| `pnpm verify:formal` | Wrapper exit 0; 19,554 distinct states / 92,577 generated; safe model passed; unsafe TLC control exit 12 as expected | `formal-final.log` |
| `pnpm benchmark:provider:validate` | Exit 0, provider-fixture harness only | `provider-final.log` |
| `pnpm benchmark:routing` | Exit 0, deterministic synthetic mechanics only | `routing-final.log` |
| `pnpm audit --prod --json` | Exit 0, zero reported advisories | `dependency-audit-production.json` |
| `pnpm audit --json` | **Exit 1**, one high dev-only braces advisory remains | `dependency-audit-repaired.json` |
| Underlying late SQLite-alias diagnostic | **Exit 1, isolation FAIL** | `sqlite-acquisition-negative.jsonl` |
| `pnpm exec vitest run tests/concord-local-adapter.test.ts` | 29/29 scripted/containment tests pass; no model collaboration claim | Included in full suite |
| Receipt/tree focused suites | 50/50 pass; fixture signatures/process primitives, not completed collector | Included in full suite |
| `git diff --check` after documentation edits | Exit 0 | Final root command receipt |

Logs live in `.local-audit/20261013-r8HwXX/` and are ignored. No caller JSON
can set the trusted verifier key or upgrade a reported review into authenticated
source/release authority. SHA-256 is content integrity only. Ed25519 helpers
authenticate only their configured local signing authority, not a model, mutable
history or an adversary controlling the same OS user.

Node `v24.19.0`; pnpm `11.20.0`; Go `go1.27.0-X:nodwarf5 linux/amd64`.
Concord `0.13.0`; root/Concord SDK deduplicated at `1.31.0`; SQLite binding
`13.0.2`. The SDK update removes the registry's SDK advisory. Its maintainer
notes stdio clients/MCP servers are not affected by the HTTP OAuth-client issue:
[SDK advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h).
The braces audit identifies `<=3.0.3` and says patched `>=3.0.4`, but npm
metadata/install returned no published 3.0.4. The invalid override was removed.
Do not describe dependency auditing as globally clean. The install also warns
about existing deprecated ESLint 9 support.

## Reproduce available local checks

Create **new, owned** scratch services on unused ports, not production data:

```bash
cd /home/nur/Projects/archeagent-final-staging
pnpm install --frozen-lockfile

docker run -d --rm --name archeagent-final-test-pg \
  --label codex.audit=archeagent-final-tests \
  --tmpfs /var/lib/postgresql/data \
  -p 127.0.0.1:25449:5432 \
  -e POSTGRES_USER=archeagent_test \
  -e POSTGRES_PASSWORD=archeagent_local_test_only \
  -e POSTGRES_DB=archeagent_test postgres:16-alpine
docker run -d --rm --name archeagent-final-test-redis \
  --label codex.audit=archeagent-final-tests \
  --tmpfs /data -p 127.0.0.1:26399:6379 redis:7-alpine

# Wait for these explicit owned services to report readiness before the suite.
docker exec archeagent-final-test-pg pg_isready -U archeagent_test -d archeagent_test
docker exec archeagent-final-test-redis redis-cli ping
ARCHEAGENT_TEST_DATABASE_URL=postgres://archeagent_test:archeagent_local_test_only@127.0.0.1:25449/archeagent_test \
ARCHEAGENT_TEST_REDIS_URL=redis://127.0.0.1:26399/15 pnpm test

pnpm lint
pnpm exec tsc --noEmit --incremental false
ARCHEAGENT_LOCAL_BUILD=completion pnpm build
(cd services/executor-go && go test -race -count=1 ./... && go vet ./... && go mod verify)
pnpm verify:formal
pnpm benchmark:provider:validate
pnpm benchmark:routing

# Stop only the two scratch containers you just created after inspecting their labels.
docker stop archeagent-final-test-pg archeagent-final-test-redis
```

The fixed build selector accepts only unset/default or `completion`, not caller
paths. `.next-local-completion` does not overwrite the user's `.next` preview.
Local UI command, after checking that 34686 is unused:

```bash
ARCHEAGENT_LOCAL_BUILD=completion pnpm exec next start --hostname 127.0.0.1 --port 34686
```

Route: `http://127.0.0.1:34686/`, fixture controls at `/#console`.
The final home and fixture-data endpoints returned HTTP 200. This route is the
improved **fixture workbench**, not a functioning Flight Recorder.

## Browser evidence and exact limits

Observed on the implemented UI build before final SDK/build-tool-only changes:

- Desktop 1440×1000, mobile 390×844, tablet 820×1180; no horizontal overflow.
- Sticky header/anchor examples: desktop nav 76 / section 120px; mobile nav
  165 / section 204px; tablet nav 121 / formal section 164px.
- FastFix selection and Enter keyboard activation leave VerifiedPatch as winner.
  Its failed regression gate expands to actual reported 42 tests/2 failures.
- SmartPatch inspection shows NEEDS_WORK; gate/summary evidence is fixture-labeled.
- Blocking the actual intelligence endpoint produces unavailable/retry UI;
  unblocking and Retry restores three fixture candidates.
- Both theme colors, cross-tab storage synchronization and reload persistence.
  Mobile pearl body `rgb(249,247,252)`, obsidian `rgb(8,10,22)` after transition.
- Chrome platform font proof: Axuno Demo 15 heading glyphs plus Jost 2 fallback
  punctuation glyphs. Font binary unchanged at SHA-256
  `ca6332a0acc33002e6a9b61f15ab3b4e53940e6bec33bbee473464e7b916673d`.
- Normal-motion ribbon transforms changed between observations and while
  scrolling; reduced-motion animationName was `none`. This is not zero-lag,
  FPS, compositor-only or cross-browser/device-performance qualification.
- No injected Dark Reader styles in the inspected desktop rendering context.
  No captured console errors before final rebuild; viewport/media/network
  overrides restored and appearance returned to dark.

Private screenshots in the evidence directory: `ui-desktop-dark.png`,
`ui-desktop-dark-workbench.png`, `ui-desktop-light-reduced.png`,
`ui-desktop-light-normal.png`, `ui-mobile-light-reduced.png`,
`ui-mobile-dark-reduced.png`. Names marked reduced refer to reduced-motion
captures; captures can show scrolled sections rather than the page top.
Some low-level CDP captures timed out; normal screenshot API captures succeeded.
After final rebuild the old browser connection disappeared and reconnection
timed out. **No final-build browser rerun, all-controls/route matrix, recorder
controls, all-device screenshot matrix or browser video is claimed.**

## Genuine two-session result and remaining requirements

**Not verified; no genuine model sessions launched.** Actual collision,
versioned release, addressed offer/accept and inbox delivery were exercised by
scripted SDK connections only. No fabricated thread links, handoffs, prompts,
live events, code-review corrections or successful execution receipts were
added to a real source. Real source-bound projection, source/task/receipt joins,
immutable receipt storage, authenticated recorder APIs/UI and the reserved
completion join remain missing behind the earlier failed safety gate.

The second-session gate is **not reached**. Help commands exist and work:

```bash
node --import tsx scripts/concord-local-init.ts --help
node --import tsx scripts/concord-local-mcp.ts --help
node --import tsx scripts/concord-local-check.ts --help
```

Actual init/launch refuse (exit 1); collection refuses (exit 2). Do not start
Codex with stock Concord or these held launchers. The installed Codex CLI
`0.153.4` supports per-invocation TOML `-c` and workspace-write `-s`/working root
`-C`; [official MCP documentation](https://developers.openai.com/codex/mcp)
describes stdio command/args/cwd and `/mcp`. Runnable two-role launch instructions
must be issued only after the new storage isolation prerequisite passes, with
normal trust/approval prompts and no global config/hook rewrite or bypass.

Next decision: approve a **separate repository-owned SQLite acquisition layer**
or another explicitly reviewed storage architecture that can enforce safe
main-file and WAL/SHM acquisition before mutation, while preserving Concord's
schema/tool semantics. A version bump, pre/post scan or `/proc/self/fd` alone
has not been proved sufficient. Keep the hold until independent late-alias,
sidecar, hardlink, active-WAL and cleanup negatives all pass.

## State, privacy and incident disclosure

No push/merge/PR/deploy/email/font publication occurred. User-owned preview
34684 and existing production data services were not repurposed. The exact font,
local state and audit artifacts remain Git-ignored. Local build artifacts still
contain the private font preview and must not be published.

While adding the hold, root mistakenly executed its first RED test against
the real-name initializer. It created empty local identity/databases. Inspection
confirmed zero tasks, agents and events. The exact three files plus two
inspection-created sidecars were moved recoverably to ignored
`.local-audit/20261013-r8HwXX/quarantined-empty-init/`. They are not session or
product evidence. Final `.concord` contains only an empty test-harness directory.

All completed and incomplete authored changes are preserved. Full final
independent review of every combined new module remains pending; the completed
independent reviews cover the authority and adapter boundaries described above.

## Changed-file inventory

Local authored files changed/added during this pass (private audit artifacts
and generated outputs excluded):

```text
.gitignore
eslint.config.mjs
next.config.ts
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.json
docs/design/AXUNO_FONT.md
docs/concord/LOCAL_EXECUTION_LEDGER.md
docs/concord/LOCAL_PRODUCT_COMPLETION.md
docs/superpowers/specs/2026-10-12-archeagent-local-product-completion-design.md
docs/superpowers/plans/2026-10-12-archeagent-local-product-completion.md
scripts/concord-local-check.ts
scripts/concord-local-init.ts
scripts/concord-local-mcp.ts
services/executor-go/README.md
services/executor-go/cmd/server/main.go
services/executor-go/cmd/server/main_test.go
services/executor-go/go.mod
services/executor-go/go.sum
services/executor-go/internal/sandbox/docker.go
services/executor-go/internal/sandbox/docker_test.go
services/executor-go/internal/sandbox/spec.go
services/executor-go/internal/sandbox/spec_test.go
src/app/api/evaluate/route.ts
src/app/api/integrations/concord/review-gate/route.ts
src/app/immersive-material.css
src/app/layout.tsx
src/app/page.tsx
src/app/pearl-theme.css
src/app/workbench.css
src/components/evaluation-workspace.tsx
src/components/lifecycle-console.tsx
src/components/theme-switch.tsx
src/core/release/release-lease.ts
src/lib/browser-request.ts
src/lib/browser-theme.ts
src/lib/evaluator.ts
src/lib/lifecycle-demo.ts
src/lib/ui-format.ts
src/server/concord/adapter.ts
src/server/concord/auth.ts
src/server/concord/execution-receipts.ts
src/server/concord/local-paths.ts
src/server/concord/local-runtime.ts
src/server/concord/private-store.ts
src/server/concord/receipt-canonical.ts
src/server/concord/receipt-process.ts
src/server/concord/tree-manifest.ts
src/server/http/bounded-json.ts
tests/bounded-json.test.ts
tests/browser-ui.test.ts
tests/concord-execution-receipts.test.ts
tests/concord-local-adapter.test.ts
tests/concord-local-auth.test.ts
tests/concord-tree-manifest.test.ts
tests/evaluate-api.test.ts
tests/evaluation-workspace.test.ts
tests/evaluator.test.ts
tests/lifecycle-demo.test.ts
tests/local-build-config.test.ts
tests/release/release-lease.test.ts
```
