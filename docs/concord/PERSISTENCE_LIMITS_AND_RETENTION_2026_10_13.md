# Persistence limits and retention — current contract, proposed extension

Status: **current limits exercised; longevity qualification held**. This is
not permission to change quotas, prune acknowledged records, enable real sources
or claim a production retention policy. The product remains **FAIL/HOLD**.

## Current, executable behavior

`tests/concord-persistence-capacity.test.ts` uses the actual native publisher
and confined worker. Its three tests characterize existing limits, without
changing production code. Native capacity payloads are explicitly opaque
synthetic bytes, not Concord database images or model activity.

| Limit | Last accepted boundary | Refusal and recovery |
| --- | --- | --- |
| 512 generation records | Generation 512 is published and acknowledged | 513 receives no ACK. Existing names/last record bytes remain unchanged. A new broker retrieves generation 512. |
| 256 MiB generation bytes | Exactly 268,435,456 bytes, including each record's 84-byte framing/tag overhead | An additional one-byte payload would require 85 bytes and is refused without ACK. Names/last record digest are unchanged; a new broker retrieves generation 11 and its exact payload. |
| 10,000 retry records | A real `inspect_work` call creates row 10,000 after 9,999 explicitly synthetic seeded rows | A new UUID is refused before its handler runs, with no new checkpoint. Restart recovers 10,000 rows; the exact already-acknowledged UUID returns the original result. No rejected task is created. |

The 256 MiB quota counts generation file lengths, **not** allocation overhead,
filesystem metadata, the authority key or lock metadata. ENOSPC/fsync failures
are separate refusal cases; a byte-count test is not proof of power-cut behavior.
The 10,000 test does not claim 10,000 genuine invocations. Ordinarily the 512
checkpoint cap can be reached first, and reads/retries also publish generations.
A separately authored native-review probe composed a real saved retry with a
512-generation store: even that exact UUID was refused because its replay still
requires a new checkpoint. Restart preserved the task, invocation and retry
metadata. Exact replay at the retry-row cap is not replay availability at the
native generation/byte caps. Those latter availability limits remain unresolved.

At native quota refusal the supervisor must return no durable ACK, fence its
worker and require explicit recovery. Any unpersisted worker changes are not
accepted completion. A corrupt/gapped newest chain is refused, not replaced
with an older checkpoint. No current cleanup procedure deletes acknowledged
generations or retry records. Do not remove private retained witnesses belonging
to another run as a way to clear a quota.

Current independent-context qualification and its remaining gates are recorded
in [the review execution receipt](INDEPENDENT_QUALIFICATION_RECEIPT_2026_10_13.md).

Reproduction, using only newly owned disposable fixture state:

```bash
cd /home/nur/Projects/archeagent-final-staging
pnpm exec vitest run tests/concord-persistence-capacity.test.ts
```

The initial test-harness run failed with a test-worker heap abort during deep
comparison of a large Buffer. Replacing that assertion with `Buffer.equals`
made the boundary test executable; neither the native quota nor runtime was
changed. The failed and successful receipts remain private under
`.local-audit/qualification-gate-20261013/`.

## Retention approaches and recommendation

1. **Keep today's finite fail-closed store:** safest immediately; preserves all
   acknowledged history, but cannot support long-running operation past a cap.
2. **Recommended future extension: archive-first sealed epochs:** permit a new
   active checkpoint epoch only after the complete prior epoch and its recovery
   anchor have been durably sealed, authenticated and independently re-read.
   History remains retained, and quota changes are explicit operator policy.
3. **Discard old generations / forget old retry UUIDs:** rejected. This destroys
   acknowledged evidence and can repeat a previously acknowledged operation.

## Proposed archive-first architecture — NOT implemented or approved

This changes native acquisition, the on-disk format, quota accounting, restore
and retry lookup. It requires a written implementation plan and separate review
before code. Raising constants alone is not compaction or qualification.

- Keep SQLite in its original private tmpfs. Only a separate non-SQLite native
  authority acquires persistent storage. Pin the approved state root and archive
  directories by descriptors; apply no-symlink/no-magiclink/beneath acquisition,
  ordinary-file ownership/mode/single-link checks and fixed writable mounts.
  Do not pass archive paths, descriptors or keys to the SQLite worker.
- Use immutable sealed epochs with global monotonic generation numbers,
  predecessor root, source/run identity, exact original record inventory and a
  current-state recovery anchor. Preserve each acknowledged generation's bytes
  and digest in the archive, even when the active index becomes compact.
  HMAC binds the local storage authority, not a model or an external reviewer.
- Publish every archive member/index through unnamed files, file fsync,
  no-overwrite atomic naming and directory fsync. Independently read/verify the
  complete sealed epoch before publishing a new authenticated active-head
  record. A head ACK follows its own file and directory fsync. Never delete or
  unlink the retained archive as part of this transition.
- Recovery distinguishes old head only, sealed-but-unreferenced epoch, and
  new head pointing to a complete epoch. Missing, contradictory or corrupt
  referenced content is HOLD, not fallback. Interrupted transitions remain
  recoverable without silently losing an acknowledged generation.
- Separate active-window limits from the explicitly approved **total retained
  history budget**. Sealing an epoch does not make disk consumption disappear.
  Under the current 256 MiB aggregate budget, archival alone cannot authorize
  more bytes. At an approved total-budget/free-space threshold, stop admission
  before domain execution and keep reads/recovery available where safe.
- Retry rollover must retain an exact authenticated UUID/actor/tool/argument
  digest/original-result index across epochs. Lookup precedes execution.
  A compacted live SQLite retry table may be replaced only after native
  archived lookup is implemented, privacy-bounded and crash-qualified.
  Divergent reuse is rejected; exact reuse returns the original response.
  Never prune UUIDs and then treat them as new. Until that mechanism is reviewed,
  the 10,000 retry cap stays fail-closed.
- The caller's recovery floor remains an explicit trusted input. Neither an
  epoch digest nor a new head defeats coherent rollback by an administrator
  controlling all storage and its floor. An external monotonic anchor would
  require an additional, separately authorized architecture.

Required acceptance probes before longevity claims: kill at every archive/head
publication stage; file/directory fsync failures; ENOSPC; late main/archive/index
symlinks and hardlinks; altered/truncated inventories; omitted epochs; divergent
global generations; exact/divergent retry reuse across rollover; concurrent
clients at admission/sealing; repeated fresh-parent recovery; bounded archive
reads; no outside target writes; and original acknowledged history still
independently retrievable. No unlimited-longevity, encryption-at-rest or hardware
power-loss claim is authorized by this design.

Decision needed before implementation: approve archive-first sealed epochs and
an explicit retained-history budget, or keep the current finite refusal model.
No acknowledged history may be silently deleted in either choice.
