import { describe, expect, it } from 'vitest';
import {
  balancedSample,
  parseTaskDataset,
  validateAgentMatrix,
} from '../../benchmarks/provider/harness.mjs';

describe('provider benchmark harness', () => {
  it('loads executable repository tasks without exposing hidden evaluator commands in prompts', () => {
    const tasks = parseTaskDataset([
      JSON.stringify({
        id: 'one',
        repo: 'owner/repo-a',
        baseCommit: 'abc123',
        prompt: 'Fix the retry bug.',
        evaluator: { commands: ['pnpm test -- retry.hidden.test.ts'] },
      }),
      JSON.stringify({
        id: 'two',
        repo: 'owner/repo-b',
        baseCommit: 'def456',
        prompt: 'Repair auth boundary.',
        evaluator: { commands: ['pytest -q hidden_auth_test.py'] },
      }),
    ].join('\n'));

    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.prompt).not.toContain('retry.hidden.test.ts');
    expect(tasks[0]!.evaluator.commands).toContain('pnpm test -- retry.hidden.test.ts');
  });

  it('samples across repositories before taking more tasks from the same repository', () => {
    const tasks = parseTaskDataset([
      ['a1', 'repo-a'], ['a2', 'repo-a'], ['b1', 'repo-b'], ['b2', 'repo-b'],
    ].map(([id, repo]) => JSON.stringify({
      id,
      repo: 'owner/' + repo,
      baseCommit: id + '-sha',
      prompt: 'task ' + id,
      evaluator: { commands: ['true'] },
    })).join('\n'));

    const sample = balancedSample(tasks, 2);
    expect(new Set(sample.map((task) => task.repo)).size).toBe(2);
  });

  it('requires command arrays so benchmark agents cannot smuggle shell syntax through configuration', () => {
    expect(() => validateAgentMatrix([
      { id: 'bad', argv: 'codex --dangerous' },
    ])).toThrow(/argv/i);

    expect(validateAgentMatrix([
      { id: 'codex', argv: ['codex', 'exec', '-'] },
    ])).toHaveLength(1);
  });
});
