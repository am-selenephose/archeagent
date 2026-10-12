import { createHash } from "node:crypto";
import { z } from "zod";

/* Concord coordinates agents. Archeagent alone verifies release eligibility. */
const MAX_FILES = 128;
const MAX_EVENTS = 1024;
const idSchema = z.string().min(1).max(128);
const timestampSchema = z.iso.datetime({ offset: true }).max(64);

/** Lexical repository-relative comparison only; never resolve caller paths on disk. */
function pathKey(value: string): string | undefined {
  if (!value || value.length > 1024 || value !== value.trim() ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return;
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/")) return;
  const parts: string[] = [];
  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue;
    if (/^[A-Za-z]:/.test(part)) return;
    if (part === "..") {
      if (parts.length === 0) return;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length > 0 ? parts.join("/") : undefined;
}
const fileSchema = z.string().min(1).max(1024).refine((value) => pathKey(value) !== undefined,
  "File scope must stay within a repository-relative lexical path");
const taskSchema = z.object({
  task_id: idSchema,
  title: z.string().min(1).max(512),
  status: z.enum(["proposed", "assigned", "active", "blocked", "handoff_offered",
    "handed_off", "review_ready", "complete", "closed"]),
  agent_id: idSchema.nullable(),
  version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expected_files: z.array(fileSchema).max(MAX_FILES),
});
export const concordReviewInputSchema = z.object({
  taskId: idSchema,
  workState: z.object({ generated_at: timestampSchema, tasks: z.array(taskSchema).max(256) })
    .refine((state) => state.tasks.reduce((sum, task) => sum + task.expected_files.length, 0) <= 4096,
      "Aggregate declared file scope exceeds the evidence limit"),
  reviewPacket: z.string().min(1).max(65536),
  eventsJsonl: z.string().min(1).max(131072),
});
export type ConcordReviewAssessment = {
  taskId: string;
  decision: "BLOCKED" | "READY_FOR_INDEPENDENT_REVIEW";
  checks: { name: string; passed: boolean; detail: string }[];
  sha256: string;
  sourceAuthenticated: false;
  evidenceSource: "caller_supplied";
  digestMeaning: "content_integrity_only";
  releaseAuthorized: false;
  warning: string;
};
const eventSchema = z.object({
  task_id: idSchema, tool: z.string().min(1).max(128), status: z.string().min(1).max(64),
  detail: z.string().max(2048).nullable(), created_at: timestampSchema,
});

function packetSections(markdown: string): Map<string, string[][]> {
  const sections = new Map<string, string[][]>();
  let content: string[] | undefined;
  let fence: string | undefined;
  for (const rawLine of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    // Preserve indentation until code has been excluded; trim only real packet text.
    if (/^(?: {4}| {0,3}\t)/.test(rawLine)) continue;
    const line = rawLine.trim();
    const fenceMarker = /^(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (fenceMarker?.[0] === fence[0] && fenceMarker.length >= fence.length &&
        line.slice(fenceMarker.length).trim() === "") fence = undefined;
      continue;
    }
    if (fenceMarker) { fence = fenceMarker; continue; }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      content = undefined;
      if (heading[1] === "##") {
        content = [];
        const entries = sections.get(heading[2]) ?? [];
        entries.push(content);
        sections.set(heading[2], entries);
      }
    } else content?.push(line);
  }
  return sections;
}
function section(sections: Map<string, string[][]>, title: string): string[] {
  const entries = sections.get(title);
  return entries?.length === 1 ? entries[0] : [];
}
function list(lines: string[]): string[] {
  return lines
    .filter((line) => line.startsWith("- ")).map((line) => line.slice(2)
      .replace(/^\x60|\x60$/g, "").trim()).filter(Boolean);
}
function placeholderReport(value: string): boolean {
  const report = value.replace(/^[\s\x60_*\-]+|[\x60_*]+$/g, "");
  return /^(none|unknown|not reported|pending|skipped|todo|tbd|n\/a|not applicable)\b/i.test(report) ||
    /^(?:not|never)\s+(?:run|executed|checked|reviewed|verified|recorded|provided|available)\b/i.test(report);
}
function negativeNarrative(report: string): boolean {
  return /\b(?:not|never)\s+(?:run|executed|checked|verified|reviewed|recorded|provided)\b/i.test(report) ||
    /\bno\s+(?:tests|guards?|guardrails?|checks|provenance|sources?|evidence)(?:\s+(?:was|were))?\s+(?:run|executed|checked|verified|reviewed|recorded|provided)\b/i.test(report) ||
    /\b(?:output|sources?|evidence|provenance)(?:\s+(?:is|was))?\s+(?:unavailable|missing)\b/i.test(report);
}
function nonzeroExit(report: string): boolean {
  return [...report.matchAll(/(?:^|[\s(,:;])exit(?:\s+code)?(?:\s*[=:]\s*|\s+)([+-]?\d+|unknown)(?=$|[\s),:;.!?])/gi)]
    .some((match) => match[1].toLowerCase() === "unknown" || Number(match[1]) !== 0);
}
function failureReport(report: string, includeErrors: boolean): boolean {
  // Exempt only explicit zero counts; another failure/error statement still blocks.
  const remaining = report
    .replace(/(^|[\s(,:;])0\s+(?:failed|failures?|errors?)(?=$|[\s),:;!?]|\.(?:\s|$))/gi, "$1")
    .replace(/\b(?:failed|failures?|errors?)\s+count\s*[=:]\s*0(?=$|[\s),:;!?]|\.(?:\s|$))/gi, "");
  return (includeErrors
    ? /(?:^|[\s(,:;])(?:failed|failures?|errors?|aborted|timed out)(?:$|[\s),:;!?]|\.(?=\s|$))/i
    : /(?:^|[\s(,:;])(?:failed|failures?|aborted|timed out)(?:$|[\s),:;!?]|\.(?=\s|$))/i).test(remaining);
}
function incompleteReport(lines: string[]): boolean {
  return lines.some((line) => {
    const report = line.replace(/^[\s\x60_*\-]+|[\x60_*]+$/g, "");
    return placeholderReport(report) ||
      negativeNarrative(report) || failureReport(report, true) || nonzeroExit(report) ||
      /\b0\s+(?:tests|passed)\b/i.test(report);
  });
}
const lifecycleTools = new Set([
  "claim_work", "assign_task", "accept_task", "expire_assignment", "release_task",
  "reassign_task", "close_task", "reopen_task", "offer_handoff", "accept_handoff",
  "decline_handoff", "expire_handoff", "handoff", "review_ready",
  "start_work", "transfer_work", "finish_work",
]);
export function assessConcordReview(raw: unknown): ConcordReviewAssessment {
  const input = concordReviewInputSchema.parse(raw);
  const checks: ConcordReviewAssessment["checks"] = [];
  const check = (name: string, passed: boolean, detail: string) =>
    checks.push({ name, passed, detail });
  const matches = input.workState.tasks.filter((task) => task.task_id === input.taskId);
  const task = matches.length === 1 ? matches[0] : undefined;
  check("unique_task", !!task, "Exactly one task must match the requested id");
  check("review_ready", task?.status === "review_ready", "Task must be review-ready");
  check("identified_agent", !!task?.agent_id?.trim(), "Task must identify a nonblank claimed agent (not authenticated)");
  check("versioned_work", !!task && task.version > 0, "Task must have a positive version");
  const packetId = /^# Review Packet:\s*(\S+)/.exec(input.reviewPacket.trim().split("\n", 1)[0] ?? "")?.[1];
  check("packet_identity", packetId === input.taskId, "Packet must belong to the same task");
  const sections = packetSections(input.reviewPacket);
  const requiredSections = ["Files touched", "Tests run", "Guardrails checked", "Provenance"];
  check("unique_evidence_sections", requiredSections.every((title) => sections.get(title)?.length === 1),
    "Each required evidence section must occur exactly once outside code examples");
  const expected = new Set((task?.expected_files ?? []).map(pathKey));
  const touchedFiles = list(section(sections, "Files touched"));
  const touched = new Set(touchedFiles.map(pathKey));
  check("repository_relative_files", touchedFiles.length <= MAX_FILES && !touched.has(undefined),
    "Packet file scope must use bounded repository-relative lexical paths");
  check("declared_scope", expected.size > 0 && touched.size > 0 &&
    [...touched].every((path) => expected.has(path)), "Touched files must match declared scope");
  const testLines = section(sections, "Tests run");
  const tests = list(testLines);
  check("reported_tests", tests.length > 0 && tests.length <= MAX_FILES &&
    tests.every((report) => report.length <= 4096) && !incompleteReport(testLines),
    "Reported tests must be nonempty and internally consistent (not independently verified)");
  const guardrailLines = section(sections, "Guardrails checked");
  check("reported_guardrails", list(guardrailLines).length > 0 && !guardrailLines.some((line) =>
    placeholderReport(line) || negativeNarrative(line) || failureReport(line, false)),
    "Non-placeholder reported guardrails required");
  const provenanceLines = section(sections, "Provenance");
  const provenance = list(provenanceLines);
  check("reported_provenance", provenance.length > 0 && !provenanceLines.some(negativeNarrative) &&
    provenance.every((entry) => {
    const fields = /^([^:]+):\s*(\S.*)$/.exec(entry);
    return !!fields?.[1].trim() && !!fields[2].trim() && !placeholderReport(fields[2]);
  }), "Non-placeholder field-to-source provenance required (not authenticated)");
  let events: z.infer<typeof eventSchema>[] = [];
  try {
    const lines = input.eventsJsonl.trim().split("\n");
    if (lines.length > MAX_EVENTS) throw new Error("Event inventory exceeds the evidence limit");
    events = lines
      .map((line) => eventSchema.parse(JSON.parse(line)));
    check("events_parse", true, "Concord event export parsed");
  } catch {
    check("events_parse", false, "Malformed event export");
  }
  const times = events.map((event) => Date.parse(event.created_at));
  const snapshotTime = Date.parse(input.workState.generated_at);
  check("events_chronological", events.length > 0 && times.every((time, index) =>
    time <= snapshotTime && (index === 0 || times[index - 1] <= time)),
    "ISO event times must be chronological and no later than the supplied snapshot");
  const lifecycle = events.filter((event) => event.task_id === input.taskId && lifecycleTools.has(event.tool));
  const latest = lifecycle[lifecycle.length - 1];
  const preceding = lifecycle[lifecycle.length - 2];
  check("review_event", latest?.tool === "review_ready" && latest.status === "success" &&
    preceding?.tool === "handoff" && preceding.status === "success" && preceding.detail === "review_ready",
    "Latest matching lifecycle must end with a successful handoff then review_ready pair");
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
    sourceAuthenticated: false,
    evidenceSource: "caller_supplied",
    digestMeaning: "content_integrity_only",
    releaseAuthorized: false,
    warning: "Reported Concord evidence is not independently verified. This SHA-256 is not a signature. A separate Archeagent security, test and release evaluation remains mandatory.",
  };
}
