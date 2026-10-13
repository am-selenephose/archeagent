# Durable-state adversarial continuation — four reproduced defects repaired

Date: 2026-10-13, Asia/Karachi.
Checkout: `/home/nur/Projects/archeagent-final-staging`.
Branch: `integration/archeagent-final-local`.
HEAD unchanged: `25d14a9a5c47992e7e4d4198eb97a89c536de61a`.
**Repair regression gates: PASS. Independent qualification: PARTIAL.
Product and publication: FAIL/HOLD.**

This was the parent implementer's own adversarial review with disposable owned
fixtures, not a separate auditor or genuine Concord-linked two-model session.
No external independent approval is claimed. The earlier green execution did
not cover the defects reproduced below.

## Reproduced failures and implemented fixes

| Defect | RED before repair | Repair and GREEN proof |
| --- | --- | --- |
| Replaceable publisher exclusion | Replacing `owner.lock` admitted a second supervisor while the first publisher lived | Exclusive non-blocking `flock` now belongs to the pinned directory descriptor; leaf replacement cannot admit a second publisher and the original publisher can continue |
| Restart/request race | A request submitted immediately after `restart()` was rejected during teardown | Restart is synchronously placed in the same bounded FIFO as calls/metadata; both tasks submitted around the barrier now complete and are recoverable |
| Nonterminal close | `restart()` after `close()` resolved and reopened the worker | Closure blocks admission/restart immediately, drains already-admitted work and shares idempotent cleanup; restart/client calls after close reject |
| Schema lookalike omission | A fixture-authority-signed snapshot containing added table `sqliteX_unapproved` passed restore | Replace SQL LIKE wildcard filtering with literal `substr(name,1,7) <> 'sqlite_'`; lookalike schema is rejected before admitting a runtime |

RED command:

```bash
pnpm exec vitest run tests/concord-durable-state.test.ts \
  -t 'late lock-file replacement|serialized barrier|close terminal'
```

Actual exit 1: all three new regressions failed for those observed behaviors.
The separate filtered malicious-manifest test also returned exit 1 before repair
because the lookalike schema was accepted. Per-fix checks then returned exit 0.
Final unfiltered checks below include all cases, not filtered development skips.
The invalid signed restore used only an owned fixture key; it is not evidence
of production-key compromise, model identity or authenticated caller JSON.

The repaired directory lock retains the existing native openat2/descriptor-bind
boundary. SQLite still receives no writable host storage, publisher descriptor
or key. Anonymous immutable publication, HMAC history, fsync ordering and
actor/inbox guards are unchanged.

## Fresh executed gates after source repairs

Logs: `.local-audit/durable-review-20261013/`.

| Exact command | Actual outcome | Receipt |
| --- | --- | --- |
| `pnpm exec vitest run tests/concord-durable-state.test.ts tests/concord-durable-ipc.test.ts tests/concord-sqlite-confinement.test.ts tests/concord-local-adapter.test.ts` | Exit 0; 25 host tests / 4 files passed | `focused-green.log` |
| Owned URLs below + `pnpm test` | Exit 0; 545 host tests / 44 files passed | `full-tests.log` |
| `node --import tsx scripts/concord-storage-verify.ts` | Exit 0; exact 25 probes, unchanged outside bytes/hash/inode/size/mtime and no outside creation | `isolation-25.json` |
| Fresh fixture + `node --import tsx scripts/concord-durable-fixture.ts seed <fixture>` and separate `recover <fixture>` | Both exit 0; matching metadata and correct owner/handoff retrieved | `fresh-parent-seed.log`, `fresh-parent-recover.log` |
| `pnpm exec tsc --noEmit --incremental false` | Exit 0 | `typescript.log` |
| `pnpm lint` | Exit 0 | `lint.log` |
| `ARCHEAGENT_LOCAL_BUILD=completion pnpm build` | Exit 0, existing routes retained | `build.log` |
| Executor `go test -race -count=1 -json ./...` | Exit 0; 28 top-level tests / 82 cases / 2 packages, zero failures | `go-race.jsonl` |
| Executor `go vet ./...` and `go mod verify` | Both exit 0 | `go-vet.log`, `go-mod.log` |
| `/usr/bin/cc -std=c11 -Wall -Wextra -Werror -fsyntax-only native/concord-persistence.c` | Exit 0; actual native builds also run in test setup | Parent tool receipt |

The host adapter wrapper separately enforces the same 29 nested confined
protocol cases; do not silently add nested cases to host totals. The durable
suite now has sixteen cases and the schema-negative also checks its added
lookalike fixture. None of these are genuine model-session tests.

Full-suite environment was exactly:

```text
ARCHEAGENT_TEST_DATABASE_URL=postgres://archeagent_test:archeagent_local_test_only@127.0.0.1:25469/archeagent_test
ARCHEAGENT_TEST_REDIS_URL=redis://127.0.0.1:26379/15
```

Two newly created scratch containers were used, labelled
`codex.audit=archeagent-durable-review-20261013`. Their exact IDs/labels were
verified before stopping them. Temporary test data and all owned fixture stores
were removed and are recreatable, not activity evidence. Existing production
services and user preview were neither reused nor stopped.

Fresh-parent recovery preserved two tasks, event high-water ID 5, ownership-event
high-water ID 3, one handoff, five audit invocations and five retry records, with
identical source/run identity. The build owner remains `reviewer` and its two
offer/accept entries remain present. These are actual Concord tool/store
operations driven by scripts, not genuine model collaboration or code review.

Actual held CLIs were rerun: initializer exit 1, launcher exit 1, collector
exit 2, each with its expected hold. No real source was created. AXUNO checksum
and user preview were preserved. No recorder route or agent was enabled.

## Changed files in this continuation

- `native/concord-persistence.c` — directory-inode publisher exclusion.
- `src/server/concord/durable-supervisor.ts` — serialized restart/terminal close.
- `scripts/concord-durable-worker.ts` — exact reserved-prefix schema check.
- `tests/concord-durable-state.test.ts` — lifecycle/lock regressions, lookalike
  negative and cleanup of unexpectedly adopted test supervisors.
- This report, `DURABLE_STATE_AND_RECOVERY.md`,
  `DURABLE_EXECUTION_RECEIPT_2026_10_13.md`, `LOCAL_PRODUCT_COMPLETION.md` and
  `LOCAL_EXECUTION_LEDGER.md` — current review pointers and historical labeling.

No UI/evaluator/font, dependency, Go implementation, release authority or
unrelated work changed in this continuation. No commit/push/merge/PR/deployment,
email or font publication occurred; HEAD and earlier dirty work are preserved.

## Reproduction and remaining holds

Full reproduction: `node scripts/verify-concord-durability.mjs` from this
checkout, using the documented native prerequisites, owned fixtures and unused
ports. Do not run integration tests against default production service URLs.
See [the architecture/acknowledgement handoff](DURABLE_STATE_AND_RECOVERY.md).

External independent review of the new native persistence/IPC layer remains
uncompleted. This parent review cannot satisfy that distinction. Hardware power
loss, malicious host-owner/coherent rollback, encryption at rest, automatic
compaction, new browser acceptance and genuine two-session model collaboration
are not established here.

Real-source initialization, agent launch, recorder, receipt collection and
publication remain disabled. Repaired local test PASS is not authority to
enable them. The earlier 542-test receipt is preserved as historical evidence
of its run, not proof against these subsequently discovered defects.
