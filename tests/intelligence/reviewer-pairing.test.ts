import { describe, expect, it } from 'vitest';
import { ReviewerPairingMatrix } from '../../src/core/intelligence/reviewer-pairing';

describe('reviewer pairing matrix', () => {
  it('learns which reviewer catches an implementer failure class', () => {
    const matrix = new ReviewerPairingMatrix();

    matrix.observe({
      implementerId: 'fast-agent',
      reviewerId: 'security-agent',
      failureClass: 'auth',
      defectPresent: true,
      reviewerCaughtDefect: true,
    });

    matrix.observe({
      implementerId: 'fast-agent',
      reviewerId: 'security-agent',
      failureClass: 'auth',
      defectPresent: true,
      reviewerCaughtDefect: true,
    });

    expect(
      matrix.score('fast-agent', 'security-agent', 'auth').pairingScore,
    ).toBe(1);
  });
});
