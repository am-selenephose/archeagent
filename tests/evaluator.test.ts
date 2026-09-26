import { describe, expect, it } from "vitest";
import { demoRequest } from "../src/lib/demo";
import { evaluateRun } from "../src/lib/evaluator";

describe("release evaluator", () => {
  it("rejects the fast unsafe patch", () => {
    const run = evaluateRun(demoRequest);
    const fast = run.evaluations.find((item) => item.candidate.id === "fast-fix");
    expect(fast?.verdict).toBe("REJECT");
    expect(fast?.gates.find((gate) => gate.key === "security")?.status).toBe("fail");
  });

  it("holds the plausible patch when migration proof is missing", () => {
    const run = evaluateRun(demoRequest);
    const smart = run.evaluations.find((item) => item.candidate.id === "smart-patch");
    expect(smart?.verdict).toBe("NEEDS_WORK");
    expect(smart?.gates.find((gate) => gate.key === "migration")?.status).toBe("fail");
  });

  it("selects the fully evidenced patch for merge", () => {
    const run = evaluateRun(demoRequest);
    expect(run.decision).toBe("MERGE");
    expect(run.winnerId).toBe("verified-patch");
    expect(run.evaluations[0]?.score).toBe(100);
  });
});
