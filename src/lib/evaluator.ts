import { z } from "zod";

export const gateKeySchema = z.enum([
  "tests",
  "contract",
  "security",
  "migration",
  "performance",
  "evidence",
]);

export type GateKey = z.infer<typeof gateKeySchema>;
export type GateStatus = "pass" | "warn" | "fail";

const identifierSchema = z.string().min(1).max(128);
const referenceSchema = z.string().min(1).max(512);
const reportedTextSchema = z.string().min(1).max(4096);

export const candidatePatchSchema = z.object({
  id: identifierSchema,
  agent: identifierSchema,
  model: identifierSchema,
  summary: reportedTextSchema,
  filesChanged: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  branch: referenceSchema,
  signals: z.object({
    tests: z.object({
      passed: z.boolean(),
      total: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      note: reportedTextSchema,
    }),
    contract: z.object({ passed: z.boolean(), note: reportedTextSchema }),
    security: z.object({ passed: z.boolean(), note: reportedTextSchema }),
    migration: z.object({ passed: z.boolean(), note: reportedTextSchema }),
    performance: z.object({ passed: z.boolean(), note: reportedTextSchema }),
    evidence: z.object({
      passed: z.boolean(),
      coverage: z.number().min(0).max(1),
      note: reportedTextSchema,
    }),
  }),
});

export const evaluationRequestSchema = z.object({
  repository: referenceSchema,
  target: referenceSchema,
  candidates: z.array(candidatePatchSchema).min(1).max(12),
});

export type CandidatePatch = z.infer<typeof candidatePatchSchema>;
export type EvaluationRequest = z.infer<typeof evaluationRequestSchema>;

export type GateResult = {
  key: GateKey;
  label: string;
  status: GateStatus;
  weight: number;
  earned: number;
  note: string;
  critical: boolean;
};

export type CandidateEvaluation = {
  candidate: CandidatePatch;
  gates: GateResult[];
  score: number;
  verdict: "MERGE" | "NEEDS_WORK" | "REJECT";
  reasons: string[];
};

export type EvaluationRun = {
  repository: string;
  target: string;
  winnerId: string | null;
  decision: "MERGE" | "NEEDS_WORK" | "REJECT";
  evaluatedAt: string;
  evaluations: CandidateEvaluation[];
  policy: {
    mergeThreshold: number;
    criticalGates: GateKey[];
    principle: string;
  };
};

const gateConfig: Record<
  GateKey,
  { label: string; weight: number; critical: boolean }
> = {
  tests: { label: "Reported regression suite", weight: 25, critical: true },
  contract: { label: "Reported API contract", weight: 15, critical: true },
  security: { label: "Reported security boundary", weight: 20, critical: true },
  migration: { label: "Reported schema migration", weight: 15, critical: false },
  performance: { label: "Reported performance", weight: 10, critical: false },
  evidence: { label: "Reported evidence quality", weight: 15, critical: false },
};

function gateResult(candidate: CandidatePatch, key: GateKey): GateResult {
  const config = gateConfig[key];

  if (key === "evidence") {
    const evidence = candidate.signals.evidence;
    const status: GateStatus = evidence.passed
      ? "pass"
      : evidence.coverage >= 0.6
        ? "warn"
        : "fail";
    return {
      key,
      label: config.label,
      status,
      weight: config.weight,
      earned: Math.round(config.weight * evidence.coverage),
      note: evidence.note,
      critical: config.critical,
    };
  }

  const signal = candidate.signals[key];
  const passed = key === "tests"
    ? signal.passed === true &&
      Number.isSafeInteger(candidate.signals.tests.total) &&
      candidate.signals.tests.total > 0 &&
      Number.isSafeInteger(candidate.signals.tests.failed) &&
      candidate.signals.tests.failed === 0
    : signal.passed;

  return {
    key,
    label: config.label,
    status: passed ? "pass" : "fail",
    weight: config.weight,
    earned: passed ? config.weight : 0,
    note: signal.note,
    critical: config.critical,
  };
}

export function evaluateCandidate(candidate: CandidatePatch): CandidateEvaluation {
  const gates = gateKeySchema.options.map((key) => gateResult(candidate, key));
  const score = gates.reduce((sum, gate) => sum + gate.earned, 0);
  const criticalFailures = gates.filter(
    (gate) => gate.critical && gate.status === "fail",
  );
  const nonCriticalFailures = gates.filter(
    (gate) => !gate.critical && gate.status === "fail",
  );

  let verdict: CandidateEvaluation["verdict"];
  if (criticalFailures.length > 0) verdict = "REJECT";
  else if (score >= 85 && nonCriticalFailures.length === 0) verdict = "MERGE";
  else verdict = "NEEDS_WORK";

  const reasons = [
    ...criticalFailures.map(
      (gate) => `${gate.label} failed a critical reported-signal gate.`,
    ),
    ...nonCriticalFailures.map(
      (gate) => `${gate.label} is incomplete and blocks a MERGE scoring verdict.`,
    ),
  ];

  if (verdict === "MERGE") {
    reasons.push("All reported gates passed with sufficient reported evidence for a MERGE scoring verdict.");
  }
  if (verdict === "NEEDS_WORK" && reasons.length === 0) {
    reasons.push("The reported evidence score is below the MERGE scoring threshold.");
  }
  reasons.push("This result scores caller-reported signals; it does not execute tests or authorize release.");

  return { candidate, gates, score, verdict, reasons };
}

export function evaluateRun(input: EvaluationRequest): EvaluationRun {
  const parsed = evaluationRequestSchema.parse(input);
  const evaluations = parsed.candidates
    .map(evaluateCandidate)
    .sort((a, b) => b.score - a.score);
  const winner = evaluations.find((evaluation) => evaluation.verdict === "MERGE");
  const decision: EvaluationRun["decision"] = winner
    ? "MERGE"
    : evaluations.some((evaluation) => evaluation.verdict === "NEEDS_WORK")
      ? "NEEDS_WORK"
      : "REJECT";

  return {
    repository: parsed.repository,
    target: parsed.target,
    winnerId: winner?.candidate.id ?? null,
    decision,
    evaluatedAt: new Date().toISOString(),
    evaluations,
    policy: {
      mergeThreshold: 85,
      criticalGates: ["tests", "contract", "security"],
      principle: "Caller-reported signals only. MERGE is a scoring verdict; it does not authorize release or attest executed tests.",
    },
  };
}
