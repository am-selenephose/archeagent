/** Separate operator process used to prove recovery without supervisor memory. */
import { LOCAL_ROOT } from "../src/server/concord/local-paths";
import { DurableConcordSupervisor, type DurableReply } from "../src/server/concord/durable-supervisor";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [mode, suffix] = process.argv.slice(2);
if (process.argv.length !== 4 || !["seed", "recover"].includes(mode) || !/^durable-store-[a-zA-Z0-9_-]{1,80}$/.test(suffix ?? "")) throw new Error("Fixture options rejected");
const store = join(LOCAL_ROOT, ".concord/test-harness", suffix);
const witness = join(LOCAL_ROOT, ".local-audit", `${suffix}.receipt.json`);
const content = (reply: DurableReply) => (reply.result as { structuredContent: Record<string, unknown> }).structuredContent;
async function main() {
  const before = mode === "recover" ? JSON.parse(readFileSync(witness, "utf8")) : undefined;
  const supervisor = await DurableConcordSupervisor.open(store, ["builder", "reviewer"], { initialize: mode === "seed", minimumGeneration: before?.generation ?? 1 });
  try {
    if (mode === "seed") {
      const builder = supervisor.client("builder"), reviewer = supervisor.client("reviewer");
      const a = content(await builder.call("start_work", { task_id: "recovery-build", title: "Synthetic durable recovery", kind: "codex", expected_files: ["src/recovery-shared.ts"] }));
      const b = content(await reviewer.call("start_work", { task_id: "recovery-review", title: "Synthetic review", kind: "codex", expected_files: ["src/recovery-shared.ts"] }));
      assert.equal((b.overlaps as unknown[]).length, 1);
      await reviewer.call("transfer_work", { task_id: "recovery-review", action: "release", expected_version: b.version });
      const offer = content(await builder.call("transfer_work", { task_id: "recovery-build", action: "offer", expected_version: a.version, to_agent_id: "reviewer", what_changed: "SYNTHETIC_DURABLE_HANDOFF", changed_files: ["src/recovery-shared.ts"] }));
      const accepted = await reviewer.call("transfer_work", { task_id: "recovery-build", action: "accept", expected_version: offer.version });
      assert.equal(content(accepted).agent_id, "reviewer");
      const metadata = await supervisor.auditMetadata();
      writeFileSync(witness, JSON.stringify({ generation: accepted.acknowledgement.generation, metadata }), { mode: 0o600, flag: "wx" });
      process.stdout.write(JSON.stringify({ mode, provenance: "scripted_protocol_test", generation: accepted.acknowledgement.generation, metadata }) + "\n");
    } else {
      const metadata = await supervisor.auditMetadata(); assert.deepEqual(metadata, before.metadata);
      const task = content(await supervisor.client("reviewer").call("inspect_work", { task_id: "recovery-build" }));
      assert.equal((task.task as { agentId: string }).agentId, "reviewer");
      // The task's offer and accept are its two genuine ownership events;
      // initial start_work does not invent a third transfer event.
      assert.ok((task.ownership_history as unknown[]).length >= 2);
      assert.ok(JSON.stringify(task.latest_handoff).includes("SYNTHETIC_DURABLE_HANDOFF"));
      process.stdout.write(JSON.stringify({ mode, provenance: "scripted_protocol_test", recoveredMetadataMatches: true, metadata, taskOwner: "reviewer", ownershipEvents: (task.ownership_history as unknown[]).length }) + "\n");
    }
  } finally { await supervisor.close(); }
}
void main().catch(() => { process.stderr.write("Durable fixture verification failed.\n"); process.exitCode = 1; });
