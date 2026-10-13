#!/usr/bin/env -S node --import tsx
import { LOCAL_CHECK_IDS } from "../src/server/concord/execution-receipts";

const args = process.argv.slice(2);
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  process.stdout.write(`Archeagent execution receipt collector — HOLD\n\nLocal SQLite isolation gate is held. No collection, signing-key generation,\nsource acquisition, storage or model activity is performed by this command.\n\nReserved interface after the isolation gate is repaired:\n  node --import tsx scripts/concord-local-check.ts --actor <id> --task <id> --check <check-id>\n\nAllowlisted check IDs: ${LOCAL_CHECK_IDS.join(", ")}\nThe pure process/signature/manifest helpers are tested independently. They\nare not a completed production collector or evidence of model collaboration.\n`);
} else {
  process.stderr.write("Local SQLite isolation gate is held. Receipt collection is disabled.\n");
  process.exitCode = 2;
}
