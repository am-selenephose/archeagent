import type { OutcomeKind, TrustContext } from './contextual-trust';

export type DeploymentObservation = {
  agentId: string;
  context: TrustContext;
  patchSha: string;
  deployedAt: string;
  observedUntil: string;
  rollback: boolean;
  hotfix: boolean;
  newSecurityFinding: boolean;
  regressionDetected: boolean;
  reviewerReversal: boolean;
  attributionConfidence: number;
};

export function classifyDeploymentOutcome(
  observation: DeploymentObservation,
): { outcome: OutcomeKind; weight: number; reason: string } | null {
  if (
    observation.attributionConfidence < 0.65 ||
    observation.observedUntil <= observation.deployedAt
  ) {
    return null;
  }

  if (observation.newSecurityFinding) {
    return {
      outcome: 'security_incident',
      weight: observation.attributionConfidence,
      reason: 'security finding attributed to the deployed patch',
    };
  }

  if (observation.rollback) {
    return {
      outcome: 'rollback',
      weight: observation.attributionConfidence,
      reason: 'deployment was rolled back',
    };
  }

  if (observation.regressionDetected || observation.hotfix) {
    return {
      outcome: 'regression',
      weight: observation.attributionConfidence,
      reason: 'post-deployment regression or corrective hotfix observed',
    };
  }

  if (observation.reviewerReversal) {
    return {
      outcome: 'review_reversal',
      weight: observation.attributionConfidence,
      reason: 'later review reversed the accepted implementation',
    };
  }

  return {
    outcome: 'production_clean',
    weight: observation.attributionConfidence,
    reason: 'observation window completed without tracked failure signals',
  };
}
