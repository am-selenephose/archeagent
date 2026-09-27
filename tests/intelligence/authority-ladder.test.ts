import { describe, expect, it } from 'vitest';
import { decideAuthority } from '../../src/core/intelligence/authority-ladder';

describe('authority ladder', () => {
  it('keeps an uncalibrated agent in shadow mode', () => {
    const result = decideAuthority(
      {
        alpha: 10,
        beta: 2,
        observations: 30,
        effectiveEvidence: 20,
        mean: 0.83,
        standardDeviation: 0.08,
        conservativeScore: 0.7,
      },
      {
        resolvedPredictions: 20,
        successes: 18,
        failures: 2,
        brierScore: 0.08,
        expectedCalibrationError: 0.04,
        brierSkillScore: 0.2,
      },
    );

    expect(result.level).toBe('SHADOW');
    expect(result.autoMergeAllowed).toBe(false);
  });
});
