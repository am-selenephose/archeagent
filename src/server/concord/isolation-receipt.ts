/** Scripted storage qualification only; never agent or release authority. */
export const SQLITE_PROBE_CHECKS = [
  "kernel-private-state-and-readonly-host",
  "real-source-initializer-still-held",
  "nested-user-or-mount-namespace-creation-is-disabled",
  "outside-direct-open-or-migration-is-denied-by-kernel",
  "proc-root-and-borrowed-directory-descriptor-aliases-cannot-write-host-targets",
  "late-main-alias-existing",
  "late-main-alias-absent",
  "sqlite-sidecar-alias--wal-existing",
  "sqlite-sidecar-alias--wal-absent",
  "sqlite-sidecar-alias--shm-existing",
  "sqlite-sidecar-alias--shm-absent",
  "sqlite-sidecar-alias--journal-existing",
  "sqlite-sidecar-alias--journal-absent",
  "hardlinks-cannot-import-host-inodes-into-private-state",
  "late-directory-alias-cannot-create-a-host-database",
  "mounted-state-ancestor-cannot-be-reparented-or-substituted",
  "genuine-Concord-schema-constraints-and-active-WAL-snapshots",
  "active-WAL-cannot-gain-an-outside-hardlink",
  "active-wal-substitution-and-checkpoint-preserve-host-existing",
  "active-wal-substitution-and-checkpoint-preserve-host-absent",
  "active-shm-substitution-and-checkpoint-preserve-host-existing",
  "active-shm-substitution-and-checkpoint-preserve-host-absent",
  "cleanup-after-main-alias-substitution-cannot-touch-outside-target",
  "runtime-acquisition-preserves-scope-and-rejects-foreign-run",
  "vacuum-into-cannot-create-an-outside-database",
] as const;

export type IsolationProbeReceipt = {
  version: "archeagent.sqlite-isolation-probe.v1";
  provenance: "scripted_protocol_test";
  storage: "kernel_private_tmpfs";
  durablePersistence: false;
  realSourceEnabled: false;
  checks: { name: string; passed: true }[];
};

/** Completeness check on a fixed child program, NOT authentication of caller JSON. */
export function parseIsolationProbeReceipt(output: string): IsolationProbeReceipt {
  const receipt = JSON.parse(output) as Partial<IsolationProbeReceipt> | null;
  if (!receipt || receipt.version !== "archeagent.sqlite-isolation-probe.v1" || receipt.provenance !== "scripted_protocol_test" || receipt.storage !== "kernel_private_tmpfs" || receipt.durablePersistence !== false || receipt.realSourceEnabled !== false || !Array.isArray(receipt.checks) || receipt.checks.length !== SQLITE_PROBE_CHECKS.length || receipt.checks.some((check, index) => !check || check.name !== SQLITE_PROBE_CHECKS[index] || check.passed !== true)) throw new Error("Incomplete storage probe receipt");
  return receipt as IsolationProbeReceipt;
}
