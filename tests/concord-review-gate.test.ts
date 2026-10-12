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
const event: {
  task_id: string; tool: string; status: string; detail: string | null; created_at: string;
} = {
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
function history(...entries: typeof event[]) {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}
const handoff = { ...event, tool: "handoff", detail: "review_ready" };
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
  it("labels internally consistent caller evidence unauthenticated even when the caller claims authority", () => {
    const result = assessConcordReview(fixture({
      sourceAuthenticated: true, evidenceSource: "trusted_database",
      digestMeaning: "provenance_signature", releaseAuthorized: true,
    }));
    expect(result.decision).toBe("READY_FOR_INDEPENDENT_REVIEW");
    expect(result.sourceAuthenticated).toBe(false);
    expect(result.evidenceSource).toBe("caller_supplied");
    expect(result.digestMeaning).toBe("content_integrity_only");
    expect(result.releaseAuthorized).toBe(false);
  });
  it.each([
    "src/sub/../lib/feature.ts", "./src/./lib/feature.ts", "src\\lib\\feature.ts",
  ])("blocks an active competitor claiming the same file through %s", (alias) => {
    const workState = { ...state, tasks: [state.tasks[0], {
      ...state.tasks[0], task_id: "TASK-99", status: "active", expected_files: [alias],
    }] };
    expect(assessConcordReview(fixture({ workState })).decision).toBe("BLOCKED");
  });
  it("admits a repository-contained lexical alias in the packet", () => {
    const result = assessConcordReview(fixture({
      reviewPacket: packet.replace("src/lib/feature.ts", "./src/sub/../lib/feature.ts"),
    }));
    expect(result.decision).toBe("READY_FOR_INDEPENDENT_REVIEW");
  });
  it.each([
    "../src/lib/feature.ts", "src/../../lib/feature.ts", "/src/lib/feature.ts",
    "C:\\src\\lib\\feature.ts", "C:src/lib/feature.ts", "./C:/src/lib/feature.ts",
    "\\\\server\\share\\feature.ts", "src/lib/fea\u0000ture.ts", ".",
  ])("rejects unsafe declared file scope %j", (unsafePath) => {
    const workState = { ...state, tasks: [{ ...state.tasks[0], expected_files: [unsafePath] }] };
    expect(() => assessConcordReview(fixture({ workState }))).toThrow();
  });
  it.each(["../src/lib/feature.ts", "/src/lib/feature.ts", "C:/src/lib/feature.ts", "src/lib/fea\u0000ture.ts"])(
    "blocks an unsafe packet path %j even when the other packet evidence is complete", (unsafePath) => {
      expect(assessConcordReview(fixture({
        reviewPacket: packet.replace("src/lib/feature.ts", unsafePath),
      })).decision).toBe("BLOCKED");
    },
  );
  it("does not borrow test evidence across an indented section boundary", () => {
    const reviewPacket = packet.replace("- pnpm test -- feature", "_None_\n  ## Notes\n- pnpm test -- feature");
    expect(assessConcordReview(fixture({ reviewPacket })).decision).toBe("BLOCKED");
  });
  it.each(["Files touched", "Tests run", "Guardrails checked", "Provenance"])(
    "blocks a duplicate required evidence section %s", (title) => {
      const reviewPacket = packet + "\n  ## " + title + "\n- apparently complete evidence";
      expect(assessConcordReview(fixture({ reviewPacket })).decision).toBe("BLOCKED");
    },
  );
  it("parses uniformly indented headings without borrowing adjacent evidence", () => {
    expect(assessConcordReview(fixture({
      reviewPacket: packet.replace(/^## /gm, "  ## "),
    })).decision).toBe("READY_FOR_INDEPENDENT_REVIEW");
  });
  it.each([
    "Not run yet", "unknown (no output)", "pending", "pnpm test -- feature (failed)",
    "pnpm test -- feature (not run)",
  ])("blocks an incomplete or contradictory reported test: %s", (report) => {
    expect(assessConcordReview(fixture({
      reviewPacket: packet.replace("pnpm test -- feature", report),
    })).decision).toBe("BLOCKED");
  });
  it("blocks a narrative contradiction alongside a reported test command", () => {
    expect(assessConcordReview(fixture({
      reviewPacket: packet.replace("- pnpm test -- feature", "Tests were not run.\n- pnpm test -- feature"),
    })).decision).toBe("BLOCKED");
  });
  it("does not read required evidence from a fenced code example", () => {
    const reviewPacket = packet.replace("## Tests run\n- pnpm test -- feature", "```markdown\n## Tests run\n- pnpm test -- feature\n```");
    expect(assessConcordReview(fixture({ reviewPacket })).decision).toBe("BLOCKED");
  });
  it("requires a handoff before its review-ready event", () => {
    expect(assessConcordReview(fixture({ eventsJsonl: history(event, handoff) })).decision).toBe("BLOCKED");
  });
  it("blocks decreasing event timestamps", () => {
    expect(assessConcordReview(fixture({ eventsJsonl: history(handoff, {
      ...event, created_at: "2026-10-12T06:14:59.999Z",
    }) })).decision).toBe("BLOCKED");
  });
  it.each(["yesterday", "2026-02-30T06:15:00.000Z", "2026-10-12 06:15:00", "2026-10-12T06:15:00"])(
    "blocks an invalid or timezone-less event timestamp %s", (created_at) => {
      expect(assessConcordReview(fixture({
        eventsJsonl: history({ ...handoff, created_at }, { ...event, created_at }),
      })).decision).toBe("BLOCKED");
    },
  );
  it("blocks event evidence recorded after its work-state snapshot", () => {
    expect(assessConcordReview(fixture({ eventsJsonl: history(handoff, {
      ...event, created_at: "2026-10-12T06:15:01.000Z",
    }) })).decision).toBe("BLOCKED");
  });
  it.each(["release_task", "reopen_task", "close_task", "claim_work", "offer_handoff", "assign_task"])(
    "blocks stale review readiness after a later %s event", (tool) => {
      expect(assessConcordReview(fixture({ eventsJsonl: history(handoff, event, {
        ...event, tool, detail: null,
      }) })).decision).toBe("BLOCKED");
    },
  );
  it("blocks a failed review attempt after earlier successful review evidence", () => {
    expect(assessConcordReview(fixture({ eventsJsonl: history(handoff, event, {
      ...event, status: "error", detail: "review evidence rejected",
    }) })).decision).toBe("BLOCKED");
  });
  it("admits a new successful finish after an older reopening", () => {
    expect(assessConcordReview(fixture({ eventsJsonl: history(
      { ...event, tool: "reopen_task", detail: "rework required" }, handoff, event,
    ) })).decision).toBe("READY_FOR_INDEPENDENT_REVIEW");
  });
  it("keeps an unrelated task lifecycle event separate from the selected finish", () => {
    expect(assessConcordReview(fixture({ eventsJsonl: history(handoff, event, {
      ...event, task_id: "OTHER", tool: "reopen_task",
    }) })).decision).toBe("READY_FOR_INDEPENDENT_REVIEW");
  });
  it("admits a later benign task context update without interpreting it as a new finish", () => {
    expect(assessConcordReview(fixture({ eventsJsonl: history(handoff, event, {
      ...event, tool: "update_task", detail: "progress",
    }) })).decision).toBe("READY_FOR_INDEPENDENT_REVIEW");
  });
  it.each(["ACTIVE", "active ", "unexpected-state"])(
    "rejects an unrecognized competitor status %j instead of hiding its claim", (status) => {
      const workState = { ...state, tasks: [state.tasks[0], {
        ...state.tasks[0], task_id: "TASK-99", status,
      }] };
      expect(() => assessConcordReview(fixture({ workState }))).toThrow();
    },
  );
  it("blocks a whitespace-only claimed agent identity", () => {
    expect(assessConcordReview(fixture({ workState: {
      ...state, tasks: [{ ...state.tasks[0], agent_id: "   " }],
    } })).decision).toBe("BLOCKED");
  });
  it.each(["Not checked", "unknown", "pending"])(
    "blocks a missing guardrail report expressed as %j", (report) => {
      expect(assessConcordReview(fixture({
        reviewPacket: packet.replace("No secret access", report),
      })).decision).toBe("BLOCKED");
    },
  );
  it.each(["unknown", "not reported", "pending"])(
    "blocks a placeholder provenance source %j", (source) => {
      expect(assessConcordReview(fixture({
        reviewPacket: packet.replace("local test output", source),
      })).decision).toBe("BLOCKED");
    },
  );
  it("blocks an incomplete provenance entry alongside a complete entry", () => {
    expect(assessConcordReview(fixture({
      reviewPacket: packet + "\n- guardrails:",
    })).decision).toBe("BLOCKED");
  });
  it("does not treat error-handling filenames or a guardrail against errors as failure reports", () => {
    expect(assessConcordReview(fixture({ reviewPacket: packet
      .replace("pnpm test -- feature", "pnpm test tests/error-handling.test.ts")
      .replace("No secret access", "No error details exposed"),
    })).decision).toBe("READY_FOR_INDEPENDENT_REVIEW");
  });
  it.each([
    ["pnpm test -- 79 passed, 0 failed", "READY_FOR_INDEPENDENT_REVIEW"],
    ["pnpm test -- 79 passed, 1 failed", "BLOCKED"],
    ["pnpm test: error count = 0, 79 passed", "READY_FOR_INDEPENDENT_REVIEW"],
    ["pnpm test: error count = 1, 79 passed", "BLOCKED"],
    ["pnpm test -- feature (failed)", "BLOCKED"],
    ["pnpm test: error count = unknown, 79 passed", "BLOCKED"],
    ["pnpm test -- 0 failed; error count = unknown", "BLOCKED"],
    ["pnpm test -- 0 failed; 1 failed", "BLOCKED"],
    ["pnpm test -- 0 failed; error count = 1", "BLOCKED"],
    ["pnpm test -- 0 failures, 79 passed", "READY_FOR_INDEPENDENT_REVIEW"],
    ["pnpm test -- 0 errors, 79 passed", "READY_FOR_INDEPENDENT_REVIEW"],
    ["pnpm test -- 1 failure, 79 passed", "BLOCKED"],
    ["pnpm test -- 1 error, 79 passed", "BLOCKED"],
    ["pnpm test -- 1 failed.", "BLOCKED"],
    ["pnpm test -- 0 failed.", "READY_FOR_INDEPENDENT_REVIEW"],
    ["pnpm test failed.test.ts", "READY_FOR_INDEPENDENT_REVIEW"],
  ])("interprets the explicit test outcome %j as %s", (report, decision) => {
    expect(assessConcordReview(fixture({
      reviewPacket: packet.replace("pnpm test -- feature", report),
    })).decision).toBe(decision);
  });
  it.each([
    "- Security guardrail failed: unexpected secret access",
    "- Scope verified\nNo guardrails were checked.",
    "- Scope verified\nGuardrails were not checked.",
    "- Security guardrail failed.",
  ])("blocks an explicit contradiction anywhere in the guardrail section: %j", (report) => {
    expect(assessConcordReview(fixture({
      reviewPacket: packet.replace("- No secret access", report),
    })).decision).toBe("BLOCKED");
  });
  it.each([
    ["pnpm test (exit 1)", "BLOCKED"],
    ["pnpm test (exit code 1)", "BLOCKED"],
    ["pnpm test (exit code = 2)", "BLOCKED"],
    ["pnpm test (exit -1)", "BLOCKED"],
    ["pnpm test (exit unknown)", "BLOCKED"],
    ["pnpm test (exit 0)", "READY_FOR_INDEPENDENT_REVIEW"],
    ["pnpm test (exit code = 0)", "READY_FOR_INDEPENDENT_REVIEW"],
    ["pnpm test (exit 0); rerun (exit 1)", "BLOCKED"],
    ["pnpm test tests/exit-1.test.ts", "READY_FOR_INDEPENDENT_REVIEW"],
  ])("interprets the reported test exit %j as %s", (report, decision) => {
    expect(assessConcordReview(fixture({
      reviewPacket: packet.replace("pnpm test -- feature", report),
    })).decision).toBe(decision);
  });
  it.each([
    "- example: tests were not run; output unavailable",
    "- tests: local test output\nNo provenance was recorded.",
    "- tests: local test output\nProvenance was not recorded.",
    "- tests: output unavailable",
  ])("blocks explicit negative evidence anywhere in the provenance section: %j", (report) => {
    expect(assessConcordReview(fixture({
      reviewPacket: packet.replace("- tests: local test output", report),
    })).decision).toBe("BLOCKED");
  });
  it.each(["    ", "\t", " \t"])(
    "does not accept required sections inside Markdown code indented by %j", (indent) => {
      const reviewPacket = packet.split("\n").map((line, index) => index === 0 ? line : indent + line).join("\n");
      expect(assessConcordReview(fixture({ reviewPacket })).decision).toBe("BLOCKED");
    },
  );
  it.each(["    ", "\t"])(
    "does not accept an indented code bullet as reported test evidence (%j)", (indent) => {
      expect(assessConcordReview(fixture({
        reviewPacket: packet.replace("- pnpm test -- feature", indent + "- pnpm test -- feature"),
      })).decision).toBe("BLOCKED");
    },
  );
  it("admits historical UTC-offset timestamps without asserting freshness", () => {
    const timestamp = "2020-01-01T11:15:00.000+05:00";
    expect(assessConcordReview(fixture({
      workState: { ...state, generated_at: timestamp },
      eventsJsonl: history({ ...handoff, created_at: timestamp }, { ...event, created_at: timestamp }),
    })).decision).toBe("READY_FOR_INDEPENDENT_REVIEW");
  });
  it("rejects an invalid work-state snapshot timestamp", () => {
    expect(() => assessConcordReview(fixture({
      workState: { ...state, generated_at: "not-a-date" },
    }))).toThrow();
  });
  it("rejects an unbounded task inventory", () => {
    expect(() => assessConcordReview(fixture({ workState: {
      ...state, tasks: Array.from({ length: 257 }, (_, index) => ({ ...state.tasks[0], task_id: `TASK-${index}` })),
    } }))).toThrow();
  });
  it("rejects an unbounded file inventory on a task", () => {
    expect(() => assessConcordReview(fixture({ workState: {
      ...state, tasks: [{ ...state.tasks[0], expected_files: Array(129).fill("src/lib/feature.ts") }],
    } }))).toThrow();
  });
  it("rejects an unbounded aggregate declared file inventory", () => {
    expect(() => assessConcordReview(fixture({ workState: {
      ...state, tasks: Array.from({ length: 64 }, (_, index) => ({
        ...state.tasks[0], task_id: `TASK-${index}`, expected_files: Array(65).fill("src/lib/feature.ts"),
      })),
    } }))).toThrow();
  });
  it.each([
    { title: "x".repeat(513) }, { agent_id: "x".repeat(129) }, { status: "x".repeat(65) },
    { task_id: "x".repeat(129) }, { expected_files: ["x".repeat(1025)] },
  ])("rejects excessive task field sizes: %j", (excessive) => {
    expect(() => assessConcordReview(fixture({
      workState: { ...state, tasks: [{ ...state.tasks[0], ...excessive }] },
    }))).toThrow();
  });
  it("blocks an unbounded event inventory", () => {
    const extra = { ...event, task_id: "X", tool: "x", status: "s", detail: null };
    expect(assessConcordReview(fixture({
      eventsJsonl: history(...Array(1023).fill(extra), handoff, event),
    })).decision).toBe("BLOCKED");
  });
  it("blocks excessive event detail size", () => {
    expect(assessConcordReview(fixture({ eventsJsonl: history(handoff, {
      ...event, detail: "x".repeat(2049),
    }) })).decision).toBe("BLOCKED");
  });
});
