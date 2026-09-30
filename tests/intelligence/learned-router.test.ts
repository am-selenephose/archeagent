import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../../src/core/agent-registry';
import { AdaptiveAgentRouter } from '../../src/core/intelligence/adaptive-router';
import { ContextualTrustGraph } from '../../src/core/intelligence/contextual-trust';
import type { Mission } from '../../src/core/types';

describe('AdaptiveAgentRouter empirical utility', () => {
  it('exposes learned success probability and expected utility instead of a hand-weighted score', () => {
    const registry = new AgentRegistry();
    registry.register({
      id: 'cheap',
      name: 'Cheap',
      provider: 'test',
      model: 'cheap',
      capabilities: ['backend', 'testing'],
      trustScore: 0.99,
      costPerTaskUsd: 0.1,
      expectedLatencyMs: 1000,
      maxConcurrency: 1,
    });
    registry.register({
      id: 'survivor',
      name: 'Survivor',
      provider: 'test',
      model: 'survivor',
      capabilities: ['backend', 'testing'],
      trustScore: 0.6,
      costPerTaskUsd: 1.2,
      expectedLatencyMs: 15000,
      maxConcurrency: 1,
    });

    const mission: Mission = {
      id: 'm',
      repository: 'payments',
      objective: 'protect settlement correctness',
      budgetUsd: 5,
      tasks: [{
        id: 't',
        title: 'Settlement retry',
        description: 'Prevent duplicate settlement under retry',
        requires: ['backend', 'testing'],
        dependsOn: [],
        risk: 'critical',
        maxAttempts: 1,
        language: 'typescript',
        framework: 'postgres',
        taskClass: 'concurrency',
      }],
    };

    const trust = new ContextualTrustGraph();
    const context = {
      repository: 'payments',
      language: 'typescript',
      framework: 'postgres',
      taskClass: 'concurrency',
      risk: 'critical' as const,
    };

    for (let i = 0; i < 30; i += 1) {
      trust.observe({
        agentId: 'survivor',
        context,
        outcome: 'production_clean',
        at: '2026-09-30T00:00:00.000Z',
      });
    }
    for (let i = 0; i < 8; i += 1) {
      trust.observe({
        agentId: 'cheap',
        context,
        outcome: 'rollback',
        at: '2026-09-30T00:00:00.000Z',
      });
    }

    const decision = new AdaptiveAgentRouter(registry, trust).choose(
      mission,
      mission.tasks[0]!,
      mission.budgetUsd,
    );

    expect(decision.agent?.id).toBe('survivor');
    expect(decision.candidates[0]).toEqual(expect.objectContaining({
      successProbability: expect.any(Number),
      expectedUtility: expect.any(Number),
    }));
    expect(decision.candidates[0]!.expectedUtility)
      .toBeGreaterThan(decision.candidates[1]!.expectedUtility);
  });
});
