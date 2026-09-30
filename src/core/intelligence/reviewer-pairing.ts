import { contextKey, type TrustContext } from './contextual-trust';

export type ReviewObservation = {
  implementerId: string;
  reviewerId: string;
  failureClass: string;
  defectPresent: boolean;
  reviewerCaughtDefect: boolean;
  context?: TrustContext;
};

type PairStats = {
  opportunities: number;
  defects: number;
  caught: number;
  falsePositives: number;
};

type PairingSource = 'exact' | 'global' | 'prior';

function emptyStats(): PairStats {
  return {
    opportunities: 0,
    defects: 0,
    caught: 0,
    falsePositives: 0,
  };
}

function betaConservative(successes: number, failures: number) {
  const alpha = 2 + successes;
  const beta = 2 + failures;
  const total = alpha + beta;
  const mean = alpha / total;
  const variance =
    (alpha * beta) /
    (total * total * (total + 1));
  const sd = Math.sqrt(variance);

  return {
    mean,
    conservative: Math.max(0, mean - 1.28 * sd),
  };
}

function pairKey(
  implementerId: string,
  reviewerId: string,
  failureClass: string,
  context?: TrustContext,
) {
  return [
    implementerId,
    reviewerId,
    failureClass,
    context ? contextKey(context) : '*',
  ].join('::');
}

export class ReviewerPairingMatrix {
  private readonly stats = new Map<string, PairStats>();

  private observeKey(key: string, observation: ReviewObservation) {
    const current = this.stats.get(key) ?? emptyStats();

    current.opportunities += 1;
    if (observation.defectPresent) {
      current.defects += 1;
      if (observation.reviewerCaughtDefect) current.caught += 1;
    } else if (observation.reviewerCaughtDefect) {
      current.falsePositives += 1;
    }

    this.stats.set(key, current);
  }

  observe(observation: ReviewObservation) {
    this.observeKey(
      pairKey(
        observation.implementerId,
        observation.reviewerId,
        observation.failureClass,
      ),
      observation,
    );

    if (observation.context) {
      this.observeKey(
        pairKey(
          observation.implementerId,
          observation.reviewerId,
          observation.failureClass,
          observation.context,
        ),
        observation,
      );
    }
  }

  score(
    implementerId: string,
    reviewerId: string,
    failureClass: string,
  ) {
    const stats =
      this.stats.get(pairKey(implementerId, reviewerId, failureClass)) ??
      emptyStats();

    const recall =
      stats.defects === 0 ? 0.5 : stats.caught / stats.defects;
    const falsePositiveRate =
      stats.opportunities === 0
        ? 0
        : stats.falsePositives / stats.opportunities;

    return {
      ...stats,
      recall,
      falsePositiveRate,
      pairingScore: Math.max(0, recall - falsePositiveRate * 0.5),
    };
  }

  scoreContextual(
    implementerId: string,
    reviewerId: string,
    failureClass: string,
    context: TrustContext,
  ) {
    const exact = this.stats.get(
      pairKey(implementerId, reviewerId, failureClass, context),
    );
    const global = this.stats.get(
      pairKey(implementerId, reviewerId, failureClass),
    );

    let source: PairingSource = 'prior';
    let stats = emptyStats();

    if (exact && exact.opportunities > 0) {
      source = 'exact';
      stats = exact;
    } else if (global && global.opportunities > 0) {
      source = 'global';
      stats = global;
    }

    const catchPosterior = betaConservative(
      stats.caught,
      Math.max(0, stats.defects - stats.caught),
    );
    const falsePositivePosterior = betaConservative(
      stats.falsePositives,
      Math.max(0, stats.opportunities - stats.defects - stats.falsePositives),
    );

    const rawRecall =
      stats.defects === 0 ? 0.5 : stats.caught / stats.defects;
    const rawFalsePositiveRate =
      stats.opportunities === 0
        ? 0
        : stats.falsePositives / stats.opportunities;

    const complementarityScore = Math.max(
      0,
      catchPosterior.conservative -
        falsePositivePosterior.mean * 0.25,
    );

    return {
      ...stats,
      source,
      recall: rawRecall,
      falsePositiveRate: rawFalsePositiveRate,
      catchProbability: catchPosterior.mean,
      conservativeCatchProbability: catchPosterior.conservative,
      complementarityScore,
    };
  }

  rankReviewers(
    implementerId: string,
    reviewerIds: string[],
    failureClass: string,
    context: TrustContext,
  ) {
    return reviewerIds
      .map((reviewerId) => ({
        reviewerId,
        ...this.scoreContextual(
          implementerId,
          reviewerId,
          failureClass,
          context,
        ),
      }))
      .sort((a, b) =>
        b.complementarityScore - a.complementarityScore,
      );
  }
}
