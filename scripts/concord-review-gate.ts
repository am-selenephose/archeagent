#!/usr/bin/env node
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { assessConcordReview } from "../src/core/integrations/concord-review";

const taskId = process.argv[2];
if (!taskId) {
  console.error("Usage: pnpm concord:gate <Concord-task-id>");
  process.exit(2);
}

function readExport(dir: string, name: string, limit: number): string {
  // Fixed filenames only. Never follow a final-component symlink, open a
  // blocking special file, or allocate an unbounded readFileSync payload.
  const descriptor = openSync(join(dir, name), constants.O_RDONLY |
    constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > limit) throw new Error("Invalid export");
    const bytes = Buffer.alloc(limit + 1);
    let total = 0;
    while (total < bytes.length) {
      const read = readSync(descriptor, bytes, total, bytes.length - total, null);
      if (!read) break;
      total += read;
    }
    if (total > limit) throw new Error("Export too large");
    return new TextDecoder("utf-8", {fatal: true}).decode(bytes.subarray(0, total));
  } finally {
    closeSync(descriptor);
  }
}
try {
  const dir = join(process.cwd(), ".concord");
  if (!lstatSync(dir).isDirectory()) throw new Error("Invalid export directory");
  const result = assessConcordReview({
    taskId,
    workState: JSON.parse(readExport(dir, "WORK_STATE.json", 262144)),
    reviewPacket: readExport(dir, "REVIEW_PACKET.md", 65536),
    eventsJsonl: readExport(dir, "events.jsonl", 131072),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.decision !== "READY_FOR_INDEPENDENT_REVIEW") process.exitCode = 2;
} catch {
  // Export contents, validation details and host paths can be private.
  console.error("Concord evidence unavailable/invalid. Expected bounded regular UTF-8 exports in .concord.");
  process.exitCode = 2;
}
