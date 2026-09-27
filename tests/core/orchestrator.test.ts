import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../../src/core/agent-registry';
import { MockAgentAdapter } from '../../src/core/adapters/mock-agent';
import { ArcheagentOrchestrator } from '../../src/core/orchestrator';
import type { Mission } from '../../src/core/types';

describe('ArcheagentOrchestrator', () => {
  it('executes a dependency graph and records event history', async () => {
    const registry = new AgentRegistry();
    registry.register({
      id: 'generalist',
      name: 'Generalist',
      provider: 'test',
      model: 'test-model',
      capabilities: [
        'architecture',
        'backend',
        'database',
        'migration',
        'testing',
      ],
      trustScore: 0.95,
      costPerTaskUsd: 0.25,
      expectedLatencyMs: 1000,
      maxConcurrency: 1,
    });

    const mission: Mission = {
      id: 'mission-test',
      repository: 'demo/repo',
      objective: 'validate orchestration',
      budgetUsd: 2,
      tasks: [
        {
          id: 'plan',
          title: 'Plan',
          description: 'Plan',
          requires: ['architecture'],
          dependsOn: [],
          risk: 'low',
          maxAttempts: 1,
        },
        {
          id: 'implement',
          title: 'Implement',
          description: 'Implement',
          requires: ['backend', 'testing'],
          dependsOn: ['plan'],
          risk: 'medium',
          maxAttempts: 1,
        },
      ],
    };

    const result = await new ArcheagentOrchestrator(
      registry,
      new MockAgentAdapter(),
    ).run(mission);

    expect(result.status).toBe('completed');
    expect(result.readyForMerge).toBe(true);
    expect(result.executions).toHaveLength(2);
    expect(result.events.some((event) => event.type === 'mission.completed')).toBe(true);
  });
});
