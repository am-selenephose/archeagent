# Concord MCP + Archeagent: review evidence boundary

This integration consumes real local Concord MCP artifacts and uses Archeagent
to check that task ownership, file scope, finish-work history and review packet
evidence agree. Concord coordinates agents. Archeagent independently verifies
their work. Passing a Concord gate NEVER means merge/release authorization.

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
   records. The digest is not a provenance signature.
7. Optional API: POST /api/integrations/concord/review-gate with JSON
   taskId, workState, reviewPacket and eventsJsonl.

The gate blocks missing review evidence, mismatched task identity, claimed
files beyond the declared scope, and any active competing file claim.
Even after a pass, an independent reviewer must run tests and examine
security, contracts and release policy. Agent-reported evidence is not proof.

## Tests

Run: pnpm exec vitest run tests/concord-review-gate.test.ts

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
- finish_work(outcome=review_ready): review packet and events exported
- pnpm concord:gate ARC-CONCORD-001: READY_FOR_INDEPENDENT_REVIEW
- Independent release authorization: **false** (by design)

The local SQLite, full event stream and packets stay in .concord/ and are
excluded from the public repository. This validates the MCP tool behavior and
the Archeagent bridge, not an end-to-end two-model autonomous run.
