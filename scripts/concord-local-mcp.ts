#!/usr/bin/env -S node --import tsx
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LOCAL_ROOT } from "../src/server/concord/local-paths";
import { openLocalRuntime } from "../src/server/concord/local-runtime";

const help = `Archeagent fixed staging Concord MCP launcher

STOP: Local SQLite isolation gate is held. Real-source launch is disabled.

Usage (from the staging project):
  node --import tsx scripts/concord-local-mcp.ts --actor <operator-selected-id> --capture-run <initialized-run-uuid>

Prerequisites: Node 24, this project's pinned dependencies/native SQLite, and
an initialized fixed staging source after passing the isolation gate.
Run concord-local-init.ts only after that gate is approved. This launcher
requires the existing source identity and never creates a fallback workspace.
The root is compiled to ${LOCAL_ROOT}; root/workspace/database options are rejected.
Delivery is pull-only. Invoke register_pull_endpoint before expecting a peer
message, refresh its 90-second lease, and invoke drain_own_inbox in the recipient
session. An operator actor name is not proof of an independently observed Codex
thread. No cloud, telemetry, update checks, hooks, native inbox CLI, or model
sessions are started. This local recorder grants no release authority.
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) { process.stdout.write(help); return; }
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Unsupported runtime.");
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!["--actor", "--capture-run"].includes(key) || value === undefined || value.startsWith("--") || options.has(key)) throw new Error("Invalid launcher options.");
    options.set(key, value);
  }
  const actor = options.get("--actor"), run = options.get("--capture-run");
  if (!actor || !run) throw new Error("Missing launcher binding.");
  process.chdir(LOCAL_ROOT);
  const runtime = openLocalRuntime(actor, run);
  const stop = async () => { await runtime.close(); };
  process.once("SIGINT", () => { void stop().finally(() => { process.exitCode = 0; }); });
  process.once("SIGTERM", () => { void stop().finally(() => { process.exitCode = 0; }); });
  try { await runtime.server.connect(new StdioServerTransport()); }
  catch (error) { await runtime.close(); throw error; }
}
void main().catch(() => { process.stderr.write("Local Concord launcher refused: Local SQLite isolation gate is held. No model sessions may be launched.\n"); process.exitCode = 1; });
