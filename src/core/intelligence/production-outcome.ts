import type { OutcomeKind, TrustContext } from './contextual-trust';

export type AttributionEvidence = {
  deploymentPatchSha?: string;
  rollbackPatchSha?: string;
  touchedFiles?: string[];
  incidentFiles?: string[];
  errorIntroducedAfterDeployment?: boolean;
  rollbackResolvedSignal?: boolean;
  canaryAffected?: boolean;
  featureFlagMatched?: boolean;
  traceCorrelation?: number;
  codeOwnershipMatch?: boolean;
};

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
  attributionEvidence?: AttributionEvidence;
  /**
   * @deprecated Caller-supplied confidence is retained only for wire compatibility
   * and is never used to authorize trust updates.
   */
  attributionConfidence?: number;
};

export type AttributionAssessment = {
  confidence: number;
  supportingSignals: string[];
  contradictingSignals: string[];
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function normalizePath(value: string) {
  return value.trim().replace(/^\.\//, '').toLowerCase();
}

function overlapRatio(left: string[] = [], right: string[] = []) {
  if (left.length === 0 || right.length === 0) return 0;

  const a = new Set(left.map(normalizePath));
  const b = new Set(right.map(normalizePath));
  let overlap = 0;

  for (const item of a) {
    if (b.has(item)) overlap += 1;
  }

  return overlap / Math.max(a.size, b.size);
}

export function assessAttribution(
  observation: DeploymentObservation,
): AttributionAssessment {
  const evidence = observation.attributionEvidence;
  const supportingSignals: string[] = [];
  const contradictingSignals: string[] = [];

  if (!evidence) {
    return {
      confidence: 0,
      supportingSignals,
      contradictingSignals: [
        'no independently derived attribution evidence supplied',
      ],
    };
  }

  let evidenceFor = 0;
  let evidenceAgainst = 0;

  if (evidence.deploymentPatchSha) {
    if (evidence.deploymentPatchSha === observation.patchSha) {
      evidenceFor += 3;
      supportingSignals.push('deployed patch SHA matches observed patch');
    } else {
      evidenceAgainst += 5;
      contradictingSignals.push('deployed patch SHA contradicts observed patch');
    }
  }

  if (observation.rollback && evidence.rollbackPatchSha) {
    if (evidence.rollbackPatchSha === observation.patchSha) {
      evidenceFor += 2;
      supportingSignals.push('rollback points at the observed patch');
    } else {
      evidenceAgainst += 3;
      contradictingSignals.push('rollback points at a different patch');
    }
  }

  const fileOverlap = overlapRatio(
    evidence.touchedFiles,
    evidence.incidentFiles,
  );
  if (fileOverlap > 0) {
    evidenceFor += 2 * fileOverlap;
    supportingSignals.push(
      `incident and patch files overlap (${Math.round(fileOverlap * 100)}%)`,
    );
  } else if (
    (evidence.touchedFiles?.length ?? 0) > 0 &&
    (evidence.incidentFiles?.length ?? 0) > 0
  ) {
    evidenceAgainst += 2;
    contradictingSignals.push('incident files do not overlap patch files');
  }

  if (evidence.errorIntroducedAfterDeployment === true) {
    evidenceFor += 1.5;
    supportingSignals.push('failure signal began after deployment');
  } else if (evidence.errorIntroducedAfterDeployment === false) {
    evidenceAgainst += 1.5;
    contradictingSignals.push('failure signal predates deployment');
  }

  if (evidence.rollbackResolvedSignal === true) {
    evidenceFor += 2;
    supportingSignals.push('rollback removed the failure signal');
  } else if (evidence.rollbackResolvedSignal === false && observation.rollback) {
    evidenceAgainst += 1;
    contradictingSignals.push('rollback did not remove the failure signal');
  }

  if (evidence.canaryAffected === true) {
    evidenceFor += 1;
    supportingSignals.push('canary population reproduced the signal');
  } else if (evidence.canaryAffected === false) {
    evidenceAgainst += 0.5;
    contradictingSignals.push('canary population did not reproduce the signal');
  }

  if (evidence.featureFlagMatched === true) {
    evidenceFor += 1;
    supportingSignals.push('feature-flag exposure matches the incident cohort');
  } else if (evidence.featureFlagMatched === false) {
    evidenceAgainst += 0.75;
    contradictingSignals.push('feature-flag exposure contradicts attribution');
  }

  if (typeof evidence.traceCorrelation === 'number') {
    const traceCorrelation = clamp01(evidence.traceCorrelation);
    evidenceFor += traceCorrelation * 2;
    evidenceAgainst += (1 - traceCorrelation) * 0.5;
    if (traceCorrelation >= 0.6) {
      supportingSignals.push('runtime traces correlate with the changed path');
    }
  }

  if (evidence.codeOwnershipMatch === true) {
    evidenceFor += 0.5;
    supportingSignals.push('incident ownership matches changed subsystem');
  }

  const total = evidenceFor + evidenceAgainst;
  const confidence =
    total === 0
      ? 0
      : clamp01(
          (evidenceFor / total) *
            Math.min(1, total / 6),
        );

  return {
    confidence,
    supportingSignals,
    contradictingSignals,
  };
}

export function deriveAttributionConfidence(
  observation: DeploymentObservation,
) {
  return assessAttribution(observation).confidence;
}

export function classifyDeploymentOutcome(
  observation: DeploymentObservation,
): { outcome: OutcomeKind; weight: number; reason: string } | null {
  const attribution = assessAttribution(observation);

  if (
    attribution.confidence < 0.65 ||
    observation.observedUntil <= observation.deployedAt
  ) {
    return null;
  }

  const suffix =
    attribution.supportingSignals.length === 0
      ? ''
      : `; evidence: ${attribution.supportingSignals.join(', ')}`;

  if (observation.newSecurityFinding) {
    return {
      outcome: 'security_incident',
      weight: attribution.confidence,
      reason: 'security finding attributed to the deployed patch' + suffix,
    };
  }

  if (observation.rollback) {
    return {
      outcome: 'rollback',
      weight: attribution.confidence,
      reason: 'deployment was rolled back' + suffix,
    };
  }

  if (observation.regressionDetected || observation.hotfix) {
    return {
      outcome: 'regression',
      weight: attribution.confidence,
      reason:
        'post-deployment regression or corrective hotfix observed' + suffix,
    };
  }

  if (observation.reviewerReversal) {
    return {
      outcome: 'review_reversal',
      weight: attribution.confidence,
      reason: 'later review reversed the accepted implementation' + suffix,
    };
  }

  return {
    outcome: 'production_clean',
    weight: attribution.confidence,
    reason:
      'observation window completed without tracked failure signals' + suffix,
  };
}
