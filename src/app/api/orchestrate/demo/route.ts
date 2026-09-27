import { NextResponse } from 'next/server';
import { AgentRegistry } from '@/core/agent-registry';
import { MockAgentAdapter } from '@/core/adapters/mock-agent';
import { ArcheagentOrchestrator } from '@/core/orchestrator';
import type { Mission } from '@/core/types';

export async function GET() {
  const registry = new AgentRegistry();

  registry.register({
    id: 'atlas',
    name: 'Atlas',
    provider: 'local-demo',
    model: 'atlas-code',
    capabilities: ['architecture', 'backend', 'database', 'migration', 'testing'],
    trustScore: 0.94,
    costPerTaskUsd: 0.42,
    expectedLatencyMs: 24000,
    maxConcurrency: 2,
  });

  registry.register({
    id: 'sentry',
    name: 'Sentry',
    provider: 'local-demo',
    model: 'sentry-sec',
    capabilities: ['security', 'testing', 'backend'],
    trustScore: 0.97,
    costPerTaskUsd: 0.58,
    expectedLatencyMs: 28000,
    maxConcurrency: 2,
  });

  registry.register({
    id: 'velocity',
    name: 'Velocity',
    provider: 'local-demo',
    model: 'velocity-fast',
    capabilities: ['frontend', 'backend', 'testing', 'performance'],
    trustScore: 0.78,
    costPerTaskUsd: 0.18,
    expectedLatencyMs: 9000,
    maxConcurrency: 4,
  });

  const mission: Mission = {
    id: 'mission-settlement-hardening',
    repository: 'acme/billing-api',
    objective:
      'Prevent duplicate settlement credits while preserving authorization, schema safety and latency budget.',
    budgetUsd: 3,
    tasks: [
      {
        id: 'analyze',
        title: 'Map failure boundary',
        description: 'Identify the retry and persistence failure path.',
        requires: ['architecture', 'backend'],
        dependsOn: [],
        risk: 'medium',
        maxAttempts: 2,
      },
      {
        id: 'migration',
        title: 'Design durable idempotency',
        description: 'Introduce durable uniqueness and a safe migration path.',
        requires: ['database', 'migration'],
        dependsOn: ['analyze'],
        risk: 'high',
        maxAttempts: 2,
      },
      {
        id: 'security',
        title: 'Verify authorization boundary',
        description: 'Ensure retry hardening does not weaken account ownership checks.',
        requires: ['security', 'testing'],
        dependsOn: ['migration'],
        risk: 'critical',
        maxAttempts: 2,
      },
      {
        id: 'performance',
        title: 'Measure release budget',
        description: 'Verify the fix remains inside the latency budget.',
        requires: ['performance', 'testing'],
        dependsOn: ['security'],
        risk: 'low',
        maxAttempts: 2,
      },
    ],
  };

  const orchestrator = new ArcheagentOrchestrator(
    registry,
    new MockAgentAdapter(),
  );

  return NextResponse.json(await orchestrator.run(mission));
}
