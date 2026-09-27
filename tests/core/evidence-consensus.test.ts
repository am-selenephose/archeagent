import { describe, expect, it } from 'vitest';
import { weightedConsensus } from '../../src/core/consensus';
import { EvidenceGraph } from '../../src/core/evidence-graph';

describe('evidence graph and judge consensus', () => {
  it('content-addresses evidence', () => {
    const graph = new EvidenceGraph();
    const first = graph.add({
      taskId: 'task-1',
      kind: 'test',
      source: 'runner',
      passed: true,
      payload: { passed: 42, failed: 0 },
    });
    const second = graph.add({
      taskId: 'task-1',
      kind: 'test',
      source: 'runner',
      passed: true,
      payload: { passed: 42, failed: 0 },
    });

    expect(first.sha256).toBe(second.sha256);
    expect(graph.allPassingForTask('task-1')).toBe(true);
  });

  it('uses weighted quorum instead of simple majority', () => {
    const result = weightedConsensus([
      {
        judgeId: 'security',
        trustWeight: 1,
        decision: 'reject',
        reason: 'authorization regression',
      },
      {
        judgeId: 'tests',
        trustWeight: 0.9,
        decision: 'reject',
        reason: 'retry regression',
      },
      {
        judgeId: 'style',
        trustWeight: 0.2,
        decision: 'accept',
        reason: 'looks reasonable',
      },
    ]);

    expect(result.decision).toBe('reject');
  });
});
