import {
  generateKeyPairSync,
} from 'node:crypto';
import { NextResponse } from 'next/server';
import { AgentRegistry } from '@/core/agent-registry';
import { AdaptiveAgentRouter } from '@/core/intelligence/adaptive-router';
import { decideAuthority } from '@/core/intelligence/authority-ladder';
import {
  ContextualTrustGraph,
  type TrustContext,
} from '@/core/intelligence/contextual-trust';
import { ReviewerPairingMatrix } from '@/core/intelligence/reviewer-pairing';
import { assignTournament } from '@/core/intelligence/shadow-tournament';
import { evidenceMerkleRoot } from '@/core/release/evidence-root';
import {
  issueReleaseLease,
  verifyReleaseLease,
} from '@/core/release/release-lease';
import { verificationPlan } from '@/core/release/verification-escalation';
import type { Mission, MissionTask } from '@/core/types';

const context: TrustContext = {
  repository: 'acme/billing-api',
  language: 'typescript',
  framework: 'postgres',
  taskClass: 'authorization',
  risk: 'high',
};

export async function GET() {
  const registry = new AgentRegistry();

  const agents = [
    {
      id: 'velocity',
      name: 'Velocity',
      provider: 'demo',
      model: 'fast-generalist',
      capabilities: ['backend', 'testing', 'security'] as const,
      trustScore: 0.8,
      costPerTaskUsd: 0.2,
      expectedLatencyMs: 9000,
      maxConcurrency: 4,
    },
    {
      id: 'sentry',
      name: 'Sentry',
      provider: 'demo',
      model: 'security-specialist',
      capabilities: ['backend', 'testing', 'security'] as const,
      trustScore: 0.92,
      costPerTaskUsd: 0.65,
      expectedLatencyMs: 27000,
      maxConcurrency: 2,
    },
    {
      id: 'atlas',
      name: 'Atlas',
      provider: 'demo',
      model: 'systems-specialist',
      capabilities: ['backend', 'testing', 'security'] as const,
      trustScore: 0.9,
      costPerTaskUsd: 0.48,
      expectedLatencyMs: 19000,
      maxConcurrency: 2,
    },
  ].map((agent) => ({
    ...agent,
    capabilities: [...agent.capabilities],
  }));

  for (const agent of agents) registry.register(agent);

  const trust = new ContextualTrustGraph();

  for (let i = 0; i < 18; i += 1) {
    trust.observe({
      agentId: 'sentry',
      context,
      outcome: 'production_clean',
      at: new Date(0).toISOString(),
    });
  }
  trust.observe({
    agentId: 'sentry',
    context,
    outcome: 'regression',
    at: new Date(0).toISOString(),
  });

  for (let i = 0; i < 16; i += 1) {
    trust.observe({
      agentId: 'velocity',
      context,
      outcome: i < 10 ? 'production_clean' : 'evaluation_pass',
      at: new Date(0).toISOString(),
    });
  }
  trust.observe({
    agentId: 'velocity',
    context,
    outcome: 'security_incident',
    at: new Date(0).toISOString(),
  });
  trust.observe({
    agentId: 'velocity',
    context,
    outcome: 'rollback',
    at: new Date(0).toISOString(),
  });

  for (let i = 0; i < 14; i += 1) {
    trust.observe({
      agentId: 'atlas',
      context,
      outcome: 'production_clean',
      at: new Date(0).toISOString(),
    });
  }
  trust.observe({
    agentId: 'atlas',
    context,
    outcome: 'review_reversal',
    at: new Date(0).toISOString(),
  });

  const task: MissionTask = {
    id: 'auth-hardening',
    title: 'Harden authorization retry boundary',
    description:
      'Fix a retry bug without weakening tenant ownership checks.',
    requires: ['backend', 'testing', 'security'],
    dependsOn: [],
    risk: 'high',
    maxAttempts: 2,
    language: context.language,
    framework: context.framework,
    taskClass: context.taskClass,
  };

  const mission: Mission = {
    id: 'intel-demo',
    repository: context.repository,
    objective: task.description,
    budgetUsd: 3,
    tasks: [task],
  };

  const routing = new AdaptiveAgentRouter(
    registry,
    trust,
  ).choose(mission, task, 3);

  const tournament = assignTournament(
    registry.list(),
    trust,
    context,
    'archeagent-demo-20260927',
    0.2,
  );

  const pairing = new ReviewerPairingMatrix();
  for (let i = 0; i < 8; i += 1) {
    pairing.observe({
      implementerId: 'velocity',
      reviewerId: 'sentry',
      failureClass: 'authorization',
      defectPresent: true,
      reviewerCaughtDefect: i < 7,
    });
  }

  const selected = routing.agent;
  const selectedTrust = selected
    ? trust.score(selected.id, context).posterior
    : null;

  const authority = selectedTrust
    ? decideAuthority(selectedTrust, {
        resolvedPredictions: 128,
        successes: 101,
        failures: 27,
        brierScore: 0.11,
        expectedCalibrationError: 0.07,
        brierSkillScore: 0.09,
      })
    : null;

  const verification = verificationPlan({
    risk: 'high',
    touchesAuth: true,
    touchesMoney: false,
    touchesMigration: false,
    concurrencySensitive: true,
    formalSpecAvailable: false,
    reviewerMinutesBudget: 35,
  });

  const evidenceHashes = [
    'a'.repeat(64),
    'b'.repeat(64),
    'c'.repeat(64),
    'd'.repeat(64),
  ];
  const evidenceRoot = evidenceMerkleRoot(evidenceHashes);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const now = new Date('2026-09-27T00:00:00Z');

  const lease = issueReleaseLease(
    privateKey,
    {
      repository: context.repository,
      baseSha: 'base-8f12c6d',
      patchSha: 'patch-41ac990',
      policyHash: 'policy-2b317e9',
      evidenceRoot,
      environment: 'staging',
      expiresAt: '2026-09-27T00:10:00Z',
    },
    now,
  );

  const leaseVerification = await verifyReleaseLease(
    lease,
    publicKey,
    {
      repository: context.repository,
      baseSha: 'base-8f12c6d',
      patchSha: 'patch-41ac990',
      policyHash: 'policy-2b317e9',
      evidenceRoot,
      environment: 'staging',
      now: new Date('2026-09-27T00:01:00Z'),
    },
  );

  const movedHeadVerification = await verifyReleaseLease(
    lease,
    publicKey,
    {
      repository: context.repository,
      baseSha: 'base-MOVED',
      patchSha: 'patch-41ac990',
      policyHash: 'policy-2b317e9',
      evidenceRoot,
      environment: 'staging',
      now: new Date('2026-09-27T00:01:00Z'),
    },
  );

  return NextResponse.json({
    context,
    routing,
    tournament: {
      primary: tournament.primary.id,
      shadows: tournament.shadows.map((agent) => agent.id),
      reason: tournament.reason,
    },
    reviewerPairing: pairing.score(
      'velocity',
      'sentry',
      'authorization',
    ),
    authority,
    verification,
    release: {
      claims: lease.claims,
      signaturePrefix: lease.signature.slice(0, 18),
      validExactState: leaseVerification,
      invalidAfterHeadMove: movedHeadVerification,
    },
  });
}
