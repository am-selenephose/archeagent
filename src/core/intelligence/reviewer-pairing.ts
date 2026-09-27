export type ReviewObservation = {
  implementerId: string;
  reviewerId: string;
  failureClass: string;
  defectPresent: boolean;
  reviewerCaughtDefect: boolean;
};

type PairStats = {
  opportunities: number;
  defects: number;
  caught: number;
  falsePositives: number;
};

export class ReviewerPairingMatrix {
  private readonly stats = new Map<string, PairStats>();

  observe(observation: ReviewObservation) {
    const key = [
      observation.implementerId,
      observation.reviewerId,
      observation.failureClass,
    ].join('::');

    const current = this.stats.get(key) ?? {
      opportunities: 0,
      defects: 0,
      caught: 0,
      falsePositives: 0,
    };

    current.opportunities += 1;
    if (observation.defectPresent) {
      current.defects += 1;
      if (observation.reviewerCaughtDefect) current.caught += 1;
    } else if (observation.reviewerCaughtDefect) {
      current.falsePositives += 1;
    }

    this.stats.set(key, current);
  }

  score(
    implementerId: string,
    reviewerId: string,
    failureClass: string,
  ) {
    const key = [implementerId, reviewerId, failureClass].join('::');
    const stats = this.stats.get(key) ?? {
      opportunities: 0,
      defects: 0,
      caught: 0,
      falsePositives: 0,
    };

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
}
