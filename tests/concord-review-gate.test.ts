import { describe, expect, it } from "vitest";
import { assessConcordReview } from "../src/core/integrations/concord-review";

const packet = [
  "# Review Packet: TASK-42 - Reconcile work",
  "## Plan",
  "Reconcile and independently test the change.",
  "## Files touched",
  "- src/lib/feature.ts",
  "## Guardrails checked",
  "- No secret access",
  "## Decisions",
  "_None_",
  "## Reported outcome",
  "_Not reported_",
  "## Tests run",
  "- pnpm test -- feature",
  "## Assumptions",
  "_None_",
  "## Diff size",
  "+12 / -3",
  "## Open questions",
  "_None_",
  "## Provenance",
  "- tests: local test output",
].join("\n");
const state = {
  generated_at: "2026-10-12T06:15:00.000Z",
  tasks: [{
    task_id: "TASK-42", title: "Reconcile work", status: "review_ready",
    agent_id: "codex:builder", expected_files: ["src/lib/feature.ts"], version: 2,
  }],
};
const event = {
  task_id: "TASK-42", tool: "review_ready", status: "success",
  detail: "0 open question(s)", created_at: "2026-10-12T06:15:00.000Z",
};
function fixture(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "TASK-42", workState: state, reviewPacket: packet,
    eventsJsonl: JSON.stringify({
      ...event, tool: "handoff", detail: "review_ready",
    }) + "\n" + JSON.stringify(event) + "\n", ...overrides,
  };
}
describe("Concord review-admission gate", () => {
  it("accepts a valid packet for independent review but never authorizes release", () => {
    const result = assessConcordReview(fixture());
    expect(result.decision).toBe("READY_FOR_INDEPENDENT_REVIEW");
    expect(result.releaseAuthorized).toBe(false);
    expect(result.sha256).toHaveLength(64);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });
  it("blocks unfinished work", () => {
    const changed = { ...state, tasks: [{ ...state.tasks[0], status: "active" }] };
    expect(assessConcordReview(fixture({ workState: changed })).decision).toBe("BLOCKED");
  });
  it("rejects a packet for a different task", () => {
    const result = assessConcordReview(fixture({ reviewPacket: packet.replace("TASK-42", "TASK-OTHER") }));
    expect(result.checks.find((c) => c.name === "packet_identity")?.passed).toBe(false);
  });
  it("rejects out-of-scope changes", () => {
    expect(assessConcordReview(fixture({
      reviewPacket: packet.replace("src/lib/feature.ts", "src/lib/secrets.ts"),
    })).decision).toBe("BLOCKED");
  });
  it("rejects concurrent file ownership collisions", () => {
    const expanded = { ...state, tasks: [state.tasks[0], {
      ...state.tasks[0], task_id: "TASK-99", status: "active",
    }] };
    const result = assessConcordReview(fixture({ workState: expanded }));
    expect(result.checks.find((c) => c.name === "no_active_file_collision")?.passed).toBe(false);
  });
  it("rejects unreported tests or provenance", () => {
    expect(assessConcordReview(fixture({
      reviewPacket: packet.replace("- pnpm test -- feature", "_None_"),
    })).decision).toBe("BLOCKED");
    expect(assessConcordReview(fixture({
      reviewPacket: packet.replace("- tests: local test output", "_None_"),
    })).decision).toBe("BLOCKED");
  });
  it("rejects mismatched or malformed audit history", () => {
    expect(assessConcordReview(fixture({
      eventsJsonl: JSON.stringify({ ...event, task_id: "OTHER" }),
    })).decision).toBe("BLOCKED");
    expect(assessConcordReview(fixture({
      eventsJsonl: "{not-json",
    })).decision).toBe("BLOCKED");
  });
});
