#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assessConcordReview } from "../src/core/integrations/concord-review";

const taskId = process.argv[2];
if (!taskId) {
  console.error("Usage: pnpm concord:gate <Concord-task-id>");
  process.exit(2);
}
try {
  const dir = join(process.cwd(), ".concord");
  const result = assessConcordReview({
    taskId,
    workState: JSON.parse(readFileSync(join(dir, "WORK_STATE.json"), "utf8")),
    reviewPacket: readFileSync(join(dir, "REVIEW_PACKET.md"), "utf8"),
    eventsJsonl: readFileSync(join(dir, "events.jsonl"), "utf8"),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.decision !== "READY_FOR_INDEPENDENT_REVIEW") process.exitCode = 2;
} catch (error) {
  console.error("Concord evidence unavailable/invalid: " + String(error));
  process.exitCode = 2;
}
