import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

  it('recovers from oversized read_file and points the model to bounded reading', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(
        join(dir, 'huge.py'),
        'start\n' + 'x'.repeat(70_000) + '\nneedle\n',
        'utf8',
      );

      const replies = [
        { action: 'read_file', path: 'huge.py' },
        { action: 'finish', summary: 'saw size guidance' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Inspect huge.py.',
        maxSteps: 4,
        complete: async (messages: AgentMessage[]) => {
          if (index === 1) {
            expect(messages.at(-1)?.content).toContain('FILE_TOO_LARGE');
            expect(messages.at(-1)?.content).toContain('read_lines');
          }
          return JSON.stringify(replies[index++]);
        },
      });

      expect(result.transcript[0]?.result).toMatchObject({
        toolError: true,
        code: 'FILE_TOO_LARGE',
      });
      expect(result).toMatchObject({ finished: true, steps: 2 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads bounded line windows from files larger than the full-read limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      const lines = Array.from(
        { length: 2500 },
        (_, index) => `line-${index + 1}-${'z'.repeat(40)}`,
      );
      lines[1799] = 'TARGET-LINE-1800';

      await writeFile(
        join(dir, 'huge.py'),
        lines.join('\n') + '\n',
        'utf8',
      );

      const replies = [
        {
          action: 'read_lines',
          path: 'huge.py',
          start_line: 1798,
          end_line: 1802,
        },
        { action: 'finish', summary: 'found target window' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Inspect lines around 1800.',
        maxSteps: 4,
        complete: async (messages: AgentMessage[]) => {
          if (index === 1) {
            const payload = messages.at(-1)?.content ?? '';
            expect(payload).toContain('TARGET-LINE-1800');
            expect(payload).toContain('"startLine":1798');
            expect(payload).toContain('"endLine":1802');
          }
          return JSON.stringify(replies[index++]);
        },
      });

      expect(result).toMatchObject({ finished: true, steps: 2 });
      expect(result.transcript[0]?.result).toMatchObject({
        path: 'huge.py',
        startLine: 1798,
        endLine: 1802,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('finds text inside oversized files without exposing the whole file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      const lines = Array.from(
        { length: 3000 },
        (_, index) => `ordinary-${index + 1}-${'q'.repeat(30)}`,
      );
      lines[2400] = 'UNIQUE_OVERSIZED_NEEDLE';

      await writeFile(
        join(dir, 'huge.txt'),
        lines.join('\n') + '\n',
        'utf8',
      );

      const replies = [
        { action: 'search_text', query: 'UNIQUE_OVERSIZED_NEEDLE' },
        { action: 'finish', summary: 'found it' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Find the unique needle.',
        maxSteps: 4,
        complete: async (messages: AgentMessage[]) => {
          if (index === 1) {
            const payload = messages.at(-1)?.content ?? '';
            expect(payload).toContain('UNIQUE_OVERSIZED_NEEDLE');
            expect(payload).toContain('"line":2401');
          }
          return JSON.stringify(replies[index++]);
        },
      });

      expect(result).toMatchObject({ finished: true, steps: 2 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('can replace exact text in an oversized file after a bounded read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      const lines = Array.from(
        { length: 2500 },
        (_, index) => `row-${index + 1}-${'m'.repeat(40)}`,
      );
      lines[1999] = 'def old_callback(ctx, value):';

      await writeFile(
        join(dir, 'huge.py'),
        lines.join('\n') + '\n',
        'utf8',
      );

      const replies = [
        {
          action: 'read_lines',
          path: 'huge.py',
          start_line: 1998,
          end_line: 2002,
        },
        {
          action: 'replace_text',
          path: 'huge.py',
          old_text: 'def old_callback(ctx, value):',
          new_text: 'def old_callback(ctx, param, value):',
        },
        { action: 'finish', summary: 'updated callback' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Update the callback signature.',
        maxSteps: 5,
        complete: async () => JSON.stringify(replies[index++]),
      });

      expect(result).toMatchObject({ finished: true, steps: 3 });
      expect(await readFile(join(dir, 'huge.py'), 'utf8')).toContain(
        'def old_callback(ctx, param, value):',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid read_lines ranges and path escapes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(join(dir, 'module.txt'), 'one\ntwo\n', 'utf8');

      await expect(runToolAgent({
        cwd: dir,
        taskPrompt: 'Read too much.',
        maxSteps: 2,
        complete: async () => JSON.stringify({
          action: 'read_lines',
          path: 'module.txt',
          start_line: 1,
          end_line: 1000,
        }),
      })).rejects.toThrow(/read_lines/i);

      await expect(runToolAgent({
        cwd: dir,
        taskPrompt: 'Escape.',
        maxSteps: 2,
        complete: async () => JSON.stringify({
          action: 'read_lines',
          path: '../secret.txt',
          start_line: 1,
          end_line: 5,
        }),
      })).rejects.toThrow(/inside the repository/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });


  it('rejects no-op replace_text edits as a recoverable tool result', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(join(dir, 'module.py'), 'value = 1\n', 'utf8');

      const replies = [
        {
          action: 'replace_text',
          path: 'module.py',
          old_text: 'value = 1',
          new_text: 'value = 1',
        },
        {
          action: 'replace_text',
          path: 'module.py',
          old_text: 'value = 1',
          new_text: 'value = 2',
        },
        { action: 'finish', summary: 'changed value' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Change value from 1 to 2.',
        maxSteps: 5,
        complete: async (messages: AgentMessage[]) => {
          if (index === 1) {
            const payload = messages.at(-1)?.content ?? '';
            expect(payload).toContain('NO_OP_REPLACE');
            expect(payload).toContain('must change file content');
          }
          return JSON.stringify(replies[index++]);
        },
      });

      expect(result).toMatchObject({ finished: true, steps: 3 });
      expect(result.transcript[0]?.result).toMatchObject({
        toolError: true,
        code: 'NO_OP_REPLACE',
      });
      expect(await readFile(join(dir, 'module.py'), 'utf8')).toBe(
        'value = 2\n',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('surfaces the remaining step budget after each tool turn', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(join(dir, 'module.py'), 'value = 1\n', 'utf8');

      const replies = [
        { action: 'read_file', path: 'module.py' },
        { action: 'finish', summary: 'inspected' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Inspect module.py.',
        maxSteps: 4,
        complete: async (messages: AgentMessage[]) => {
          if (index === 1) {
            const payload = messages.at(-1)?.content ?? '';
            expect(payload).toContain('"stepBudget"');
            expect(payload).toContain('"used":1');
            expect(payload).toContain('"remaining":3');
          }
          return JSON.stringify(replies[index++]);
        },
      });

      expect(result).toMatchObject({ finished: true, steps: 2 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });


  it('returns a recoverable tool error when replace_text targets a missing safe path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(join(dir, 'real.py'), 'value = 1\n', 'utf8');

      const replies = [
        {
          action: 'replace_text',
          path: 'guessed.py',
          old_text: 'value = 1',
          new_text: 'value = 2',
        },
        { action: 'list_files' },
        {
          action: 'replace_text',
          path: 'real.py',
          old_text: 'value = 1',
          new_text: 'value = 2',
        },
        { action: 'finish', summary: 'recovered' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Change the source value.',
        maxSteps: 6,
        complete: async (messages: AgentMessage[]) => {
          if (index === 1) {
            const payload = messages.at(-1)?.content ?? '';
            expect(payload).toContain('toolError');
            expect(payload).toContain('ENOENT');
            expect(payload).toContain('guessed.py');
          }
          return JSON.stringify(replies[index++]);
        },
      });

      expect(result).toMatchObject({ finished: true, steps: 4 });
      expect(await readFile(join(dir, 'real.py'), 'utf8')).toBe('value = 2\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('adds convergence pressure when the remaining step budget is low', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(join(dir, 'module.py'), 'value = 1\n', 'utf8');

      const replies = [
        { action: 'read_file', path: 'module.py' },
        { action: 'read_file', path: 'module.py' },
        { action: 'finish', summary: 'done' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Inspect and decide.',
        maxSteps: 4,
        complete: async (messages: AgentMessage[]) => {
          if (index === 2) {
            const payload = messages.at(-1)?.content ?? '';
            expect(payload).toContain('convergenceWarning');
            expect(payload).toContain('Stop broad exploration');
            expect(payload).toContain('"remaining":2');
          }
          return JSON.stringify(replies[index++]);
        },
      });

      expect(result).toMatchObject({ finished: true, steps: 3 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects an exact duplicate observation until a source edit changes the evidence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await writeFile(join(dir, 'module.py'), 'value = 1\n', 'utf8');

      const replies = [
        { action: 'read_file', path: 'module.py' },
        { action: 'read_file', path: 'module.py' },
        {
          action: 'replace_text',
          path: 'module.py',
          old_text: 'value = 1',
          new_text: 'value = 2',
        },
        { action: 'read_file', path: 'module.py' },
        { action: 'finish', summary: 'updated value' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Update the value.',
        maxSteps: 8,
        complete: async (messages: AgentMessage[]) => {
          if (index === 2) {
            const payload = messages.at(-1)?.content ?? '';
            expect(payload).toContain('DUPLICATE_OBSERVATION');
            expect(payload).toContain('already performed');
          }
          if (index === 4) {
            const payload = messages.at(-1)?.content ?? '';
            expect(payload).toContain('value = 2');
            expect(payload).not.toContain('DUPLICATE_OBSERVATION');
          }
          return JSON.stringify(replies[index++]);
        },
      });

      expect(result).toMatchObject({ finished: true, steps: 5 });
      expect(result.transcript[1]?.result).toMatchObject({
        toolError: true,
        code: 'DUPLICATE_OBSERVATION',
      });
      expect(result.transcript[3]?.result).toMatchObject({
        path: 'module.py',
        content: 'value = 2\n',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('adds early no-progress pressure after a long observation streak without an edit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      for (let index = 0; index < 6; index += 1) {
        await writeFile(
          join(dir, `file-${index}.py`),
          `value_${index} = ${index}\n`,
          'utf8',
        );
      }

      const replies = [
        { action: 'read_file', path: 'file-0.py' },
        { action: 'read_file', path: 'file-1.py' },
        { action: 'read_file', path: 'file-2.py' },
        { action: 'read_file', path: 'file-3.py' },
        { action: 'read_file', path: 'file-4.py' },
        { action: 'read_file', path: 'file-5.py' },
        {
          action: 'replace_text',
          path: 'file-0.py',
          old_text: 'value_0 = 0',
          new_text: 'value_0 = 1',
        },
        { action: 'finish', summary: 'made the best supported edit' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Inspect the evidence and make the smallest supported edit.',
        maxSteps: 20,
        complete: async (messages: AgentMessage[]) => {
          if (index === 6) {
            const payload = messages.at(-1)?.content ?? '';
            expect(payload).toContain('convergenceWarning');
            expect(payload).toContain('No source edit has been made');
            expect(payload).toContain('"explorationStreak":6');
            expect(payload).toContain('"remaining":14');
          }
          if (index === 7) {
            const payload = messages.at(-1)?.content ?? '';
            expect(payload).toContain('"explorationStreak":0');
          }
          return JSON.stringify(replies[index++]);
        },
      });

      expect(result).toMatchObject({ finished: true, steps: 8 });
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

  it('enforces source-only edit policy without weakening normal source edits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await mkdir(join(dir, 'tests'), { recursive: true });
      await writeFile(join(dir, 'tests', 'test_module.py'), 'value = 1\n', 'utf8');
      await writeFile(join(dir, 'module.py'), 'value = 1\n', 'utf8');

      const replies = [
        {
          action: 'replace_text',
          path: 'tests/test_module.py',
          old_text: 'value = 1',
          new_text: 'value = 2',
        },
        {
          action: 'replace_text',
          path: 'module.py',
          old_text: 'value = 1',
          new_text: 'value = 2',
        },
        { action: 'finish', summary: 'updated source only' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Fix the source implementation, not tests.',
        editPolicy: 'source-only',
        maxSteps: 5,
        complete: async (messages: AgentMessage[]) => {
          if (index === 0) {
            expect(messages[0]?.content).toContain('Do not modify test files');
          }
          if (index === 1) {
            const payload = messages.at(-1)?.content ?? '';
            expect(payload).toContain('EDIT_POLICY_FORBIDDEN_PATH');
            expect(payload).toContain('tests/test_module.py');
          }
          return JSON.stringify(replies[index++]);
        },
      });

      expect(result).toMatchObject({ finished: true, steps: 3 });
      expect(result.transcript[0]?.result).toMatchObject({
        toolError: true,
        code: 'EDIT_POLICY_FORBIDDEN_PATH',
        path: 'tests/test_module.py',
      });
      expect(await readFile(join(dir, 'tests', 'test_module.py'), 'utf8'))
        .toBe('value = 1\n');
      expect(await readFile(join(dir, 'module.py'), 'utf8'))
        .toBe('value = 2\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps unrestricted edit policy as the default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-local-agent-'));
    try {
      await mkdir(join(dir, 'tests'), { recursive: true });
      await writeFile(join(dir, 'tests', 'test_module.py'), 'value = 1\n', 'utf8');

      const replies = [
        {
          action: 'replace_text',
          path: 'tests/test_module.py',
          old_text: 'value = 1',
          new_text: 'value = 2',
        },
        { action: 'finish', summary: 'updated requested file' },
      ];
      let index = 0;

      const result = await runToolAgent({
        cwd: dir,
        taskPrompt: 'Update the requested file.',
        maxSteps: 4,
        complete: async () => JSON.stringify(replies[index++]),
      });

      expect(result).toMatchObject({ finished: true, steps: 2 });
      expect(await readFile(join(dir, 'tests', 'test_module.py'), 'utf8'))
        .toBe('value = 2\n');
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
