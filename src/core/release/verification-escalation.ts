export type VerificationLevel =
  | 'static'
  | 'tests'
  | 'security'
  | 'property'
  | 'formal';

export type VerificationPlan = {
  levels: VerificationLevel[];
  humanReviewRequired: boolean;
  maxReviewerMinutes: number;
  rationale: string[];
};

export function verificationPlan(input: {
  risk: 'low' | 'medium' | 'high' | 'critical';
  touchesAuth: boolean;
  touchesMoney: boolean;
  touchesMigration: boolean;
  concurrencySensitive: boolean;
  formalSpecAvailable: boolean;
  reviewerMinutesBudget: number;
}): VerificationPlan {
  const levels = new Set<VerificationLevel>(['static', 'tests']);
  const rationale: string[] = [];

  if (input.touchesAuth || input.touchesMoney) {
    levels.add('security');
    rationale.push('authority-sensitive change requires security verification');
  }

  if (
    input.touchesMigration ||
    input.concurrencySensitive ||
    input.risk === 'high' ||
    input.risk === 'critical'
  ) {
    levels.add('property');
    rationale.push(
      'high-risk state transition requires invariant/property verification',
    );
  }

  if (
    input.risk === 'critical' &&
    input.formalSpecAvailable
  ) {
    levels.add('formal');
    rationale.push(
      'critical bounded domain with a formal specification escalates to machine-checked proof',
    );
  }

  const humanReviewRequired =
    input.risk === 'high' ||
    input.risk === 'critical' ||
    input.touchesAuth ||
    input.touchesMoney;

  return {
    levels: [...levels],
    humanReviewRequired,
    maxReviewerMinutes: Math.max(0, input.reviewerMinutesBudget),
    rationale,
  };
}
