# Independent findings — Concord hiring submission

12 October 2026. Baseline `c58e23f8edd441597107dbc0e9bc4feff871ddab`.
Overall verdict: **PARTIAL**, not a complete Flight Recorder or two-model
collaboration claim. Baseline defects below are historical reproductions;
approved repairs and remaining limits are distinguished explicitly.

## Source census

No commits followed the named baseline when the audit began. The baseline
changes exactly eight files: `.gitignore`, `docs/CONCORD_INTEGRATION.md`,
`package.json`, `pnpm-lock.yaml`, `scripts/concord-review-gate.ts`,
`src/app/api/integrations/concord/review-gate/route.ts`,
`src/core/integrations/concord-review.ts` and
`tests/concord-review-gate.test.ts`. All were inspected together with adjacent
frontend, executor, release, formal and CI boundaries. The follow-up changes
are bounded repairs, regressions and public reproduction/handoff artifacts.

## Genuine Concord use; not genuine two-model collaboration

The local protocol script uses real MCP SDK clients and StdioClientTransport
to launch installed Concord MCP 0.13.0 twice. It does not invoke a model or
run its reported test command. Its two identities are script-declared actors,
not authenticated Codex-session identities. The narrowly scoped session search
did not locate the originating script execution trace. Persisted records and
the matching transport implementation support a protocol exercise, not a
genuine two-model interaction.

Immutable read-only SQLite queries and the exported event stream agree:

| Record | Original UTC timestamp on October 12 | Verified meaning |
|---|---|---|
| events.id=1, claim_work | 08:16:46.432 | Builder actor claims one file |
| events.id=2, claim_work, 1 overlap(s) | 08:16:46.454 | Peer actor claims same file; overlap recorded |
| task_ownership_events.id=1, release | 08:16:46.460 | Peer active → proposed; version 1 → 2 |
| events.id=3, release_task | 08:16:46.461 | Release recorded successfully |
| handoffs.id=1 | 08:16:46.465 | Finish packet recorded, not delivered/accepted |
| events.id=4, handoff, review_ready | 08:16:46.467 | Review-ready finish event |
| reviews.id=1 | 08:16:46.468 | Reported review evidence persisted |
| events.id=5, review_ready | 08:16:46.469 | Review-ready state recorded |

Counts: 2 tasks, 2 agents, 5 events, 1 ownership release, 1 handoff, 1 review;
**0 endpoints, 0 messages, 0 message events, 0 task updates**. Agent model/PID/CWD
metadata is null. Handoff sender, recipient, version and resolution are null;
delivery status is recorded. Markdown owner/version fallbacks are not delivery
acknowledgments. No historical reviewer finding/correction loop is recorded.
The packet's one-file scope does not account for the entire eight-file commit.

No original failed cross-session delivery attempt was found: **not validated**,
not “delivery failed.” Current engineering audit subagents and their messages
must not retrofit historical Concord collaboration. The original database,
full exports, credentials and private transcripts remain local and untracked.

The first read-only SQLite access created empty WAL/shared-memory cache
sidecars without changing logical records or database mtime. Later reads used
mode=ro&immutable=1 while WAL was empty. Do not use immutable mode to infer the
latest state of a concurrently changing database with uncheckpointed WAL.

## Reproduced defects and approved repairs

| Finding | Historical reproduction | Current repair |
|---|---|---|
| C1 scope/collision | Interior dot alias hides overlap; matching unsafe paths admitted | Bounded lexical repository-relative normalization; reject absolute/drive/escape/control paths; compare canonical scopes |
| C2 packet consistency | Borrowed/duplicate sections, code examples, failed or contradictory reports admitted | Unique required sections; fences/indented code excluded; whole-section negative narratives and nonzero exits rejected; zero-failure summaries accepted |
| C3 body bound | 300,955-byte envelope admitted without honest Content-Length | Actual byte count, 262,144 limit, cancel oversize, strict streamed UTF-8 |
| C4 error amplification | 50,717-byte invalid request produced 10,000 issues / 1,358,938-byte response | Bounded schema and fixed errors without raw Zod issues or input echo |
| Origin ambiguity | Invented consistent input can be READY | Immutable sourceAuthenticated=false, caller_supplied origin, content_integrity_only digest, releaseAuthorized=false |
| CLI local boundary | Symlinks/unbounded reads/raw errors possible | Fixed files, directory/final-file symlink rejection, fstat regular-file check, bounded read, fatal UTF-8, generic stderr |
| U1 fixture disclosure | UI has no visible demo disclaimer | Persistent fixture label and example-stage/CTA wording |
| U2 fetch recovery | Forced fetch failure leaves loading disabled | Status/schema checks, fixed accessible error, enabled retry, finally cleanup |
| U3 false winner | REJECT/null-winner displays first ranked rejected candidate | Only explicit unique MERGE winner accepted; contradictory responses rejected; valid no-winner state preserved |
| G1 read-only default | Omitted JSON bool false removes --read-only | Decode with default true; explicit false remains supported |
| G2 workspace scope | /workspaceevil and /workspace/../etc accepted | Exact canonical POSIX /workspace or descendant |
| Dependencies | 8 production advisories in Next/sharp/source-map-js | Next/eslint-config-next 16.3.8, sharp 0.35.5, source-map-js 1.2.2; Node types 22.20.5 fix Vitest peer mismatch |

These bridge defects affect reported-evidence admission, not demonstrated
release execution or arbitrary-file HTTP reads. The path contract is lexical;
it does not authenticate symlinks or the repository contents. Text consistency
checks are deliberately narrow; they cannot establish arbitrary prose truth,
test execution, source authenticity, freshness or complete Git scope.

Tests were written RED before repair. Independent re-review found additional
guardrail/provenance contradictions, nonzero exits, indented code and a false
rejection of successful zero-failure summaries. Those were repaired and
independently retested. Exact final counts, browser evidence and CI appear in
[RECRUITER_HANDOFF.md](RECRUITER_HANDOFF.md).

## Remaining security and readiness limits

- No Flight Recorder route, authenticated source import, genuine two-model
  messaging, addressed/accepted handoff or historical correction loop.
- HTTP gate has no authentication, rate limit or body deadline. It only reads
  the supplied request, never local Concord files; it grants no release lease.
  A consistent invented payload remains READY **and unauthenticated**.
- CLI same-UID mutable exports are not a trusted atomic/signed snapshot.
  No general-purpose transcript redactor exists; only bounded generic errors
  and selected assessment fields avoid echoing raw packets.
- Go service remains loopback-default, unauthenticated and configurable;
  explicit read_only_rootfs=false is allowed. Do not expose it publicly.
  Pure handler/argv tests do not qualify real Docker isolation, cancellation,
  output limits or the complete HTTP execution service. No host mounts are
  configured; no host escape is claimed. Docker is not VM isolation.
- Production dependency audit exits 0 with zero advisories. Full audit exits 1
  for **one high development-only braces 3.0.3 advisory**, through
  eslint-config-next. Registry inspection finds no published 3.0.4; the
  [reviewed advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists no
  patched release. No suppression is used. Avoid untrusted glob inputs to the
  development toolchain. This is not demonstrated app exploitation.
- CI uses mutable action-version tags and lacks explicit minimal permissions;
  no pull_request_target or event-body command interpolation was found.
  ESLint 9 reports upstream deprecation. Broader supply-chain hardening remains.
- Provider validation and routing benchmarks use fixtures/synthetic trials.
  The bounded TLA+ model does not prove the parser, API, entire application or
  production behavior. Browser captures are fixtures, not autonomous work.

The original Next image SSRF prerequisites were not configured; the
[maintainer advisory](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4)
says no remotePatterns means that case is not applicable. No public sharp/SVG
or indexed-source-map ingestion was found. Updating those versions nevertheless
removes installed production advisories without claiming prior reachable exploits.

A bounded credential-pattern scan found no private-key headers, GitHub PAT or
live Stripe-key patterns in inspected source/docs; tracked database/key/env
paths and their file-addition history were empty. This is not an exhaustive
entropy or all-history secret audit.

Both repair sets were approved before implementation. Publication is confined
to the existing feature branch and PR #1, but GitHub denied push and PR update
to the configured account. The verified follow-up remains local, with no new
CI outcome; no merge, email send or public deploy occurred.
[WALKTHROUGH.md](WALKTHROUGH.md) asserts positive and negative controls using
deliberately synthetic public input, without publishing private evidence.
