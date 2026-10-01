import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  runToolAgent,
  validateRepoRelativePath,
} from '../../benchmarks/provider/agents/openai-compatible-agent-lib.mjs';

type AgentMessage = {
  role: string;
  content: string;
};

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

  it('returns recoverable tool errors for zero-match and multi-match replacements', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(join(dir, 'module.txt'), 'same\nsame\n', 'utf8');

      const replies = [
        {
          action: 'replace_text',
          path: 'module.txt',
          old_text: 'missing',
          new_text: 'changed',
        },
        {
          action: 'replace_text',
          path: 'module.txt',
          old_text: 'same',
          new_text: 'changed',
        },
        { action: 'finish', summary: 'recovered from replace mismatch' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Try two replacements, then finish.',
        maxSteps: 5,
        complete: async (messages: AgentMessage[]) => {
          if (index === 1 || index === 2) {
            expect(messages.at(-1)?.content).toContain('toolError');
            expect(messages.at(-1)?.content).toContain('REPLACE_MATCH_COUNT');
          }
          return JSON.stringify(replies[index++]);
        },
      });

      expect(result).toMatchObject({ finished: true, steps: 3 });
      expect(result.transcript[0]?.result).toMatchObject({
        toolError: true,
        code: 'REPLACE_MATCH_COUNT',
        matchCount: 0,
      });
      expect(result.transcript[1]?.result).toMatchObject({
        toolError: true,
        code: 'REPLACE_MATCH_COUNT',
        matchCount: 2,
      });
      expect(await readFile(join(dir, 'module.txt'), 'utf8')).toBe(
        'same\nsame\n',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns recoverable tool errors for malformed replace_text arguments on safe paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(join(dir, 'module.txt'), 'hello\n', 'utf8');

      const replies = [
        {
          action: 'replace_text',
          path: 'module.txt',
          old_text: '',
          new_text: 'changed',
        },
        {
          action: 'replace_text',
          path: 'module.txt',
          old_text: 'hello',
          new_text: 123,
        },
        { action: 'finish', summary: 'recovered' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Try malformed replacements and recover.',
        maxSteps: 5,
        complete: async (messages: AgentMessage[]) => {
          if (index === 1 || index === 2) {
            expect(messages.at(-1)?.content).toContain('toolError');
            expect(messages.at(-1)?.content).toContain(
              'INVALID_REPLACE_ARGUMENT',
            );
          }
          return JSON.stringify(replies[index++]);
        },
      });

      expect(result).toMatchObject({ finished: true, steps: 3 });
      expect(result.transcript[0]?.result).toMatchObject({
        toolError: true,
        code: 'INVALID_REPLACE_ARGUMENT',
      });
      expect(result.transcript[1]?.result).toMatchObject({
        toolError: true,
        code: 'INVALID_REPLACE_ARGUMENT',
      });
      expect(await readFile(join(dir, 'module.txt'), 'utf8')).toBe('hello\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('bounds model-facing tool history so large reads cannot overflow local context', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(
        join(dir, 'large.txt'),
        'HEAD\n' + 'x'.repeat(50_000) + '\nTAIL\n',
        'utf8',
      );

      let call = 0;
      const observedMessageSizes: number[] = [];
      const observedPayloads: string[] = [];

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Inspect large.txt and finish.',
        maxSteps: 4,
        complete: async (messages: AgentMessage[]) => {
          observedMessageSizes.push(
            messages.reduce((sum, message) => sum + message.content.length, 0),
          );
          observedPayloads.push(messages.at(-1)?.content ?? '');
          call += 1;

          if (call === 1) {
            return JSON.stringify({ action: 'read_file', path: 'large.txt' });
          }

          expect(observedMessageSizes.at(-1)).toBeLessThanOrEqual(24_000);
          expect(messages.some((message) =>
            message.content.includes('toolResultTruncated'),
          )).toBe(true);
          return JSON.stringify({ action: 'finish', summary: 'inspected' });
        },
      });

      expect(result).toMatchObject({ finished: true, steps: 2 });
      expect(observedMessageSizes).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('compacts older tool turns while preserving the original task prompt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      for (let index = 0; index < 4; index += 1) {
        await writeFile(
          join(dir, `file-${index}.txt`),
          `MARK-${index}\n` + 'y'.repeat(12_000),
          'utf8',
        );
      }

      const taskPrompt = 'Inspect the four files and then finish.';
      let call = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt,
        maxSteps: 8,
        complete: async (messages: AgentMessage[]) => {
          const totalChars = messages.reduce(
            (sum, message) => sum + message.content.length,
            0,
          );
          expect(totalChars).toBeLessThanOrEqual(24_000);
          expect(messages[1]?.content).toBe(taskPrompt);

          if (call < 4) {
            return JSON.stringify({
              action: 'read_file',
              path: `file-${call++}.txt`,
            });
          }

          call += 1;
          return JSON.stringify({ action: 'finish', summary: 'inspected' });
        },
      });

      expect(result).toMatchObject({ finished: true, steps: 5 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns a recoverable tool error when the model reads a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(join(dir, 'real.txt'), 'hello\n', 'utf8');

      const replies = [
        { action: 'read_file', path: 'guessed.txt' },
        { action: 'list_files' },
        { action: 'read_file', path: 'real.txt' },
        { action: 'finish', summary: 'recovered' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Inspect the repository.',
        maxSteps: 6,
        complete: async (messages: AgentMessage[]) => {
          if (index === 1) {
            expect(messages.at(-1)?.content).toContain('toolError');
            expect(messages.at(-1)?.content).toContain('ENOENT');
          }
          return JSON.stringify(replies[index++]);
        },
      });

      expect(result).toMatchObject({ finished: true, steps: 4 });
      expect(result.transcript.map((entry) => entry.action)).toEqual([
        'read_file',
        'list_files',
        'read_file',
        'finish',
      ]);
      expect(result.transcript[0]?.result).toMatchObject({
        toolError: true,
        code: 'ENOENT',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('still hard-fails security boundary violations instead of returning them to the model', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await expect(runToolAgent({
        cwd: dir,
        taskPrompt: 'Read outside.',
        maxSteps: 2,
        complete: async () => JSON.stringify({
          action: 'read_file',
          path: '../secret.txt',
        }),
      })).rejects.toThrow(/inside the repository/i);
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
