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

export const candidatePatchSchema = z.object({
  id: z.string().min(1),
  agent: z.string().min(1),
  model: z.string().min(1),
  summary: z.string().min(1),
  filesChanged: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  branch: z.string().min(1),
  signals: z.object({
    tests: z.object({
      passed: z.boolean(),
      total: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      note: z.string().min(1),
    }),
    contract: z.object({ passed: z.boolean(), note: z.string().min(1) }),
    security: z.object({ passed: z.boolean(), note: z.string().min(1) }),
    migration: z.object({ passed: z.boolean(), note: z.string().min(1) }),
    performance: z.object({ passed: z.boolean(), note: z.string().min(1) }),
    evidence: z.object({
      passed: z.boolean(),
      coverage: z.number().min(0).max(1),
      note: z.string().min(1),
    }),
  }),
});

export const evaluationRequestSchema = z.object({
  repository: z.string().min(1),
  target: z.string().min(1),
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
  tests: { label: "Regression suite", weight: 25, critical: true },
  contract: { label: "API contract", weight: 15, critical: true },
  security: { label: "Security boundary", weight: 20, critical: true },
  migration: { label: "Schema migration", weight: 15, critical: false },
  performance: { label: "Performance", weight: 10, critical: false },
  evidence: { label: "Evidence quality", weight: 15, critical: false },
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
  return {
    key,
    label: config.label,
    status: signal.passed ? "pass" : "fail",
    weight: config.weight,
    earned: signal.passed ? config.weight : 0,
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
      (gate) => `${gate.label} failed a critical release boundary.`,
    ),
    ...nonCriticalFailures.map(
      (gate) => `${gate.label} is incomplete and blocks automatic acceptance.`,
    ),
  ];

  if (verdict === "MERGE") {
    reasons.push("All release boundaries passed with sufficient reproducible evidence.");
  }
  if (verdict === "NEEDS_WORK" && reasons.length === 0) {
    reasons.push("The patch is plausible but the evidence score is below the merge threshold.");
  }

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
      principle: "Evidence beats confidence. A plausible patch is not a safe patch.",
    },
  };
}
