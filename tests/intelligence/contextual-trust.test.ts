import { describe, expect, it } from 'vitest';
import { ContextualTrustGraph } from '../../src/core/intelligence/contextual-trust';

const context = {
  repository: 'billing-api',
  language: 'TypeScript',
  framework: 'Next.js',
  taskClass: 'authorization',
  risk: 'high' as const,
};

describe('ContextualTrustGraph', () => {
  it('penalizes production regressions more strongly than eval wins reward', () => {
    const graph = new ContextualTrustGraph();

    for (let i = 0; i < 5; i += 1) {
      graph.observe({
        agentId: 'agent-a',
        context,
        outcome: 'evaluation_pass',
        at: new Date().toISOString(),
      });
    }

    const before = graph.score('agent-a', context).posterior.mean;

    graph.observe({
      agentId: 'agent-a',
      context,
      outcome: 'security_incident',
      at: new Date().toISOString(),
    });

    const after = graph.score('agent-a', context).posterior.mean;
    expect(after).toBeLessThan(before);
  });

  it('keeps uncertainty visible through a conservative score', () => {
    const graph = new ContextualTrustGraph();
    const score = graph.score('new-agent', context).posterior;
    expect(score.conservativeScore).toBeLessThan(score.mean);
  });
});
