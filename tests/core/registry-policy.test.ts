import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../../src/core/agent-registry';
import { evaluatePolicy } from '../../src/core/policy-engine';
import type { AgentProfile, Mission, MissionTask } from '../../src/core/types';

const task: MissionTask = {
  id: 'secure',
  title: 'Secure',
  description: 'Secure',
  requires: ['security', 'testing'],
  dependsOn: [],
  risk: 'critical',
  maxAttempts: 2,
};

const trusted: AgentProfile = {
  id: 'trusted',
  name: 'Trusted',
  provider: 'test',
  model: 'trusted',
  capabilities: ['security', 'testing'],
  trustScore: 0.98,
  costPerTaskUsd: 0.5,
  expectedLatencyMs: 10000,
  maxConcurrency: 1,
};

const mission: Mission = {
  id: 'm1',
  repository: 'demo/repo',
  objective: 'test',
  budgetUsd: 1,
  tasks: [task],
};

describe('registry and policy', () => {
  it('routes to a capable trusted agent', () => {
    const registry = new AgentRegistry();
    registry.register(trusted);
    expect(registry.choose(task, 1)?.id).toBe('trusted');
  });

  it('requires human approval for critical tasks', () => {
    const decision = evaluatePolicy({
      mission,
      task,
      agent: trusted,
      spentUsd: 0,
      attempts: 0,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresHumanApproval).toBe(true);
  });

  it('blocks execution that exceeds mission budget', () => {
    const decision = evaluatePolicy({
      mission,
      task,
      agent: trusted,
      spentUsd: 0.75,
      attempts: 0,
    });

    expect(decision.allowed).toBe(false);
  });
});
