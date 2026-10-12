# Concord MCP + Archeagent: review evidence boundary

This integration consumes real local Concord MCP artifacts and uses Archeagent
to check that task ownership, file scope, finish-work history and review packet
evidence agree. Concord coordinates agents; this bridge checks the consistency
of supplied reports, not their truth or origin. Archeagent's separate execution
and release checks remain required. Passing this gate NEVER authorizes release.

## Local integration workflow

1. Install Concord MCP 0.13.0 (locally or via npm) and inspect its setup changes.
2. In an isolated checkout use the coding-agent MCP tools: start_work,
   inspect_work, update_work, transfer_work, finish_work.
3. When a task is finished, the builder calls finish_work with
   outcome=review_ready, changed_files, tests_run, guardrails_checked,
   provenance and any known risks.
4. Concord generates .concord/WORK_STATE.json, REVIEW_PACKET.md and
   events.jsonl. The SQLite database and exported artifacts stay local.
5. From the repo root run: pnpm concord:gate TASK-ID
6. The gate returns READY_FOR_INDEPENDENT_REVIEW or BLOCKED, details for
   each check, and a reproducible SHA-256 digest of the supplied local
   records. The digest is not a provenance signature. Source authentication
   is always false, evidence source is caller_supplied, digest meaning is
   content_integrity_only and release authorization is always false.
7. Optional API: POST /api/integrations/concord/review-gate with JSON
   taskId, workState, reviewPacket and eventsJsonl.

The gate checks missing reported review evidence, mismatched task identity,
claimed files against bounded canonical lexical repository-relative paths,
unique packet sections, internally contradictory reports, event ordering/latest
finish state, and normalized active competing file claims. It does not authenticate supplied records or
independently execute their reported tests.
Even after a pass, an independent reviewer must run tests and examine
security, contracts and release policy. Agent-reported evidence is not proof.

The October 12 audit reproduced and repaired path-alias collision bypasses,
ambiguous/code-only packets, contradictory reports and ineffective body/error
bounds. The endpoint measures actual bytes (262,144 maximum), strictly decodes
UTF-8 and returns fixed errors. The CLI reads bounded regular UTF-8 exports,
rejects symlinked exports and redacts errors. See
[the audit findings](concord/AUDIT_FINDINGS.md),
[the independent handoff](concord/RECRUITER_HANDOFF.md) and
[asserting local walkthrough](concord/WALKTHROUGH.md).
The endpoint has no authentication, rate limiting or body deadline; do not
expose it as trusted ingest. No authenticated Flight Recorder UI is included.

## Tests

Run: pnpm exec vitest run tests/concord-review-gate.test.ts tests/concord-review-api.test.ts tests/concord-review-cli.test.ts

This is a bounded integration exercise, not an upstream contribution to
Concord and not a claim that two autonomous models collaborated.

## Live protocol verification, October 12, 2026

Concord MCP 0.13.0 was invoked through two independent MCP SDK client
connections against the same isolated Archeagent checkout. The two client
identities were declared protocol actors, not autonomous models.

- start_work: ARC-CONCORD-001 claimed the review gate file
- start_work: ARC-CONCORD-OVERLAP-002 claimed the same file; Concord returned
  one overlap referring to ARC-CONCORD-001
- transfer_work(action=release): collision owner released its claim
- finish_work(outcome=review_ready): review packet and finish events exported;
  no recipient delivery or acceptance is established
- pnpm concord:gate ARC-CONCORD-001: READY_FOR_INDEPENDENT_REVIEW
- Independent release authorization: **false** (by design)

The original local records contain no messages/endpoints, no bound model-session
metadata and no reviewer correction loop. Their reported tests were literal
script inputs; actual execution must be checked separately.

The local SQLite, full event stream and packets stay in .concord/ and are
excluded from the public repository. This validates the MCP tool behavior and
the Archeagent bridge, not an end-to-end two-model autonomous run.
