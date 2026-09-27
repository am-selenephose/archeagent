import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../../src/core/agent-registry';
import { AdaptiveAgentRouter } from '../../src/core/intelligence/adaptive-router';
import { ContextualTrustGraph } from '../../src/core/intelligence/contextual-trust';
import type { Mission } from '../../src/core/types';

describe('AdaptiveAgentRouter', () => {
  it('routes by contextual history rather than static profile alone', () => {
    const registry = new AgentRegistry();
    registry.register({
      id: 'generic',
      name: 'Generic',
      provider: 'test',
      model: 'generic',
      capabilities: ['security', 'testing'],
      trustScore: 0.99,
      costPerTaskUsd: 0.3,
      expectedLatencyMs: 1000,
      maxConcurrency: 1,
    });
    registry.register({
      id: 'specialist',
      name: 'Specialist',
      provider: 'test',
      model: 'specialist',
      capabilities: ['security', 'testing'],
      trustScore: 0.85,
      costPerTaskUsd: 0.4,
      expectedLatencyMs: 1200,
      maxConcurrency: 1,
    });

    const mission: Mission = {
      id: 'm',
      repository: 'billing',
      objective: 'auth',
      budgetUsd: 2,
      tasks: [
        {
          id: 't',
          title: 'Auth',
          description: 'Auth',
          requires: ['security', 'testing'],
          dependsOn: [],
          risk: 'high',
          maxAttempts: 1,
          language: 'typescript',
          framework: 'postgres',
          taskClass: 'authorization',
        },
      ],
    };

    const trust = new ContextualTrustGraph();
    const context = {
      repository: 'billing',
      language: 'typescript',
      framework: 'postgres',
      taskClass: 'authorization',
      risk: 'high' as const,
    };

    for (let i = 0; i < 16; i += 1) {
      trust.observe({
        agentId: 'specialist',
        context,
        outcome: 'production_clean',
        at: new Date(0).toISOString(),
      });
    }
    trust.observe({
      agentId: 'generic',
      context,
      outcome: 'security_incident',
      at: new Date(0).toISOString(),
    });
    trust.observe({
      agentId: 'generic',
      context,
      outcome: 'rollback',
      at: new Date(0).toISOString(),
    });

    const result = new AdaptiveAgentRouter(
      registry,
      trust,
    ).choose(mission, mission.tasks[0], 2);

    expect(result.agent?.id).toBe('specialist');
  });
});
