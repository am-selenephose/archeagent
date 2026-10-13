# SQLite acquisition repair — qualified ephemeral boundary, product HOLD

Date: 2026-10-13, Asia/Karachi.
Checkout: `/home/nur/Projects/archeagent-final-staging`.
Branch: `integration/archeagent-final-local`.
HEAD remains `25d14a9a5c47992e7e4d4198eb97a89c536de61a`.
All implementation work remains local and uncommitted. Publication hold is active.

**Result: PASS for the fixed-launcher ephemeral SQLite outside-write boundary;
PARTIAL for the requested operational storage architecture; overall product
FAIL/HOLD.** Durable persistence, restart recovery and operational worker/IPC
integration are not implemented. Real-source initialization, MCP launch,
source-bound receipt collection, Flight Recorder integration and the genuine
second-Codex-session gate remain disabled. Passing these tests does not enable
any of those operations.

## Implemented acquisition boundary

The repository now owns disk-backed SQLite acquisition in
`src/server/concord/confined-database.ts`; runtime and companion-store calls
no longer use the upstream pathname acquisition factory directly. Actual
Concord 0.13.0 migration SQL and repository implementations are reused unchanged.
Migration SQL and schema-version advancement commit atomically. Invalid or
future schema versions refuse acquisition, and failed configuration closes the
connection. WAL, foreign-key constraints and normal repository tools remain
functional in the qualified worker.

The safety mechanism is a **fixed filesystem-confined process**, not a path
check, post-open scan, SQLite readonly flag or `/proc/self/fd` trick:

- `isolated-process.ts` invokes the installed `/usr/bin/bwrap` with a fixed
  policy and a fixed choice of two scripted check programs. It accepts no
  executable, mount, workspace, database, SQL or environment override.
- The worker gets a new private 128 MiB writable tmpfs at the literal staging
  `.concord` path. It never mounts host staging state writable. Main databases,
  WAL/SHM/journals, exports and compiler scratch remain in that private state.
- Repository and system runtime dependencies are bound read-only. Root and
  proc are remounted read-only. There is no other writable mount or writable
  device filesystem. The historical hiring worktree/database and common Git
  directory are not mounted into the worker.
- User, mount, PID, IPC and network namespaces are isolated. Capabilities are
  dropped, `NoNewPrivs` is set, further user namespace creation is disabled,
  and inherited environment secrets are cleared.
- `sqlite-confinement.ts` checks actual kernel mount state, private tmpfs,
  canonical compiled scope, read-only surrounding mounts, effective
  capabilities and `NoNewPrivs`. Caller flags do not assert confinement.
- The fixed launcher/descriptor policy and the kernel checks are **one combined
  boundary**. The mount-check helper alone does not qualify arbitrary manually
  constructed namespaces retaining outside file descriptors.
- Host invocation of the repository-owned acquisition refuses before opening
  SQLite. Production-named acquisition remains unconditionally held, including
  inside the qualified test worker; only explicitly scripted harness sources
  are enabled. No fallback to the original stock CLI/store is present.

Why this design: implementing only a non-following main-file open would not
cover SQLite's subsequent sidecar acquisition, checkpoint and cleanup behavior.
A custom VFS would require reviewing all relevant VFS operations and native
locking/shared-memory semantics. This implementation instead removes SQLite's
ability to acquire a writable host file, while retaining the installed native
SQLite and unchanged Concord schema/tool behavior. See the primary
[SQLite VFS contract](https://sqlite.org/c3ref/vfs.html),
[SQLite file-method contract](https://sqlite.org/c3ref/io_methods.html),
[WAL behavior](https://sqlite.org/wal.html) and
[bubblewrap upstream documentation](https://github.com/containers/bubblewrap).
Those contracts explain the design; the local tests below are the actual
qualification evidence for this particular policy.

## Adversarial evidence

`scripts/concord-storage-verify.ts` takes no options. It creates a disposable,
owned outside witness under this repository's ignored `.local-audit` directory.
The existing witness is a valid SQLite database serialized from an in-memory
database, so preparing it does not use an unconfined disk SQLite connection.
A child executes the fixed attack driver, and the host separately compares
contents, SHA-256, inode, size, mtime and the outside directory census. Refusing
an operation is not sufficient: outside files must remain unchanged or absent.
The witness is removed after the test; its result remains in the private log.

Current exact qualification: **25/25 checks**, exit 0, covering:

- Kernel mount/capability boundary and production initializer hold.
- Refusal of nested user/mount namespace creation.
- Direct outside database creation/migration, bypassing application path guards.
- Proc root/cwd/directory-FD aliases, including the visible namespace reaper,
  and a borrowed regular-file descriptor.
- Late main-file symlink replacement at native acquisition, for existing and
  absent outside targets.
- WAL, SHM and rollback-journal aliases, for existing and absent targets.
- Importing outside hardlinks and exporting active database/WAL/SHM hardlinks.
- Late directory replacement and attempted mounted-state reparenting.
- Actual Concord schema version 11, foreign keys, active WAL writer/reader
  snapshots, and refused reader mutations.
- Active WAL and SHM replacement, both existing/absent outside targets,
  checkpoint operations and final connection closure.
- Cleanup after main-file alias substitution, foreign-run refusal and
  `VACUUM INTO` outside the state mount.

The host-observed witness hash before and after is:

```text
fab847047f72803d04f01c63800b9603ea6939cb3202c4d6f34c3247a49c2bd2
```

Inode, size and mtime were unchanged. No outside database, journal, WAL or SHM
was created. The exact receipt contract rejects missing, repeated, failed or
contradictory checks. This is **scripted receipt completeness checking, not
authentication of arbitrary JSON or agent evidence**. SHA-256 is a content
comparison, not source authentication or release authority.

The host regression suite also runs an intentionally unsafe stock acquisition
against disposable owned files. It confirms that the original unprotected
symlink behavior creates an outside SQLite target with schema version 11.
This is an expected negative control, not a use of the real source, and proves
the test oracle can detect the original failure. The unsafe factory is not used
by the repaired runtime.

A separate read-only audit subagent reviewed the current code and independently
reran the verifier and focused tests: both exit 0, 25/25 probes, 6 host tests and
29 required nested adapter tests. It also inspected a disposable worker's PID 1
root/descriptors and found the sandbox root, channels and an eventfd rather than
retained host directory/regular-file descriptors. It reported no actionable
outside-write defect in the fixed-launcher scope. This reviewer is **not a
Concord-linked second model session**, external maintainer acceptance or proof
of operational agent collaboration.

## Fresh check outcomes after the final source changes

Private receipts live under `.local-audit/sqlite-isolation-20261013/`.

| Exact command | Outcome | Receipt |
| --- | --- | --- |
| `node --import tsx scripts/concord-storage-verify.ts` | Exit 0; exact 25/25 probes; unchanged/absent host targets | `host-observed-receipt.json` |
| `pnpm exec vitest run tests/concord-sqlite-confinement.test.ts tests/concord-local-adapter.test.ts` | Exit 0; 6 host tests, 2 files; separately enforces 29 nested adapter passes | `focused-final.log` |
| Isolated URLs shown below + `pnpm test` | Exit 0; 526 host tests, 42 files; separately enforces the nested adapter run | `full-tests.log` |
| `pnpm exec tsc --noEmit --incremental false` | Exit 0 | `typecheck.log` |
| `pnpm lint` | Exit 0 | `lint.log` |
| `ARCHEAGENT_LOCAL_BUILD=completion pnpm build` | Exit 0; existing routes preserved, separate build output | `build.log` |
| In `services/executor-go`: `go test -race -count=1 -json ./...` | Exit 0; 28 top-level tests, 82 cases, 2 packages, no failures | `go-race.jsonl` |
| In `services/executor-go`: `go vet ./...` | Exit 0 | `go-vet.log` |
| In `services/executor-go`: `go mod verify` | Exit 0; all modules verified | `go-mod.log` |
| `git diff --check` and no-index whitespace checks on all 14 repair files | Exit 0; untracked repair files included | Final tool receipt |

Actual production CLI refusal was also rerun after the repair, not merely
inferred from helper tests:

```text
node --import tsx scripts/concord-local-init.ts
  expected/actual exit 1: initialization refused, isolation gate held
node --import tsx scripts/concord-local-mcp.ts --actor builder --capture-run 3b6d57b1-43c7-4c3b-9ec7-5739e2f0905e
  expected/actual exit 1: source launch refused, isolation gate held
node --import tsx scripts/concord-local-check.ts --actor builder --task storage-gate --check tests
  expected/actual exit 2: receipt collection disabled
```

The host `.concord` census afterward contained only an empty `test-harness`
directory: no source identity, Concord database or companion database.

The earlier report's 549-test count included 29 adapter cases in the host run.
Those same 29 now execute in the confined child, represented by one host wrapper;
five new host storage tests were added. Thus 549 - 29 + 1 + 5 = 526. The 29
adapter cases were not deleted or skipped. Do not present them as independently
authenticated model-session evidence or silently add nested and host counts.

Formal release-model, provider/routing benchmark, dependency-audit and browser
results from the earlier pass remain historical evidence in
`LOCAL_PRODUCT_COMPLETION.md`. They were not rerun during this storage-only pass.
In particular, no fresh browser acceptance, Docker executor qualification or
globally clean dependency audit is claimed.

## Independently reproducible commands

Prerequisites verified here: Linux with permitted unprivileged namespaces,
bubblewrap 0.11.2 at `/usr/bin/bwrap`, Node v24.19.0, pnpm 11.20.0, this checkout
and its installed pinned native SQLite/Concord dependencies. The Node executable
must be an owned regular file. The launcher fails closed if these kernel/runtime
requirements cannot be established; there is no host-process fallback.

```bash
cd /home/nur/Projects/archeagent-final-staging
node --import tsx scripts/concord-storage-verify.ts
pnpm exec vitest run tests/concord-sqlite-confinement.test.ts tests/concord-local-adapter.test.ts
pnpm exec tsc --noEmit --incremental false
pnpm lint
ARCHEAGENT_LOCAL_BUILD=completion pnpm build
(cd services/executor-go && go test -race -count=1 ./... && go vet ./... && go mod verify)
git diff --check
```

**Do not run bare full-suite integration tests against default service URLs.**
They issue TRUNCATE/FLUSHDB. The actual full-suite run used these newly created,
labelled, disposable loopback services, not any existing application service:

```bash
# Require these names and ports to be unused; do not reuse production services.
docker run -d --rm --name archeagent-isolation-pg-20261013 \
  --label codex.audit=archeagent-sqlite-isolation-20261013 \
  --tmpfs /var/lib/postgresql/data -p 127.0.0.1:25459:5432 \
  -e POSTGRES_USER=archeagent_test \
  -e POSTGRES_PASSWORD=archeagent_local_test_only \
  -e POSTGRES_DB=archeagent_test postgres:16-alpine
docker run -d --rm --name archeagent-isolation-redis-20261013 \
  --label codex.audit=archeagent-sqlite-isolation-20261013 \
  --tmpfs /data -p 127.0.0.1:26389:6379 redis:7-alpine
docker exec archeagent-isolation-pg-20261013 pg_isready -U archeagent_test -d archeagent_test
docker exec archeagent-isolation-redis-20261013 redis-cli ping
# Proceed only after readiness reports success/PONG.
ARCHEAGENT_TEST_DATABASE_URL=postgres://archeagent_test:archeagent_local_test_only@127.0.0.1:25459/archeagent_test \
ARCHEAGENT_TEST_REDIS_URL=redis://127.0.0.1:26389/15 pnpm test

# Inspect IDs and owner labels; stop only the two fixtures you created.
docker inspect --format '{{.Id}} {{index .Config.Labels "codex.audit"}}' \
  archeagent-isolation-pg-20261013 archeagent-isolation-redis-20261013
docker stop archeagent-isolation-pg-20261013 archeagent-isolation-redis-20261013
```

The actual two scratch containers were stopped after verification; their
temporary test data is discarded and can be recreated using the commands above.
No existing production service was stopped or reused.

## Changed files in this repair, not the earlier dirty worktree

Added:

- `src/server/concord/sqlite-confinement.ts`
- `src/server/concord/isolated-process.ts`
- `src/server/concord/confined-database.ts`
- `src/server/concord/isolation-receipt.ts`
- `scripts/concord-isolation-probe.ts`
- `scripts/concord-storage-verify.ts`
- `tests/concord-sqlite-confinement.test.ts`
- `docs/concord/SQLITE_ISOLATION_REPAIR_2026_10_13.md`

Extended without overwriting earlier implementation:

- `src/server/concord/local-paths.ts`
- `src/server/concord/local-runtime.ts`
- `src/server/concord/private-store.ts`
- `tests/concord-local-adapter.test.ts`
- `docs/concord/LOCAL_PRODUCT_COMPLETION.md`
- `docs/concord/LOCAL_EXECUTION_LEDGER.md`

No AXUNO asset, UI visual shell, evaluator, Go source, dependency version or
unrelated application feature changed in this repair. Earlier changes to those
files remain preserved, not attributed to this pass. Private state/logs/builds
remain ignored. No commit, push, merge, deployment, PR, font publication or
email occurred.

## Remaining HOLD boundaries

The qualified state exists only for the child process lifetime. There is no
durable database export/import, crash-consistent checkpoint protocol, restart
qualification or persistent multi-client worker/IPC source. This architecture
does not yet provide the operational product with durable coordination history.
Do not remove the production hold merely because the ephemeral check passes.

The trusted Linux kernel, installed bubblewrap/native dependencies, repository
code and launcher policy are assumptions. This is not protection against a
host administrator, malicious same-user host process or owner changing trusted
code. The mount-check helper is not an independent universal sandbox verifier.

Genuine model-session collaboration, recorder projections/UI, collector keys,
source/task/tree/result joins and release authorization remain unverified or
unimplemented. Existing UI is unchanged and fixture-labeled. These deliberate
holds are technical prerequisites, not simulated successful activity.
