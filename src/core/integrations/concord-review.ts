import { createHash } from "node:crypto";
import { z } from "zod";

/* Concord coordinates agents. Archeagent alone verifies release eligibility. */
const taskSchema = z.object({
  task_id: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  agent_id: z.string().nullable(),
  version: z.number().int().nonnegative(),
  expected_files: z.array(z.string()),
});
export const concordReviewInputSchema = z.object({
  taskId: z.string().min(1).max(128),
  workState: z.object({ generated_at: z.string().min(1), tasks: z.array(taskSchema) }),
  reviewPacket: z.string().min(1).max(65536),
  eventsJsonl: z.string().min(1).max(131072),
});
export type ConcordReviewAssessment = {
  taskId: string;
  decision: "BLOCKED" | "READY_FOR_INDEPENDENT_REVIEW";
  checks: { name: string; passed: boolean; detail: string }[];
  sha256: string;
  releaseAuthorized: false;
  warning: string;
};
const eventSchema = z.object({
  task_id: z.string(), tool: z.string(), status: z.string(),
  detail: z.string().nullable(), created_at: z.string(),
});

function section(markdown: string, title: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const index = lines.findIndex((line) => line.trim() === "## " + title);
  if (index === -1) return "";
  const after = lines.slice(index + 1);
  const end = after.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? after : after.slice(0, end)).join("\n").trim();
}
function list(markdown: string, title: string): string[] {
  return section(markdown, title).split("\n").map((line) => line.trim())
    .filter((line) => line.startsWith("- ")).map((line) => line.slice(2)
      .replace(/^\x60|\x60$/g, "").trim()).filter(Boolean);
}
const pathKey = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "");
export function assessConcordReview(raw: unknown): ConcordReviewAssessment {
  const input = concordReviewInputSchema.parse(raw);
  const checks: ConcordReviewAssessment["checks"] = [];
  const check = (name: string, passed: boolean, detail: string) =>
    checks.push({ name, passed, detail });
  const matches = input.workState.tasks.filter((task) => task.task_id === input.taskId);
  const task = matches.length === 1 ? matches[0] : undefined;
  check("unique_task", !!task, "Exactly one task must match the requested id");
  check("review_ready", task?.status === "review_ready", "Task must be review-ready");
  check("identified_agent", !!task?.agent_id, "Task must identify an agent");
  check("versioned_work", !!task && task.version > 0, "Task must have a positive version");
  const packetId = /^# Review Packet:\s*(\S+)/.exec(input.reviewPacket.split("\n", 1)[0] ?? "")?.[1];
  check("packet_identity", packetId === input.taskId, "Packet must belong to the same task");
  const expected = new Set((task?.expected_files ?? []).map(pathKey));
  const touched = new Set(list(input.reviewPacket, "Files touched").map(pathKey));
  check("declared_scope", expected.size > 0 && touched.size > 0 &&
    [...touched].every((path) => expected.has(path)), "Touched files must match declared scope");
  const tests = list(input.reviewPacket, "Tests run");
  check("reported_tests", tests.length > 0 && tests.every((x) => !/^(none|not run|unknown)$/i.test(x)),
    "Reported tests must be nonempty (not independently verified)");
  check("reported_guardrails", list(input.reviewPacket, "Guardrails checked").length > 0,
    "Reported guardrails required");
  check("reported_provenance", list(input.reviewPacket, "Provenance")
    .some((x) => /^[^:]+:\s*\S+/.test(x)), "Field-to-source provenance required");
  let events: z.infer<typeof eventSchema>[] = [];
  try {
    events = input.eventsJsonl.trim().split("\n")
      .map((line) => eventSchema.parse(JSON.parse(line)));
    check("events_parse", true, "Concord event export parsed");
  } catch {
    check("events_parse", false, "Malformed event export");
  }
  check("review_event", events.some((e) => e.task_id === input.taskId &&
    e.tool === "review_ready" && e.status === "success") &&
    events.some((e) => e.task_id === input.taskId && e.tool === "handoff" &&
      e.status === "success" && e.detail === "review_ready"),
    "Matching Concord handoff and review_ready audit events required");
  const active = new Set(["assigned", "active", "blocked", "handoff_offered"]);
  const collision = input.workState.tasks.some((other) => other.task_id !== input.taskId &&
    active.has(other.status) &&
    other.expected_files.some((file) => expected.has(pathKey(file))));
  check("no_active_file_collision", !collision, "No other active task may claim these files");
  return {
    taskId: input.taskId,
    decision: checks.every((x) => x.passed) ? "READY_FOR_INDEPENDENT_REVIEW" : "BLOCKED",
    checks,
    sha256: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    releaseAuthorized: false,
    warning: "Reported Concord evidence is not independently verified. This SHA-256 is not a signature. A separate Archeagent security, test and release evaluation remains mandatory.",
  };
}
