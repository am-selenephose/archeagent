# Persistence capacity and retention qualification, 2026-10-13

Scope: local Archeagent staging harness only. **Product FAIL/HOLD.** Native limits are hard refusals, not compaction, and no real-source integration is authorized.

## Executed independent-process boundary probes

Separate synthetic-broker processes and fresh stores under .concord/test-harness were used. The tester is not a separate human/third-party security auditor.

- **512 generation ceiling: PASS.** Acknowledged 512 synthetic checkpoints, #513 refused, a newly launched publisher recovered 512 without losing the last payload; 512 entries retained. Evidence: .local-audit/independent-review-20261013/generation512-limit.json, job d1ff253988ecd026 exit 0.
- **256 MiB ceiling: PASS.** 63 x 4 MiB checkpoints ACKed, the next refused, new publisher recovered 63 with exact latest payload. Retained signed data 264246444 bytes, below 268435456. Evidence: size256m-limit.json, same exit-0 job.
- **10000 unique retry ceiling: PASS.** Newly created disposable fixture snapshots were populated with synthetic retry identities and HMACed with their own test authority. At 9999 existing entries, one new valid UUID was durably ACKed as generation 2, recovery reported 10000. At 10000 existing entries, a new valid UUID received no ACK and recovery preserved 10000 in generation 1. Evidence: retry-9999-limit.json, retry-10000-limit.json, job c706dd2008afcebf exit 0. Prior failed trial with malformed request UUID does not count.

These tests do not establish 512 real model operations, genuine sessions, power-loss durability or production longevity. Synthetic signed stores remain present and were not silently deleted.

## User-visible semantics at capacity

Native #513 dies before publishing/ACKing. Total-size refusal occurs before publishing/ACKing an oversized new record. After retry-ledger saturation, a new unique request is refused before domain execution; any pending worker failure fences the supervisor. Restart may recover acknowledged history but cannot make progress through a native hard limit. It must never report an operation result as durable without its generation acknowledgement. Even duplicate responses presently require another native generation and may hit 512/256 MiB first. There is no automatic compaction or deletion; all three limits remain permanent production blockers.

## Required compaction/retention design (NOT implemented)

1. Preserve native filesystem/actor boundaries. Keep broker-only write authority, openat2 pinned directory, O_TMPFILE + atomic link + fsync-before-ACK, no SQLite worker writable host mount, and no caller-selected path/key.
2. Define a versioned v2 segment-epoch format in a new owned immutable store; never overwrite v1 generations in place. Record sourceInstanceId, captureRunId, original generation/chain-tip digest, last acknowledged logical sequence, source/tree execution identities, task/event/ownership/inbox high-water marks, retry index root and source-evidence inventory.
3. Rebuild a candidate base and independent full replay in a separate process. Require byte-equivalent canonical task state, audit/inbox/owner/handoff histories, original response bytes for every retriable request, and independently verifiable source execution receipts. Refuse unknown records or differences.
4. Checkpoint/flush all candidate files and recovery proofs first. Signed activation witness must bind old and new epoch roots and a monotonic floor; only then atomically switch the active epoch. Crashes before switch preserve old authority, after switch require exact new epoch, and ambiguous ACKs must fence. Coherent privileged rollback of store plus witness is not prevented without an independent monotonic anchor.
5. Do not delete acknowledged history silently. Retain the original epoch after activation. Reclaim only under explicit operator approval and a recorded retention decision, following a separately recoverable, hash-verified complete archive and restore verification. Missing archive or ambiguous approval = HOLD, no cleanup.
6. Preserve exact UUID idempotency forever within an active source/run epoch: actor, tool, request digest and original response must survive compaction. No probabilistic-only index, truncated tombstone or replay of a changed request. Shard immutable retry indexes as needed; do not simply reset the 10000 counter.
7. Add metadata-only capacity telemetry for byte/generation/retry counts, remaining headroom, worst-case next snapshot and archive status; warn before limits. At hard limit, refuse writes, preserve readonly audit/export and give an explicit operator-facing action, never a hidden history deletion.
8. Resolve encryption-at-rest, key rotation, archive privacy, recovery authority and suitable power-cut testing before authentic or sensitive source data is admitted.

## Acceptance gate for a future v2

Independently review crash boundaries (file sync, link, directory sync, activation), hostile path aliases, corruption, missing key, partial archive, recovery rollback, 10000 mismatched UUID/actor/payload replays, every event high-water, source/tree/result identity, actor privacy, and resource/time ceilings. Require real source bound read-only recorder validation after, not before, storage qualification. A test run from the same implementer or separate local model is not third-party external approval.

**Today:** capacity probe PASS; compaction/retention design PARTIAL (no implementation or archive migration); independent qualified review PENDING; product FAIL/HOLD.
