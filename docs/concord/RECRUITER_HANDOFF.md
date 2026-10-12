# Archeagent × Concord — recruiter engineering handoff

**Verdict: PARTIAL overall; the bounded review-admission repair passes its local
engineering gates.** No complete Flight Recorder or genuine two-model
collaboration is claimed. Audited baseline:
`c58e23f8edd441597107dbc0e9bc4feff871ddab`; follow-up branch:
`feat/concord-agent-coordination`.

[GitHub PR #1](https://github.com/am-selenephose/archeagent/pull/1) ·
[Audit findings](AUDIT_FINDINGS.md) · [Walkthrough](WALKTHROUGH.md) ·
[Technical email draft, not sent](EMAIL_TO_ALEX.md).

## What was built

A TypeScript claims-consistency assessor, bounded local-export CLI and JSON
HTTP review-admission endpoint. It checks task identity/status/version, canonical
declared file scope and active collisions, unique packet sections, explicit
contradictory reports, and chronological/latest finish events. The approved
repairs add actual stream-byte limits, strict UTF-8, fixed errors and bounded
regular-file reads with symlink rejection.

Every result declares:
`sourceAuthenticated: false`, `evidenceSource: "caller_supplied"`,
`digestMeaning: "content_integrity_only"`, `releaseAuthorized: false`.
Caller JSON cannot change those fields. SHA-256 is not a source signature.
A consistent invented report can be READY; that means only eligibility for
independent review, not verified work or release.

Adjacent fixes make the Go executor default to read-only rootfs and enforce a
canonical /workspace boundary. The existing UI now labels fixture results,
recovers from fetch failures, and does not display a rejected candidate as a
winner. Production dependencies were patched; one development advisory remains.

## Why Concord and independent verification both matter

Real Concord MCP 0.13.0 was exercised through two scripted MCP SDK connections:
an overlapping file claim, versioned release and recorded review-ready finish
persisted in the original local records. Concord supplied shared coordination
state; Archeagent kept release authority separate from agent-reported evidence.

The original actors were **scripted protocol clients, not two autonomous Codex
sessions**. Their model/PID/CWD metadata is null. There are zero message/endpoints
records and no addressed/accepted handoff or historical reviewer correction.
No failed delivery attempt is established; cross-session delivery is unvalidated.
The reported tests were literal script inputs, and one reported file does not
account for the eight-file Git integration commit.

The original 145-test suite missed defects reproduced by adversarial inputs.
Independent expanded tests and review corrected them. Current audit subagent
communication is not historical Concord collaboration evidence.

## Verified checks

Final local rerun completed at **2026-10-12T10:54:28Z**, after the last code change.

| Exact command | Outcome |
|---|---|
| `pnpm install --frozen-lockfile` | Exit 0 |
| `pnpm verify` | Exit 0: **32 files, 292/292 tests, zero skipped**, lint, Next 16.3.8 build, Go tests, formal checks, provider-fixture validation and synthetic routing |
| `pnpm exec tsc --noEmit --incremental false` | Exit 0 |
| `cd services/executor-go && go test -race -count=1 -v ./... && go vet ./...` | Both exit 0; **7 top-level tests / 13 subtests** |
| `pnpm exec tsx scripts/concord-audit-walkthrough.ts` | Exit 0; **14 asserted synthetic controls** |
| `pnpm audit --prod --json` | Exit 0; zero production advisories |
| `pnpm audit --json` | **Exit 1**; one high development-only braces 3.0.3 advisory, no published patched version |
| `pnpm peers check` | Exit 0 |
| `git diff --check` and local documentation validation | Exit 0; 5 Markdown files, 16 local links, fixture JSON valid, email body 149 words |

Focused subsets: core 117, API 14, CLI 4, frontend 19. Go tests stop at real
decoding/validation/argv construction with a fake external runner, not Docker
isolation qualification. TLA+ checks 92,577 generated / 19,554 distinct states,
depth 18; unsafe control detects the exact-state invariant violation (expected
TLC exit 12, wrapper exit 0). This is a bounded model, not whole-app proof.
Provider validation uses fixtures; 640 routing trials are synthetic, not
real-model performance evidence.

Actual loopback HTTP: consistent input 200/READY but unauthenticated;
failed-test report 200/BLOCKED; chunked oversized body 413/29 bytes; invalid
10,000-task array 400/36 bytes. In the real browser, 12 fixture stages render,
forced fetch failure offers an enabled retry, and retry completes without reload.
Sampled desktop 1440, mobile 390 and tablet 768 widths have no horizontal overflow.

## Reproduce with isolated services

CI specifies Node 22, Go 1.23.x, Java 17; local audit used Node 24.19.0,
Go 1.27.0, Java 26 and pnpm 11.20.0. Remote CI is a separate version gate.
The suite truncates target tables: **never use production services**.
Check names/ports are free; choose different ones if occupied, never remove an
existing resource to make room.

```bash
git clone --branch feat/concord-agent-coordination \
  https://github.com/am-selenephose/archeagent.git archeagent-concord-audit
cd archeagent-concord-audit
git rev-parse HEAD
pnpm install --frozen-lockfile
ss -ltn '( sport = :25439 or sport = :26389 )'
docker run -d --name archeagent-review-pg -p 127.0.0.1:25439:5432 \
  --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_USER=archeagent -e POSTGRES_DB=archeagent postgres:17-alpine
docker run -d --name archeagent-review-redis -p 127.0.0.1:26389:6379 \
  --tmpfs /data redis:8-alpine
docker exec archeagent-review-pg pg_isready -U archeagent -d archeagent
docker exec archeagent-review-redis redis-cli ping
```

Proceed only when pg_isready succeeds and Redis replies PONG. Trust auth is
appropriate only for these loopback disposable fixtures.

```bash
ARCHEAGENT_TEST_DATABASE_URL=postgres://archeagent@127.0.0.1:25439/archeagent \
ARCHEAGENT_TEST_REDIS_URL=redis://127.0.0.1:26389/15 \
ARCHEAGENT_UPDATE_FORMAL_RECEIPTS=0 NEXT_TELEMETRY_DISABLED=1 pnpm verify
pnpm exec tsc --noEmit --incremental false
(cd services/executor-go && go test -race -count=1 -v ./... && go vet ./...)
pnpm exec tsx scripts/concord-audit-walkthrough.ts
pnpm audit --prod
pnpm audit
# Remove ONLY fixtures you created above:
docker rm -f archeagent-review-pg archeagent-review-redis
NEXT_TELEMETRY_DISABLED=1 pnpm start --hostname 127.0.0.1 --port 34331
```

Functional UI: `http://127.0.0.1:34331/#console`, **fixture demo only**.
HTTP route: `POST /api/integrations/concord/review-gate`.
[Desktop](screenshots/lifecycle-fixture.jpg) ·
[Mobile](screenshots/mobile-fixture.jpg) ·
[Fetch failure/retry](screenshots/fixture-fetch-recovery.jpg).
Screenshots are real browser captures; no video was recorded.

## CI and publication

Implementation commit: `a6b95da523d33d0fff01934fa84d50fd545d6191`, local only.
Push to the existing feature branch failed with HTTP 403: GitHub denied the
configured `am-selenephos` account permission to `am-selenephose/archeagent`.
PR #1 update was also denied by UpdatePullRequest permissions. Publication
attempts stopped; no credentials were extracted or alternate identity attempted.

There is **no new-head GitHub CI run**. Existing successful runs
[38223247398](https://github.com/am-selenephose/archeagent/actions/runs/38223247398)
and [38223254175](https://github.com/am-selenephose/archeagent/actions/runs/38223254175)
apply only to c58e23f, not these repairs. A fresh clone of the remote feature
branch still lacks this local follow-up and its new handoff artifacts.
Configured write access to that exact repository is needed to push, update
PR #1 and verify actual remote CI. No email, merge or public deployment occurred.

## Remaining gaps

No Flight Recorder UI, genuine two-model messaging/accepted handoff, source
authentication, independent replay of historical tests or complete original Git
scope attestation. Gate and executor are unauthenticated; no public deployment
readiness is claimed. No general-purpose transcript redactor or atomic trusted
import exists. Full dependency audit retains the development-only braces
advisory. CI action SHA pinning/minimal permissions and broader Docker/service
qualification remain outside this bounded repair.

Private Concord databases/exports, transcripts and credentials stay out of
Git. The walkthrough requires no private records; optional local historical
inspection is expressly non-portable and read-only.
