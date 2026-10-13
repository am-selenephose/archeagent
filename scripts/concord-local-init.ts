#!/usr/bin/env -S node --import tsx
import { LOCAL_ROOT } from "../src/server/concord/local-paths";
import { initializeLocalState } from "../src/server/concord/local-runtime";

const help = `Archeagent fixed staging Concord initializer

STOP: Local SQLite isolation gate is held. Production initialization is disabled.
The late-database-alias reproduction must pass under a newly approved storage
implementation before this command may initialize real state.

Usage (from the staging project, after the verified isolation gate):
  node --import tsx scripts/concord-local-init.ts

Prerequisites: Node 24 and this project's pinned Concord/SDK/native SQLite graph.
The compiled root is ${LOCAL_ROOT}. No root/workspace/database options are
accepted. Initializes only empty local schemas plus one source/capture identity;
no fake tasks, agents, activity, model sessions or external services are created.
An existing valid identity is returned unchanged. Unsafe/partial/foreign state
is rejected. Access authentication and receipt signing have separate secrets.
`;

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) { process.stdout.write(help); return; }
  if (args.length || Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Invalid initializer options.");
  process.chdir(LOCAL_ROOT);
  const identity = initializeLocalState();
  process.stdout.write(`${JSON.stringify({ version: identity.version, sourceInstanceId: identity.sourceInstanceId, captureRunId: identity.captureRunId, provenance: identity.provenance, state: "initialized_empty_source", modelSessionObserved: false, releaseAuthorized: false })}\n`);
}
try { main(); } catch { process.stderr.write("Local Concord initialization refused: Local SQLite isolation gate is held. No model sessions may be launched.\n"); process.exitCode = 1; }
