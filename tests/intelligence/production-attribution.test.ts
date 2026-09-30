import { describe, expect, it } from 'vitest';
import {
  classifyDeploymentOutcome,
  deriveAttributionConfidence,
  type DeploymentObservation,
} from '../../src/core/intelligence/production-outcome';

const base: Omit<DeploymentObservation, 'attributionEvidence'> = {
  agentId: 'agent-a',
  context: {
    repository: 'billing',
    language: 'typescript',
    framework: 'postgres',
    taskClass: 'authorization',
    risk: 'high',
  },
  patchSha: 'patch-1',
  deployedAt: '2026-09-30T00:00:00.000Z',
  observedUntil: '2026-09-30T02:00:00.000Z',
  rollback: true,
  hotfix: false,
  newSecurityFinding: false,
  regressionDetected: false,
  reviewerReversal: false,
};

describe('production outcome attribution', () => {
  it('derives confidence from deployment evidence instead of accepting a caller confidence scalar', () => {
    const observation: DeploymentObservation = {
      ...base,
      attributionEvidence: {
        deploymentPatchSha: 'patch-1',
        rollbackPatchSha: 'patch-1',
        touchedFiles: ['src/auth.ts'],
        incidentFiles: ['src/auth.ts'],
        errorIntroducedAfterDeployment: true,
        rollbackResolvedSignal: true,
        canaryAffected: true,
        featureFlagMatched: true,
      },
    };

    const confidence = deriveAttributionConfidence(observation);
    expect(confidence).toBeGreaterThanOrEqual(0.8);

    const classified = classifyDeploymentOutcome(observation);
    expect(classified).toMatchObject({ outcome: 'rollback' });
    expect(classified!.weight).toBeCloseTo(confidence);
  });

  it('rejects a rollback when the evidence contradicts patch attribution', () => {
    const observation: DeploymentObservation = {
      ...base,
      patchSha: 'patch-2',
      attributionEvidence: {
        deploymentPatchSha: 'different-patch',
        rollbackPatchSha: 'different-patch',
        touchedFiles: ['src/auth.ts'],
        incidentFiles: ['src/unrelated.ts'],
        errorIntroducedAfterDeployment: false,
        rollbackResolvedSignal: false,
        canaryAffected: false,
        featureFlagMatched: false,
      },
    };

    expect(deriveAttributionConfidence(observation)).toBeLessThan(0.65);
    expect(classifyDeploymentOutcome(observation)).toBeNull();
  });
});
