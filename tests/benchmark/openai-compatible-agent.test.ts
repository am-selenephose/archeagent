import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  runToolAgent,
  validateRepoRelativePath,
} from '../../benchmarks/provider/agents/openai-compatible-agent-lib.mjs';

describe('OpenAI-compatible local coding agent', () => {
  it('rejects paths that escape the repository', () => {
    expect(() => validateRepoRelativePath('../secret.txt')).toThrow(/inside the repository/i);
    expect(() => validateRepoRelativePath('/tmp/secret.txt')).toThrow(/inside the repository/i);
    expect(validateRepoRelativePath('src/app.ts')).toBe('src/app.ts');
  });

  it('can iteratively read and write repository files without shell execution', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(join(dir, 'answer.txt'), 'bad\n', 'utf8');

      const replies = [
        { action: 'read_file', path: 'answer.txt' },
        { action: 'write_file', path: 'answer.txt', content: 'good\n' },
        { action: 'finish', summary: 'fixed answer' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Change answer.txt from bad to good.',
        maxSteps: 6,
        complete: async () => JSON.stringify(replies[index++]),
      });

      expect(result.finished).toBe(true);
      expect(result.steps).toBe(3);
      expect(await readFile(join(dir, 'answer.txt'), 'utf8')).toBe('good\n');
      expect(result.transcript.map((entry) => entry.action)).toEqual([
        'read_file',
        'write_file',
        'finish',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('normalizes a summary-only terminal response into finish', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(join(dir, 'answer.txt'), 'bad\n', 'utf8');
      const replies = [
        { action: 'write_file', path: 'answer.txt', content: 'good\n' },
        { summary: 'task complete' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Fix answer.txt.',
        maxSteps: 4,
        complete: async () => JSON.stringify(replies[index++]),
      });

      expect(result).toMatchObject({ finished: true, steps: 2 });
      expect(result.transcript.at(-1)?.action).toBe('finish');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('normalizes a finish-key terminal response into finish', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(join(dir, 'answer.txt'), 'bad\n', 'utf8');
      const replies = [
        { action: 'write_file', path: 'answer.txt', content: 'good\n' },
        { finish: 'Changed answer.txt.' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Fix answer.txt.',
        maxSteps: 4,
        complete: async () => JSON.stringify(replies[index++]),
      });

      expect(result).toMatchObject({ finished: true, steps: 2 });
      expect(result.transcript.at(-1)?.action).toBe('finish');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('normalizes a nested finish envelope into finish', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(join(dir, 'answer.txt'), 'bad\n', 'utf8');
      const replies = [
        { action: 'write_file', path: 'answer.txt', content: 'good\n' },
        { finish: { summary: 'Changed answer.txt.' } },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Fix answer.txt.',
        maxSteps: 4,
        complete: async () => JSON.stringify(replies[index++]),
      });

      expect(result).toMatchObject({ finished: true, steps: 2 });
      expect(result.transcript.at(-1)?.action).toBe('finish');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('recovers from one malformed model action with a compact retry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(
        join(dir, 'module.py'),
        'def validate(ctx, value):\n    return value\n',
        'utf8',
      );

      const replies = [
        '{"action":"write_file","path":"module.py","content":"truncated',
        JSON.stringify({
          action: 'replace_text',
          path: 'module.py',
          old_text: 'def validate(ctx, value):',
          new_text: 'def validate(ctx, param, value):',
        }),
        JSON.stringify({ action: 'finish', summary: 'fixed' }),
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Update the callback signature.',
        maxSteps: 5,
        complete: async () => replies[index++]!,
      });

      expect(result).toMatchObject({ finished: true, steps: 3 });
      expect(result.transcript.map((entry) => entry.action)).toEqual([
        'invalid_action',
        'replace_text',
        'finish',
      ]);
      expect(await readFile(join(dir, 'module.py'), 'utf8')).toContain(
        'validate(ctx, param, value)',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('replaces one exact text match without rewriting the whole file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(
        join(dir, 'module.py'),
        'def validate(ctx, value):\n    return value\n',
        'utf8',
      );

      const replies = [
        {
          action: 'replace_text',
          path: 'module.py',
          old_text: 'def validate(ctx, value):',
          new_text: 'def validate(ctx, param, value):',
        },
        { action: 'finish', summary: 'updated callback signature' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Update the callback signature.',
        maxSteps: 4,
        complete: async () => JSON.stringify(replies[index++]),
      });

      expect(result).toMatchObject({ finished: true, steps: 2 });
      expect(await readFile(join(dir, 'module.py'), 'utf8')).toBe(
        'def validate(ctx, param, value):\n    return value\n',
      );
      expect(result.transcript[0]?.action).toBe('replace_text');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects ambiguous exact-text replacements', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(join(dir, 'module.txt'), 'same\nsame\n', 'utf8');

      await expect(runToolAgent({
        cwd: dir,
        taskPrompt: 'Replace same.',
        maxSteps: 2,
        complete: async () => JSON.stringify({
          action: 'replace_text',
          path: 'module.txt',
          old_text: 'same',
          new_text: 'changed',
        }),
      })).rejects.toThrow(/exactly once/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses model attempts to write outside the repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await expect(runToolAgent({
        cwd: dir,
        taskPrompt: 'Do the task.',
        maxSteps: 2,
        complete: async () => JSON.stringify({
          action: 'write_file',
          path: '../owned.txt',
          content: 'nope',
        }),
      })).rejects.toThrow(/inside the repository/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
