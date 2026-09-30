import { describe, expect, it } from 'vitest';
import { ReviewerPairingMatrix } from '../../src/core/intelligence/reviewer-pairing';

describe('ReviewerPairingMatrix contextual complementarity', () => {
  it('prefers the reviewer that covers this implementer blind spot in this repository context', () => {
    const matrix = new ReviewerPairingMatrix();
    const context = {
      repository: 'billing',
      language: 'typescript',
      framework: 'postgres',
      taskClass: 'authorization',
      risk: 'high' as const,
    };

    for (let i = 0; i < 10; i += 1) {
      matrix.observe({
        implementerId: 'velocity',
        reviewerId: 'sentry',
        failureClass: 'authorization',
        defectPresent: true,
        reviewerCaughtDefect: i < 9,
        context,
      });
      matrix.observe({
        implementerId: 'velocity',
        reviewerId: 'generalist',
        failureClass: 'authorization',
        defectPresent: true,
        reviewerCaughtDefect: i < 4,
        context,
      });
    }

    const sentry = matrix.scoreContextual('velocity', 'sentry', 'authorization', context);
    const generalist = matrix.scoreContextual('velocity', 'generalist', 'authorization', context);

    expect(sentry.catchProbability).toBeGreaterThan(generalist.catchProbability);
    expect(sentry.complementarityScore).toBeGreaterThan(generalist.complementarityScore);
    expect(sentry.source).toBe('exact');
  });
});
