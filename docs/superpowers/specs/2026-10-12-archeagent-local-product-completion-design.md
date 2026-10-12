# Archeagent local product completion — design for review

Date: 2026-10-12, Asia/Karachi.
Status: architecture direction approved; **this written specification awaits
owner review**. It is not an implementation or completion receipt.

## Intent and immutable constraints

Finish the missing operational functionality in
`/home/nur/Projects/archeagent-final-staging`, preserving the integrated evaluator,
audited review gate, obsidian/pearl materials, full-screen geometry, continuous
normal-motion background and exact private AXUNO preview. Success means a
working local recorder backed by actual coordination and execution records,
with independently reproducible controls and an honestly qualified two-session
result. A plausible visual demonstration is not acceptance.

No push, PR, merge, public deployment, recruiter email, unrelated-repository
mutation, global Codex configuration rewrite, private-font redistribution,
fabricated activity, planted review defect or overwritten active work.
Local design/implementation commits are permitted; they are not releases.
Stop for final approval, and earlier if a real second Codex session needs
manual startup or another required authority is missing.

## Existing baseline to preserve

- Branch `integration/archeagent-final-local`, initial clean HEAD
  `3d7577eb071170c74eff892922f65f09fcb5e8fc`.
- The review gate, bounded API and regular-file CLI are implemented. They
  assess reported claims; every result remains sourceAuthenticated=false,
  caller_supplied, content_integrity_only, releaseAuthorized=false.
- The evaluator and lifecycle console use synthetic/caller-reported signals.
  Keep them available and explicitly separate from operational records.
- The theme switch, AXUNO CSS, global material ribbons/blooms/glaze and visual
  shell exist. Do not replace them with a new dashboard brand or font.
- The ignored personal-use font is `public/fonts/axuno-original-demo.otf`.
  Git exclusion alone does not make a deployment artifact license-safe.

The current route census has no Flight Recorder, authenticated source reader
or recorder controls. Neither historical screenshots nor tests of the old
checkout prove this integrated tree's missing functionality.

## Choices considered

1. **Recommended: explicit local Concord adapter plus authenticated read-only
   recorder and independent receipt collector.** Reuses genuine Concord domain
   tools, avoids historical storage, and keeps displayed evidence separate
   from release authority. Requires new interfaces and a real session gate.
2. Stock Concord invocation/shared worktree database. Rejected: installed
   Concord 0.13.0 follows linked worktrees to their primary checkout, including
   an explicit CONCORD_REPO_ROOT. It would mutate the older hiring store.
3. Export/snapshot viewer only. Insufficient: useful for reported history, but
   not a real-session ownership/message/handoff and command-receipt product.

## 1. Fixed-root Concord runtime

Implement a project-local launcher around pinned Concord 0.13.0 domain/server
factories. Use explicit repositories/database path rather than its stock
entrypoint, native inbox CLI or WorkspaceManager root selection. Never patch
the installed tooling or upstream reference checkout.

The only permitted state root is this staging checkout's `.concord/`; resolve
and validate the real checkout directory independently of git-common-dir.
Reject symlinked state directories/database/artifact files and unsafe special
files, including SQLite WAL/SHM, ledger, receipt and secret sidecars. Test the
actual linked-worktree condition. Missing configuration must
not fall back to the historical checkout, another workspace or a remote store.
No cloud selection, update checks or telemetry are started by this adapter.

Reuse actual start_work, inspect_work, update_work, transfer_work and finish_work
tools. Add a pre-dispatch guard: reject workspace_id/root selection outright
(the upstream no-manager mode otherwise ignores workspace_id), and reject a
foreign acting agent_id on write tools before forwarding. Fixed operator-selected
actors are bound by the launcher, not tool JSON. Preserve inspect_work.agent_id
as a legitimate peer-view selector, not an acting-identity override.
The two narrow added helper tools register a pull endpoint and drain the
current actor's inbox through Concord's existing repository functions. They
must not permit selecting a foreign actor, repository, filename or endpoint.
Account for endpoint expiry and refresh it before messages are expected.
Enforce pull-only delivery: reject incompatible pre-existing local-ipc endpoints
and do not invoke upstream socket dispatchers, cloud transports or native CLI
inbox commands. Peer work-state filters remain supported; another recipient's
private inbox is not an authorized peer-view selector.

Keep a local versioned invocation ledger identifying actor, capture run,
server instance, tool, task, timestamps, outcome and Concord record references.
Allowlist structured fields; full prompts, message text, tool arguments,
environment values and credentials remain private and are not sent to the UI.
Do not turn SDK connections or operator actor names into model-session proof.

Proposed files: `scripts/concord-local-mcp.mjs`, a small reusable server adapter
under `src/server/concord/`, and scoped adapter tests. Exact upstream import
exports and dependency/runtime compatibility are verified before implementation;
pin dependencies and stop on an unsupported factory rather than silently
forking semantics or adopting the stock unsafe root resolver.
Concord has no root main/exports entry; use its pinned dist subpath imports and
smoke-test module/native-SQLite resolution in this project's dependency graph.
An alternative supported factory composition is SDK McpServer plus upstream
registerWorkflowTools/registerWorkStateResource with a fixed SelectWorkspace
closure and pull-only AgentMessageDispatcher; it must preserve the same genuine
handlers and pre-dispatch policy, not invent substitute protocol results.

Export regeneration uses a validated fixed-dir closure: onToolWrite can receive
undefined without WorkspaceManager. The upstream writeArtifacts function does
not enforce path safety; validate every export/sidecar write and serialize local
regeneration. If DB mutation commits but export regeneration fails, record a
distinct incomplete outcome; an error does not imply the DB operation rolled
back. Global HANDOFF.md/REVIEW_PACKET.md refer to the latest store-wide record,
not necessarily a selected task. The recorder must load task-specific database
records and disclose that legacy CLI/export limitation.

## 2. Local access authentication

The UI is served only on 127.0.0.1 at an explicitly unused port. The server
holds a generated operator secret in private local state or server environment,
never a NEXT_PUBLIC variable, source file, URL, screenshot or build output.
Missing/invalid secret configuration fails closed; there is no default password.

Provide a small local sign-in/session boundary: operator supplies the secret
through a bounded same-origin POST, compared using a timing-safe fixed-size
digest. Issue a signed, expiring HttpOnly, SameSite=Strict cookie scoped to the
local recorder. It is not a persistent browser-storage token. Keep a
server-side bounded session registry: logout revokes the session as well as
expiring its cookie; replay of a copied revoked cookie must fail. Sessions
expire after 15 minutes, restart/secret rotation invalidates them, and the
registry holds at most 64 active sessions. Use bounded failed-login
attempts and generic errors. Do not pretend local HTTP provides remote TLS
security; never enable a public bind for this private preview.

Validate the configured loopback Host on all private reads and writes, enforce
same-origin Origin on state-changing requests, reject cross-site fetch metadata,
and expose no permissive CORS.
Authenticated recorder requests deny access **before any source read**. Return
Cache-Control: no-store, no raw validation exceptions, no source paths or
secrets in logs. Authentication means permission to view the local recorder,
not authentication of an agent's claims or model identity.

Protect private recorder APIs and gate access without breaking the public-data
fixture console. The legacy evaluator remains a bounded reported-signal scorer;
its results must never be accepted as executed-test or release evidence. Its
currently unbounded request.json/raw-issues path is a planned repair, not an
existing protection: enforce 262,144 actual bytes, a 10-second body deadline,
bounded schema strings/collections and fixed non-echoed errors. Apply the same
deadline to the existing bounded review-gate route. Credential input is limited
to 4,096 actual bytes and a 5-second deadline; no endpoint waits indefinitely.

## 3. Genuine backend projection and timeline

Read the fixed staging database through a read-only consistent SQLite snapshot
that includes committed WAL data. Do not use immutable=1 against active writers.
Use a transaction/consistent acquisition and bounded SQL queries; never query
with caller-selected paths, repository roots, table names, SQL or remote URLs.
Version the projection and validate stored records at runtime.
The reader uses a separate readonly=true, fileMustExist=true SQLite connection
with query-only mode. It must not call upstream openRepositories/openDatabase,
which create/migrate sources and change journal mode. Those factories are
permitted only in the validated writer adapter.

Project actual agents, tasks/status/version/declared file ownership, normalized
active conflicts, ownership transitions, task updates, addressed handoffs,
message delivery/acknowledgment metadata, reviews and audit events. Compute
conflicts from actual scopes/statuses and distinguish open conflict from its
recorded resolution. A recorded finish packet is not a delivered handoff.

Suggested endpoints under `/api/concord/`:

- session creation/deletion;
- bounded overview and paginated timeline;
- task detail selected by opaque bounded ID;
- receipt metadata and read-only redacted export.

List at most 100 timeline rows/page and 256 tasks/overview; reject invalid
cursors and cross-source IDs. Projection/export responses have a 1 MiB maximum.
Show source revision, capture time and acquisition status. Never silently merge
divergent histories or imply missing events occurred. Invalid source, missing
tables, foreign scope, truncation, contradictory sequence, interruption and
read error are explicit unavailable/incomplete states, never fixture fallback.

A redacted export uses the same versioned projection as the screen, fixed
download naming and authenticated access. No raw database, transcript, message
body, endpoint credentials, host path or arbitrary filesystem download route.
Use server allowlists, not only pattern-based secret detection. All user text
is escaped; omit free-form sensitive details by default.

## 4. Provenance and independent execution receipts

Keep separate, visible dimensions:

- local source acquired / unavailable;
- actor identity operator-assigned / locally linked to observed Codex thread;
- historical imported / current capture;
- tests reported / command executed / result independently reproduced;
- content integrity matched / inconsistent;
- source freshness and completeness;
- reviewer acceptance recorded / unobserved;
- release authorization false.

A dedicated server-held Ed25519 signing key is required to authenticate this
local collector's own receipts to its configured verifier. Use a versioned
canonical envelope `archeagent.execution-receipt.v1`, including all scope,
manifest, command, timing, exit and output-digest fields in the signed payload.
It cannot cryptographically attest an OpenAI model,
authenticate arbitrary mutable SQLite history, or defeat an adversary controlling
the same user account. State that local-host trust limit explicitly. SHA-256
alone remains content integrity. The caller cannot select the trusted key or
upgrade labels using JSON fields.

Provide an operator CLI collector, not an arbitrary HTTP command executor.
Accept only allowlisted check IDs mapped to direct argv and a fixed staging cwd.
Record capture run, unique receipt ID, task, actor/thread linkage, tested HEAD
and complete relevant-tree digest, command/args, start/end, exit code, bounded output digest,
tool version and private original-output reference. Failed, timed-out, truncated,
missing or mismatched-tree checks cannot back a successful completion.
The relevant-tree digest includes paths, modes and bytes for staged, unstaged
and untracked source/config/test files under a documented allowlist, including
manifests/lockfiles; it excludes Git internals, dependencies/build outputs,
private state, credentials and private font assets. Compare before and after
execution and reject a receipt if the tree changed. Preserve a file manifest
so an independent verifier can reproduce the digest; absence of an expected
file invalidates it. Do not claim HEAD or git diff alone covers untracked work.
Receipt storage is transactionally serialized and duplicates are idempotent
only when byte-identical; a divergent duplicate is rejected. Re-observing an
execution receipt is distinct from consuming a one-time release lease.
Capture check results from processes, never caller assertions. Full integration
checks require separately owned disposable services and validated test URLs.
Do not repurpose keys from the release system for unrelated receipts.
Store invocation/receipt/session-link records in a separate staging-private
recorder database rather than adding unowned tables to Concord's schema.
Both databases bind to one generated source instance and capture-run ID.
Projection joins require existing task/event/handoff references, matching actor,
source/run and tested-tree identity, and a validated pair of source revisions.
Separate SQLite reads are not a cross-database atomic transaction: a record
whose other side has not arrived is pending/incomplete, never verified
delivery/acceptance/completion. Reject cross-run references and divergent
duplicates. Test partial acquisition and record arrival in either order.

Thread linkage uses targeted local Codex runtime/session metadata and actual
MCP tool-call trace for the two specifically approved threads; no broad history
scan. Agent-supplied start_work model/pid/cwd values are reported metadata and
may later be overwritten/null. Keep independently observed linkage in the
immutable capture ledger, unobserved until runtime and tool trace agree.

## 5. Preserve evaluator; harden actual authority

Keep the existing scorer/ranking interfaces and fixture examples. Add consistent
test-count validation and truthful reported-evidence labels; zero tests or
contradictory pass/failure counts cannot score as a passed test gate. Live receipt
evaluation derives outcomes from captured processes and is a distinct input
adapter, not a rebranding of user-submitted booleans.

Reject malformed/version/algorithm-mismatched release leases, invalid/non-ISO
timestamps, future issue time, expiresAt<=issuedAt and expired authorization.
Use an explicit documented maximum lifetime of 15 minutes for new local leases,
with fixture inputs adjusted only if required by that policy. Validate context
time and required claims before signature/context/replay decisions; never
consume a nonce for invalid evidence. Trusted keys remain server-controlled.
The verifier enforces the maximum declared lifetime too, including correctly
signed input; issuance constraints alone are not sufficient. Receipt keys,
access-auth secrets and release keys are separate.
Preserve exact repository/base/patch/policy/evidence/environment bindings and
atomic one-time consumption. Do not introduce UI actions to issue leases, merge
Git, deploy or weaken sandbox policy. Recorder completion is not release.

Reject executor image names beginning with a hyphen and invalid Docker image
references before argv construction. Regression-test crafted image/command
option combinations without invoking Docker. Preserve direct argv, read-only
default, no-host-mount policy and canonical workspace validation. Bound output,
validate a single complete JSON object, respect request cancellation and reject
public exposure/missing local execution authentication. Any explicit network
enablement or writable root requires a separate operator execution policy; the
recorder never grants it. Real Docker isolation qualification is separate from
pure argv tests and is not required to expose a read-only recorder.

## 6. Flight Recorder UI and visual preservation

Add an operational recorder section/route within the existing design shell,
with navigation clearly distinguishing **Recorded activity** from **Fixture
evaluation**. Preserve theme switch, private AXUNO letterforms/fallback,
continuous material layers, geometry and evaluator controls.

The recorder includes sign-in/out, actual source/capture status, agent/session
list, task ownership and version, conflict/resolution display, filtered event
timeline, task/handoff detail, receipt outcomes, refresh/pause updates and a
redacted export. New controls must all have working behavior and accessible
labels/focus; do not add decorative inactive buttons. Treat authenticated empty
history as a real empty state, not automatically generated activity.

Use bounded polling, pause when hidden or explicitly paused, avoid overlapping
requests, abort stale fetches on task/source selection or logout, and preserve
selection across refresh. Show last successful capture and a clear stale/error
indicator on failure. Do not advertise constant liveness without recent records.
No model/provider calls, test execution or release are triggered by read-only
browser controls.

Keep personal-use AXUNO binary and exact-font screenshots local. Add project
ignore protection for private runtime/artifacts/font without changing shared
Git configuration or other worktrees. Never imply the demo font is licensed
for commercial distribution. Its public font license remains a future release
gate, outside this local-only completion pass.

## 7. Real two-Codex-session gate

No new session is started until the fixed-root adapter is verified. Stock
Concord launch commands are unsafe for this linked worktree. Publish exact
manual commands only when their referenced launcher exists and passes its
storage/identity tests. Use per-invocation Codex MCP overrides, workspace-write
sandbox and normal project-trust/approval prompts; do not rewrite user config
or use approval/hook bypass flags. The owner selects available model settings.

Two independently created threads must be observed and linked locally, with
different IDs, actual model/session metadata and a scoped capture run. Their
models must themselves invoke genuine Concord tools. Two scripted MCP
connections, current inspection subagents or operator actor names are not proof.

Required sequence:

1. Builder and reviewer register their scoped endpoints and verify /mcp tools.
2. Start distinct tasks intentionally declaring an overlapping approved file;
   capture the returned conflict without allowing simultaneous edits.
3. Exchange a real prompt/reply with delivery receipts. Recipient inbox drain
   is part of this proof; queued messages do not count as delivered.
4. Release the competing claim using a fresh expected_version, then verify
   ownership is resolved before writing.
5. Builder implements an approved real product requirement and runs relevant
   allowlisted checks with independently captured tree-bound receipts.
6. Offer an addressed handoff; reviewer accepts using its own session and a
   fresh version. finish_work(review_ready) alone is insufficient.
7. Reviewer inspects code and independently checks it. Record actual findings;
   builder corrects real findings and reruns checks if needed. Never insert a
   flaw or fabricate a defect-correction narrative. If no correction occurs,
   mark that particular observation unobserved.
   After reviewer acceptance the reviewer owns the task: before builder edits
   for a correction, require a versioned ownership handback/accept or a new
   correction task with resolved scope. Re-offer and re-review afterward.
8. Final completion must cite the actual review, ownership/message/handoff
   references and successful receipts for the same tested tree. Inspect them
   through the recorder and verify negative/tampered cases remain rejected.

If this environment cannot attach genuine Concord tools or a second thread
must be started manually, stop with verified runnable commands and exact role
prompts. Do not simulate the missing session or mark the product PASS. No live
claims can be inferred from historical scripted records.
Reserve a real implementation component for the two sessions: the completion
projection joining task-specific accepted handoff/review records to successful
signed receipts for the unchanged tested tree. Define its interface and keep
completion fail-closed until the pair implements/reviews it. Do not finish every
feature before this gate and then invent cosmetic work or a planted defect to
claim meaningful collaboration.

## 8. Required acceptance gates

Use TDD and independent adversarial review. Test at least:

- auth denial before source I/O; wrong/missing secret; cross-origin/Host access;
  expiry/logout/rotation; secret sentinel absent in responses/logs/exports;
- actual linked-worktree isolation; foreign workspace/tool actor rejected;
  path traversal, symlinks, special files, oversized/invalid data;
- consistent read with active WAL; malformed schema, duplicate divergent
  events, foreign IDs, invalid cursors, missing/stale/incomplete sources;
- signed collector receipt wrong key, tamper, replay, scope/tree mismatch,
  failed command and caller-forged success fields;
- invalid/future/expired lease times and every state-binding mismatch;
  image-leading-hyphen option injection rejected without Docker execution;
- no fictitious empty-state events; actual conflicts/versions/accepted handoff;
  reported versus executed evidence; all UI controls and retry/logout;
- existing evaluator, review gate, release/fencing and fixture regressions.

Run full tests with new isolated PostgreSQL/Redis fixtures, lint, TypeScript,
production build, Go race/vet, existing bounded formal check and independent
negative cases on final source. Do not use production services or self-skip
integration tests. Record exact commands, versions, counts and exit codes.
Provider-fixture and synthetic-routing gates are not real-model performance.

Browser acceptance on final built source: desktop/mobile/tablet dark and light,
keyboard navigation, all recorder/evaluator controls, sign-in/out, paused/stale
updates, failure/retry, theme persistence and no overflow. Verify actual platform
font glyphs, not font-family alone. Observe changing normal-motion frames and
computed transforms while scrolling; test reduced motion separately and restore
overrides. Do not equate changing pixels with zero lag or compositor-only cost.
Private screenshots/video stay local and must include evidence-status labels.
Use an unmodified rendering context or record external theme/extension effects
as an explicit limitation. Baseline Chrome QA found injected Dark Reader styles;
theme attributes/persistence passing is not clean pearl-color acceptance.

## Status and review handoff

PASS requires all implemented critical boundaries, real backend/UI behavior,
genuine two-session collaboration and final fresh checks to be verified.
PARTIAL means a missing session/manual gate or unverified required behavior;
FAIL means a reproduced safety/functional gate remains failing. A green legacy
test suite cannot override a missing requirement or adversarial failure.

This specification's approval is the next required gate. After approval, write
the concrete implementation plan, review its dependency/file/test contracts,
and select inline or delegated execution before implementation. Do not treat
architecture-direction approval as approval of this unseen written artifact.
