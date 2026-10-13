import { describe, expect, it } from "vitest";
import { demoRequest } from "../src/lib/demo";
import {
  candidatePatchSchema,
  evaluateCandidate,
  evaluateRun,
  evaluationRequestSchema,
  type CandidatePatch,
} from "../src/lib/evaluator";

function passingCandidate(): CandidatePatch {
  return structuredClone(demoRequest.candidates[2]);
}

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

  // A pass boolean alone must not override empty or contradictory counts.
  it.each([
    { name: "no reported tests", total: 0, failed: 0 },
    { name: "reported failures", total: 42, failed: 1 },
    { name: "more failures than tests", total: 42, failed: 43 },
    { name: "failures without tests", total: 0, failed: 1 },
  ])("rejects a passed report with $name", ({ total, failed }) => {
    const candidate = passingCandidate();
    candidate.signals.tests = { ...candidate.signals.tests, passed: true, total, failed };

    const run = evaluateRun({ ...demoRequest, candidates: [candidate] });
    const evaluation = run.evaluations[0];

    expect(evaluation.gates.find((gate) => gate.key === "tests")).toMatchObject({
      status: "fail",
      earned: 0,
      critical: true,
    });
    expect(evaluation.score).toBe(75);
    expect(evaluation.verdict).toBe("REJECT");
    expect(run.decision).toBe("REJECT");
    expect(run.winnerId).toBeNull();
  });

  // Direct consumers can bypass the request schema; coercion must never pass.
  it.each([
    { name: "zero total", total: 0, failed: 0 },
    { name: "positive failures", total: 42, failed: 1 },
    { name: "failures above total", total: 42, failed: 43 },
    { name: "negative total", total: -1, failed: 0 },
    { name: "negative failures", total: 42, failed: -1 },
    { name: "fractional total", total: 1.5, failed: 0 },
    { name: "fractional failures", total: 42, failed: 0.5 },
    { name: "unsafe total", total: Number.MAX_SAFE_INTEGER + 1, failed: 0 },
    { name: "infinite total", total: Infinity, failed: 0 },
    { name: "NaN total", total: NaN, failed: 0 },
    { name: "NaN failures", total: 42, failed: NaN },
    { name: "string total", total: "42", failed: 0 },
    { name: "string failures", total: 42, failed: "0" },
    { name: "null total", total: null, failed: 0 },
    { name: "missing total", total: undefined, failed: 0 },
    { name: "missing failures", total: 42, failed: undefined },
  ])("fails direct evaluation closed for $name", ({ total, failed }) => {
    const candidate = passingCandidate();
    candidate.signals.tests = {
      ...candidate.signals.tests,
      passed: true,
      total,
      failed,
    } as CandidatePatch["signals"]["tests"];

    const evaluation = evaluateCandidate(candidate);

    expect(evaluation.gates.find((gate) => gate.key === "tests")).toMatchObject({
      status: "fail",
      earned: 0,
    });
    expect(evaluation.verdict).toBe("REJECT");
    expect(evaluation.score).toBe(75);
  });

  it("requires an explicit true report even with positive passing counts", () => {
    const candidate = passingCandidate();
    candidate.signals.tests.passed = "true" as unknown as boolean;

    const evaluation = evaluateCandidate(candidate);

    expect(evaluation.gates.find((gate) => gate.key === "tests")?.status).toBe("fail");
    expect(evaluation.verdict).toBe("REJECT");
  });

  // Removing any user-string bound must make its over-limit payload parse.
  it.each([
    { field: "id", limit: 128 },
    { field: "agent", limit: 128 },
    { field: "model", limit: 128 },
    { field: "summary", limit: 4096 },
    { field: "branch", limit: 512 },
  ] as const)("bounds candidate $field", ({ field, limit }) => {
    const candidate = passingCandidate();
    candidate[field] = "a".repeat(limit);
    expect(candidatePatchSchema.safeParse(candidate).success).toBe(true);

    candidate[field] += "a";
    expect(candidatePatchSchema.safeParse(candidate).success).toBe(false);
  });

  it.each(["tests", "contract", "security", "migration", "performance", "evidence"] as const)(
    "bounds the reported %s note",
    (key) => {
      const candidate = passingCandidate();
      candidate.signals[key].note = "a".repeat(4096);
      expect(candidatePatchSchema.safeParse(candidate).success).toBe(true);

      candidate.signals[key].note += "a";
      expect(candidatePatchSchema.safeParse(candidate).success).toBe(false);
    },
  );

  it.each(["repository", "target"] as const)("bounds request %s", (field) => {
    const request = { ...demoRequest, [field]: "a".repeat(512) };
    expect(evaluationRequestSchema.safeParse(request).success).toBe(true);

    request[field] += "a";
    expect(evaluationRequestSchema.safeParse(request).success).toBe(false);
  });

  it("rejects a request above the candidate collection limit", () => {
    expect(evaluationRequestSchema.safeParse({
      ...demoRequest,
      candidates: Array.from({ length: 13 }, passingCandidate),
    }).success).toBe(false);
  });

  it("qualifies every verdict as a reported score without execution or release authority", () => {
    const run = evaluateRun(demoRequest);

    for (const evaluation of run.evaluations) {
      const explanation = evaluation.reasons.join(" ");
      expect(explanation).toMatch(/caller-reported signals/i);
      expect(explanation).toMatch(/does not execute tests/i);
      expect(explanation).toMatch(/authorize release/i);
      expect(explanation).not.toMatch(/release boundaries passed|reproducible evidence/i);
      expect(evaluation.gates.find((gate) => gate.key === "tests")?.label).toMatch(/reported/i);
    }
    expect(run.policy.principle).toMatch(/caller-reported/i);
    expect(run.policy.principle).toMatch(/does not authorize release/i);
  });
});
