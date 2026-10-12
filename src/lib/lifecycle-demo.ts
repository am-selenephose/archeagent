import { z } from "zod";
import { candidatePatchSchema, gateKeySchema, type EvaluationRun } from "./evaluator";

const strings = z.array(z.string());
const probability = z.number().min(0).max(1);
const reviewerSchema = z.object({
  reviewerId: z.string(), source: z.string(), catchProbability: probability,
  conservativeCatchProbability: probability, complementarityScore: z.number(),
});
const verificationResult = z.object({ valid: z.boolean(), reasons: strings });
const intelligenceSchema = z.object({
  context: z.object({
    repository: z.string(), language: z.string(), framework: z.string(),
    taskClass: z.string(), risk: z.string(),
  }),
  routing: z.object({
    agent: z.object({ id: z.string(), name: z.string(), model: z.string() }).nullable(),
    candidates: z.array(z.object({
      agentId: z.string(), successProbability: probability,
      conservativeSuccessProbability: probability, expectedUtility: z.number(),
      costUsd: z.number().nonnegative(), latencyMs: z.number().nonnegative(),
    })),
  }),
  tournament: z.object({ primary: z.string(), shadows: strings, reason: z.string() }),
  reviewerPairing: reviewerSchema.nullable(),
  reviewerCandidates: z.array(z.object({
    reviewerId: z.string(), catchProbability: probability, complementarityScore: z.number(),
  })),
  authority: z.object({ level: z.string(), reasons: strings, autoMergeAllowed: z.literal(false) }).nullable(),
  verification: z.object({
    levels: strings, humanReviewRequired: z.boolean(), maxReviewerMinutes: z.number(), rationale: strings,
  }),
  release: z.object({
    claims: z.object({
      baseSha: z.string(), patchSha: z.string(), policyHash: z.string(),
      environment: z.string(), leaseId: z.string(),
    }),
    validExactState: verificationResult, invalidAfterHeadMove: verificationResult,
  }),
  productionAttribution: z.object({
    confidence: probability, supportingSignals: strings, contradictingSignals: strings,
  }),
  productionOutcome: z.object({ outcome: z.string(), weight: z.number(), reason: z.string() }).nullable(),
});
export type IntelligenceDemo = z.infer<typeof intelligenceSchema>;

const decision = z.enum(["MERGE", "NEEDS_WORK", "REJECT"]);
const evaluationSchema: z.ZodType<EvaluationRun> = z.object({
  repository: z.string(), target: z.string(), winnerId: z.string().nullable(),
  decision, evaluatedAt: z.string(),
  evaluations: z.array(z.object({
    candidate: candidatePatchSchema,
    gates: z.array(z.object({
      key: gateKeySchema, label: z.string(), status: z.enum(["pass", "warn", "fail"]),
      weight: z.number(), earned: z.number(), note: z.string(), critical: z.boolean(),
    })),
    score: z.number(), verdict: decision, reasons: strings,
  })).max(12),
  policy: z.object({ mergeThreshold: z.number(), criticalGates: z.array(gateKeySchema), principle: z.string() }),
}).refine((run) => run.decision === "MERGE"
  ? selectLifecycleWinner(run) !== null
  : run.winnerId === null, "Fixture decision and winner identity must agree");

export type LifecycleState = {
  intelligence: IntelligenceDemo | null;
  evaluation: EvaluationRun | null;
  loading: boolean;
  error: string | null;
};

export function selectLifecycleWinner(evaluation: EvaluationRun | null) {
  if (!evaluation || evaluation.decision !== "MERGE" || evaluation.winnerId === null) return null;
  const matches = evaluation.evaluations.filter((item) => item.candidate.id === evaluation.winnerId);
  return matches.length === 1 && matches[0].verdict === "MERGE" ? matches[0] : null;
}

export async function runLifecycleDemo(update: (state: LifecycleState) => void, fetcher: typeof fetch = fetch) {
  update({ intelligence: null, evaluation: null, loading: true, error: null });
  let result: LifecycleState = { intelligence: null, evaluation: null, loading: false, error: null };
  try {
    const [intelResponse, evaluationResponse] = await Promise.all([
      fetcher("/api/intelligence/demo", { cache: "no-store" }),
      fetcher("/api/demo", { cache: "no-store" }),
    ]);
    if (!intelResponse.ok || !evaluationResponse.ok) throw new Error("Demo request failed");
    const [intel, evaluated] = await Promise.all([intelResponse.json(), evaluationResponse.json()]);
    result = {
      intelligence: intelligenceSchema.parse(intel), evaluation: evaluationSchema.parse(evaluated),
      loading: false, error: null,
    };
  } catch {
    result.error = "Could not load the fixture demo. Check your connection and retry.";
  } finally {
    update(result);
  }
}
