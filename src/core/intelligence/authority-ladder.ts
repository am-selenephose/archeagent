import type { TrustPosterior } from './contextual-trust';

export type CalibrationReport = {
  resolvedPredictions: number;
  successes: number;
  failures: number;
  brierScore: number;
  expectedCalibrationError: number;
  brierSkillScore: number;
};

export type AuthorityLevel =
  | 'SHADOW'
  | 'PROPOSE'
  | 'EXECUTE_LOW_RISK'
  | 'EXECUTE_MEDIUM_RISK';

export type AuthorityDecision = {
  level: AuthorityLevel;
  reasons: string[];
  autoMergeAllowed: false;
};

export function decideAuthority(
  trust: TrustPosterior,
  calibration: CalibrationReport,
): AuthorityDecision {
  const reasons: string[] = [];

  const calibrated =
    calibration.resolvedPredictions >= 100 &&
    calibration.successes >= 10 &&
    calibration.failures >= 10 &&
    calibration.brierScore <= 0.15 &&
    calibration.expectedCalibrationError <= 0.1 &&
    calibration.brierSkillScore >= 0.05;

  if (!calibrated) {
    reasons.push('shadow calibration gate has not been satisfied');
    return { level: 'SHADOW', reasons, autoMergeAllowed: false };
  }

  if (
    trust.effectiveEvidence < 10 ||
    trust.conservativeScore < 0.68
  ) {
    reasons.push('contextual production evidence is still too weak');
    return { level: 'PROPOSE', reasons, autoMergeAllowed: false };
  }

  if (
    trust.effectiveEvidence >= 30 &&
    trust.conservativeScore >= 0.86
  ) {
    reasons.push(
      'strong calibrated history permits bounded medium-risk execution',
    );
    return {
      level: 'EXECUTE_MEDIUM_RISK',
      reasons,
      autoMergeAllowed: false,
    };
  }

  reasons.push(
    'calibrated history permits bounded low-risk execution only',
  );
  return {
    level: 'EXECUTE_LOW_RISK',
    reasons,
    autoMergeAllowed: false,
  };
}
