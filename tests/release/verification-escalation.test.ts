import { describe, expect, it } from 'vitest';
import { verificationPlan } from '../../src/core/release/verification-escalation';

describe('verification escalation', () => {
  it('escalates critical specified code to formal verification', () => {
    const plan = verificationPlan({
      risk: 'critical',
      touchesAuth: true,
      touchesMoney: false,
      touchesMigration: true,
      concurrencySensitive: true,
      formalSpecAvailable: true,
      reviewerMinutesBudget: 45,
    });

    expect(plan.levels).toContain('formal');
    expect(plan.levels).toContain('security');
    expect(plan.levels).toContain('property');
    expect(plan.humanReviewRequired).toBe(true);
  });
});
