# Independent persistence qualification — local execution receipt

**Overall product: FAIL/HOLD.** The local repairs and test evidence below are
real; operational integration is not completed or enabled. No release, external
approval or two-model collaboration is asserted.

Checkout: `/home/nur/Projects/archeagent-final-staging`.
Branch: `integration/archeagent-final-local`.
HEAD unchanged: `25d14a9a5c47992e7e4d4198eb97a89c536de61a`.
Changes remain local and uncommitted. Existing work was preserved.

## Independence and gate outcome

Two fresh, separate model contexts were dispatched with source-read-only
instructions and permission only for their own disposable diagnostic files and
stores. They authored new negative cases; they did not merely rerun the existing
suite. Their review is **internal peer review**, not external human/third-party
approval. Their scripted Concord clients are not Codex MCP model sessions and
do not satisfy the product's genuine two-session collaboration gate.

| Gate | Current status | Evidence / limit |
| --- | --- | --- |
| Independent native acquisition/persistence qualification | PARTIAL/HOLD | New failures were reproduced and six repaired-source cases were executed separately. The review service blocked the native reviewer's final response; no completed final sign-off is available. |
| Independent IPC/actor/lifecycle review | PASS, scoped | Separate reviewer completed its report and fresh custom negatives after repairs; all final 21 source/binary hashes match. This does not qualify native acquisition or the entire product. |
| Capacity behavior | PASS, finite contract | Real native limits and confined retry refusal tested; no automatic compaction. |
| Compaction/retention longevity | PARTIAL/HOLD | Archive-first design prepared, not implemented or approved. Exact replay at native capacity still refuses. |
| Guarded operational Concord supervisor / real-source recorder | FAIL/HOLD | Still disabled; no authentic Flight Recorder route has been implemented. |
| Source-bound execution collector | PARTIAL/HOLD | Pure process/signature/tree helpers exist; native sources now included. Collection/storage/task joins remain disabled. |
| Genuine second-Codex-session gate | HOLD | No second session launched; no genuine operational collaboration asserted. |
| Complete integrated UI/build acceptance | PARTIAL/FAIL | Partial current fixture-workbench browser checks completed. Final build hit a root-owned cache permission failure; complete integrated recorder UI cannot be tested. |

Separate IPC report:
[REVIEW.md](../../.local-audit/durable-ipc-review-20261013-mIO9Fwmt/REVIEW.md).
Native independently generated witnesses:
[results.json](../../.local-audit/qualification-broker-20261013-b74a/results.json).
These files are ignored private evidence, not publication artifacts.

## Confirmed findings, repairs and negative evidence

1. **Native directory enumeration could accept an older prefix on EIO.**
   The reviewer acknowledged two records, then injected `readdir` EIO after the
   first snapshot entry. The original broker returned generation 1 successfully
   while generation 2 still existed. Recovery now checks errno on every directory
   read, in both recovery and missing-authority enumeration, and checks directory
   close errors. Fresh failure injection refuses with no GET response; both
   records remain intact. A supplied accurate generation floor also limits
   rollback, but did not excuse the original cold/default-floor defect.
2. **Malformed worker IPC did not fence already queued requests.** INIT,
   malformed operation and valid `start_work` in one stream yielded exit 1 plus
   a real successor task/invocation/retry snapshot. Invalid JSON, strict-schema
   extra field and unknown frame kind each reproduced this. A terminal failure
   latch now blocks both new frame admission and already-parsed FIFO successors.
   All three independent repaired-source retests return only the INIT response.
   Normal supervisor calls are serialized; no host write or actor escape was
   demonstrated by this direct-private-worker case.
3. **Restart could create new metadata in a replaced store pathname.**
   Descriptor confinement preserved acknowledged bytes in the original moved
   inode, but restart created a key/lock in an empty replacement before refusing
   its generation floor. The same supervisor now retains its acquired device/
   inode and rejects substitution before launching another publisher. Independent
   retest leaves the replacement empty and original generations intact. This is
   a same-UID availability hardening, not proof that privileged directory moves
   are prevented or that cold recovery is externally anchored.
4. **Execution-tree policy omitted `native/`.** A separately authored fixture
   changed native broker source without changing the manifest digest. The fixed
   tree policy includes native sources; the new regression and independent
   mutation now change the digest. This repairs a dormant binding omission, not
   a completed collector or model-source authentication claim.

Parent RED evidence: 4 failed / 3 passed for native EIO and pipelined IPC;
1 failed / 16 skipped for the targeted restart case; 1 failed / 9 passed for the
native-tree omission. Final combined relevant GREEN: **34/34 tests, 4 files**.
An intermediate repair run failed C compilation under `-Werror` for misleading
indentation; this was corrected, not hidden or reported as a passing run.

Independent new native syscall cases: file fsync EIO and partial write ENOSPC
produce no ACK/no new name; directory fsync EIO produces no ACK but may leave
a recoverable linked generation; newest-snapshot read EIO refuses instead of
fallback. Prior acknowledged bytes were preserved. These are injected process
tests, not physical hardware power-loss tests. Attempts to forge SQLite-reserved
schema names were blocked during fixture preparation and **do not count as
successful malicious-restore negative tests**.

The IPC reviewer separately exercised copied actors/options/nested arguments,
actual captured task/invocation/UUID attribution, durable errors versus success,
changed-request fencing, recipient-only privacy after restart, multiple FIFO
restart barriers, terminal close, and captured-but-unpublished recovery.
A stopped actual worker timed out after **15,009 ms**, held subsequent requests,
then recovered/retried to exactly one task/invocation/retry. Its initial attempt
to stop only the outer wrapper was invalid and remains excluded.

## Exact executed checks

Working directory is this checkout unless stated otherwise.

| Command | Actual outcome | Private receipt |
| --- | --- | --- |
| `pnpm exec vitest run tests/concord-persistence-capacity.test.ts` | Exit 0, 3/3 tests | `.local-audit/qualification-gate-20261013/capacity-final.log` |
| `pnpm exec vitest run tests/concord-persistence-errors.test.ts tests/concord-durable-ipc.test.ts tests/concord-durable-state.test.ts tests/concord-tree-manifest.test.ts` | Exit 0, 34/34 tests / 4 files | `qualification-gate-20261013/independent-regressions-green-final.log` |
| `node scripts/verify-concord-durability.mjs` after repairs | **Exit 1**, stopped at production build | `durable-verification-z0rJQq/receipt.json` |
| Its native build and `node --import tsx scripts/concord-storage-verify.ts` | Exit 0, 25/25 confinement probes | `durable-verification-z0rJQq/native-build.log`, `isolation-25.log` |
| Its focused durable/IPC/confinement/adapter suite | Exit 0, 29 host tests / 4 files; adapter wrapper separately requires 29 nested passes | `durable-verification-z0rJQq/focused.log` |
| Its separate seed process + fresh recovery process | Both exit 0; source identity/task/event/ownership/handoff metadata preserved | `durable-verification-z0rJQq/fresh-parent-seed.log`, `fresh-parent-recovery.log` |
| Its isolated PostgreSQL/Redis `pnpm test` | Exit 0, **554/554 tests / 46 files**, no suite failures/skips reported | `durable-verification-z0rJQq/full-tests.log` |
| `pnpm exec tsc --noEmit --incremental false` | Exit 0 after repairs | `durable-verification-z0rJQq/typescript.log` and `qualification-gate-20261013/typecheck-after-review.log` |
| `pnpm lint` | Exit 0 after repairs | `durable-verification-z0rJQq/lint.log` |
| `ARCHEAGENT_LOCAL_BUILD=completion pnpm build` | **Exit 1**, EACCES unlinking root-owned build cache | `durable-verification-z0rJQq/production-build.log` |
| `pnpm verify:formal` | Exit 0; safe 19,554 distinct / 92,577 generated states, depth 18; unsafe TLC exit 12 expected | `qualification-gate-20261013/formal.log` |
| `pnpm benchmark:provider:validate` | Exit 0, fixture harness only | `qualification-gate-20261013/provider.log` |
| `pnpm benchmark:routing` | Exit 0, synthetic mechanics only | `qualification-gate-20261013/routing.log` |
| Earlier in this pass, Go cwd: `go test -race -count=1 -json ./...`, `go vet ./...`, `go mod verify` | All exit 0; race 28 top-level tests / 82 cases / 2 packages. **Not rerun by final wrapper after its build failure.** | `durable-verification-JXPC9m/go-race.log`, `go-vet.log`, `go-modules.log` |
| `sha256sum -c .local-audit/durable-ipc-review-20261013-mIO9Fwmt/source-hashes.after` | Exit 0, 21/21 matched | Parent tool receipt and independent report |

Paths in the receipt column are relative to `.local-audit/` where abbreviated.
The earlier `durable-verification-JXPC9m/receipt.json` completed all stages with
548 tests **before** these repairs. It is not a final-source build receipt.
The later wrapper used only new owned scratch services on 25469/26379, then
removed its own label-verified containers and fixture; existing services and
other runs' retained witnesses were untouched.

Permission diagnosis: current user `nur` uid 1000; `.next-local-completion/build`
and its `package.json` are owned by root. Build directory mode is 0755; file mode
0664. No permission change, sudo, cache replacement or deletion was performed.
The temporary owned preview on 127.0.0.1:34685 was stopped; existing previews
were not stopped. Approval/direction is required before repairing that ownership.

## Browser evidence and preserved assets

A separate loopback preview of the earlier successful build showed the current
fixture workbench, not the older preview's landing page. Chromium observations:
1440x1000 dark layout and 390x844 light layout had no horizontal document overflow;
AXUNO Exact Local Preview was loaded; keyboard Enter selected rejected FastFix
while the explicit fixture winner stayed VerifiedPatch. Theme control and
live selected-candidate status were observed. With normal motion emulated,
13 running infinite animations had advancing time. The browser's ordinary
reduced-motion preference disabled those animations as expected. Temporary
viewport/media overrides were reset.

This is **partial browser verification**, not all controls, screen-reader/contrast
certification, cross-browser/device performance, complete light/dark matrices
or an authenticated Flight Recorder. After the final build permission failure,
the partial preview was stopped; no current acceptance URL is claimed.
Private screenshot:
[`ui-desktop-dark.png`](../../.local-audit/qualification-gate-20261013/ui-desktop-dark.png).
No font/source visual system was changed in this pass. Exact AXUNO hash stayed
`ca6332a0acc33002e6a9b61f15ab3b4e53940e6bec33bbee473464e7b916673d`;
the asset remains ignored/untracked. Private state and evidence remain ignored.

## Reproduction and second-session hold

For owned disposable fixtures only:

```bash
cd /home/nur/Projects/archeagent-final-staging
pnpm exec vitest run tests/concord-persistence-errors.test.ts tests/concord-durable-ipc.test.ts tests/concord-durable-state.test.ts tests/concord-tree-manifest.test.ts tests/concord-persistence-capacity.test.ts
# Full wrapper creates its own scratch PostgreSQL/Redis services. It will still
# fail at the build until the root-owned output issue has been resolved.
node scripts/verify-concord-durability.mjs
```

Do not run bare integration tests against default database/Redis URLs; they
truncate/flush fixture data. Native fault tests use their own compiled binary
and test-only libc injection; production launch arguments remain unchanged.

The second-session gate is **NOT READY**. Required before supplying an executable
operational launch handoff: completed native independent qualification, approved
retention architecture, guarded real-provenance durable supervisor/acquisition,
authenticated source projections, receipt capture/task/tree/result joins, valid
fresh build and browser controls, and targeted session/MCP trace collection.
No placeholder capture UUID or scripted actor may substitute for those inputs.
The current launcher is intentionally non-operational.

Fresh guard checks executed:

```text
node --import tsx scripts/concord-local-init.ts
  -> expected exit 1, held before real initialization
node --import tsx scripts/concord-local-mcp.ts --actor held-auditor --capture-run 00000000-0000-4000-8000-000000000001
  -> expected exit 1, held; diagnostic synthetic UUID, NOT a launch recipe
node --import tsx scripts/concord-local-check.ts
  -> expected exit 2, collection disabled
```

Do not launch the second Codex session. No real source, MCP model session,
execution collector or Flight Recorder was enabled. SHA-256 denotes content
integrity; local HMAC/Ed25519 authorities do not attest a model or external review.
No Git commit/push/merge/PR, deployment, public font publication or email occurred.

## Files changed by the parent for this continuation

- `native/concord-persistence.c`
- `scripts/concord-durable-worker.ts`
- `src/server/concord/durable-supervisor.ts`
- `src/server/concord/tree-manifest.ts`
- `tests/concord-durable-ipc.test.ts`
- `tests/concord-durable-state.test.ts`
- `tests/concord-tree-manifest.test.ts`
- Added `tests/concord-persistence-capacity.test.ts`,
  `tests/concord-persistence-errors.test.ts` and
  `tests/fixtures/concord-readdir-fault.c`.
- Added this receipt and
  `docs/concord/PERSISTENCE_LIMITS_AND_RETENTION_2026_10_13.md`; updated durable
  state/product summary links to this newer evidence.

Private audit scripts, binaries, logs, hashes, screenshot and disposable retained
stores are evidence artifacts, not authenticated product records. Unattributed
concurrently appearing files and earlier fixtures were preserved, not claimed as
this pass's changes or removed. No unrelated repository was modified.
