export type TrustContext = {
  repository: string;
  language: string;
  framework: string;
  taskClass: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
};

export type OutcomeKind =
  | 'evaluation_pass'
  | 'production_clean'
  | 'review_reversal'
  | 'rollback'
  | 'regression'
  | 'security_incident';

export type TrustObservation = {
  agentId: string;
  context: TrustContext;
  outcome: OutcomeKind;
  weight?: number;
  at: string;
};

export type TrustPosterior = {
  alpha: number;
  beta: number;
  observations: number;
  effectiveEvidence: number;
  mean: number;
  standardDeviation: number;
  conservativeScore: number;
};

type Bucket = {
  alpha: number;
  beta: number;
  observations: number;
  effectiveEvidence: number;
};

const OUTCOME_WEIGHT: Record<OutcomeKind, number> = {
  evaluation_pass: 0.35,
  production_clean: 1,
  review_reversal: -0.55,
  rollback: -1.2,
  regression: -0.9,
  security_incident: -2,
};

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

export function contextKey(context: TrustContext) {
  return [
    normalize(context.repository),
    normalize(context.language),
    normalize(context.framework),
    normalize(context.taskClass),
    context.risk,
  ].join('|');
}

function generalizedKeys(context: TrustContext) {
  const repo = normalize(context.repository);
  const language = normalize(context.language);
  const framework = normalize(context.framework);
  const taskClass = normalize(context.taskClass);

  return [
    contextKey(context),
    ['*', language, framework, taskClass, context.risk].join('|'),
    ['*', language, '*', taskClass, context.risk].join('|'),
    ['*', '*', '*', taskClass, context.risk].join('|'),
    ['*', '*', '*', taskClass, '*'].join('|'),
    ['*', '*', '*', '*', '*'].join('|'),
    [repo, '*', '*', '*', '*'].join('|'),
  ];
}

function posterior(bucket: Bucket): TrustPosterior {
  const total = bucket.alpha + bucket.beta;
  const mean = bucket.alpha / total;
  const variance =
    (bucket.alpha * bucket.beta) /
    (total * total * (total + 1));
  const standardDeviation = Math.sqrt(variance);

  return {
    ...bucket,
    mean,
    standardDeviation,
    conservativeScore: Math.max(0, mean - 1.64 * standardDeviation),
  };
}

export class ContextualTrustGraph {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly priorAlpha = 2,
    private readonly priorBeta = 2,
  ) {}

  private getOrCreate(key: string) {
    const existing = this.buckets.get(key);
    if (existing) return existing;

    const bucket: Bucket = {
      alpha: this.priorAlpha,
      beta: this.priorBeta,
      observations: 0,
      effectiveEvidence: 0,
    };
    this.buckets.set(key, bucket);
    return bucket;
  }

  observe(observation: TrustObservation) {
    const raw = OUTCOME_WEIGHT[observation.outcome];
    const magnitude = Math.abs(raw) * (observation.weight ?? 1);
    const success = raw > 0;

    for (const key of generalizedKeys(observation.context)) {
      const bucket = this.getOrCreate(observation.agentId + '::' + key);
      if (success) bucket.alpha += magnitude;
      else bucket.beta += magnitude;
      bucket.observations += 1;
      bucket.effectiveEvidence += magnitude;
    }
  }

  score(agentId: string, context: TrustContext) {
    const keys = generalizedKeys(context);
    const levels = keys
      .map((key, index) => {
        const bucket = this.buckets.get(agentId + '::' + key);
        return bucket ? { specificity: index, posterior: posterior(bucket) } : null;
      })
      .filter(
        (
          item,
        ): item is { specificity: number; posterior: TrustPosterior } =>
          item !== null,
      );

    if (levels.length === 0) {
      return {
        agentId,
        context,
        posterior: posterior({
          alpha: this.priorAlpha,
          beta: this.priorBeta,
          observations: 0,
          effectiveEvidence: 0,
        }),
        source: 'prior' as const,
      };
    }

    const exact = levels.find((item) => item.specificity === 0);
    if (exact && exact.posterior.effectiveEvidence >= 3) {
      return {
        agentId,
        context,
        posterior: exact.posterior,
        source: 'exact' as const,
      };
    }

    let weightedMean = 0;
    let weightedVariance = 0;
    let totalWeight = 0;
    let observations = 0;
    let effectiveEvidence = 0;

    for (const level of levels) {
      const specificityWeight = 1 / (1 + level.specificity);
      const evidenceWeight = Math.min(
        1,
        level.posterior.effectiveEvidence / 6,
      );
      const weight = specificityWeight * Math.max(0.15, evidenceWeight);

      weightedMean += level.posterior.mean * weight;
      weightedVariance +=
        level.posterior.standardDeviation *
        level.posterior.standardDeviation *
        weight;
      totalWeight += weight;
      observations += level.posterior.observations;
      effectiveEvidence += level.posterior.effectiveEvidence;
    }

    const mean = weightedMean / totalWeight;
    const standardDeviation = Math.sqrt(weightedVariance / totalWeight);

    return {
      agentId,
      context,
      posterior: {
        alpha: 0,
        beta: 0,
        observations,
        effectiveEvidence,
        mean,
        standardDeviation,
        conservativeScore: Math.max(
          0,
          mean - 1.64 * standardDeviation,
        ),
      },
      source: 'hierarchical' as const,
    };
  }
}
