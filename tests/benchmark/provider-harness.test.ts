import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  balancedSample,
  parseTaskDataset,
  runBenchmarkTask,
  validateAgentMatrix,
} from '../../benchmarks/provider/harness.mjs';

function exec(argv: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd,
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(argv.join(' ') + ' failed with ' + code)),
    );
  });
}

describe('provider benchmark harness', () => {
  it('loads executable repository tasks without exposing hidden evaluator commands in prompts', () => {
    const tasks = parseTaskDataset([
      JSON.stringify({
        id: 'one',
        repo: 'owner/repo-a',
        baseCommit: 'abc123',
        prompt: 'Fix the retry bug.',
        evaluator: {
          commands: [['pnpm', 'test', '--', 'retry.hidden.test.ts']],
        },
      }),
      JSON.stringify({
        id: 'two',
        repo: 'owner/repo-b',
        baseCommit: 'def456',
        prompt: 'Repair auth boundary.',
        evaluator: {
          commands: [['python', '-m', 'pytest', '-q', 'hidden_auth_test.py']],
        },
      }),
    ].join('\n'));

    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.prompt).not.toContain('retry.hidden.test.ts');
    expect(tasks[0]!.evaluator.commands[0]).toEqual([
      'pnpm',
      'test',
      '--',
      'retry.hidden.test.ts',
    ]);
    expect(tasks[0]!.setup.commands).toEqual([]);
  });

  it('rejects shell command strings for evaluator execution', () => {
    expect(() =>
      parseTaskDataset(JSON.stringify({
        id: 'one',
        repo: 'owner/repo-a',
        baseCommit: 'abc123',
        prompt: 'Fix the retry bug.',
        evaluator: {
          commands: ['pnpm test -- retry.hidden.test.ts'],
        },
      })),
    ).toThrow(/argv/i);
  });

  it('rejects shell command strings for setup execution', () => {
    expect(() =>
      parseTaskDataset(JSON.stringify({
        id: 'one',
        repo: 'owner/repo-a',
        baseCommit: 'abc123',
        prompt: 'Fix the retry bug.',
        setup: { commands: ['pnpm install'] },
        evaluator: {
          commands: [['node', 'hidden/check.mjs']],
        },
      })),
    ).toThrow(/setup command.*argv/i);
  });

  it('rejects evaluator file paths that escape the worktree', () => {
    expect(() =>
      parseTaskDataset(JSON.stringify({
        id: 'one',
        repo: 'owner/repo-a',
        baseCommit: 'abc123',
        prompt: 'Fix the retry bug.',
        evaluator: {
          commands: [['node', 'hidden/check.mjs']],
          files: [{ path: '../outside.mjs', content: 'process.exit(0)' }],
        },
      })),
    ).toThrow(/evaluator file path/i);
  });

  it('samples across repositories before taking more tasks from the same repository', () => {
    const tasks = parseTaskDataset([
      ['a1', 'repo-a'], ['a2', 'repo-a'], ['b1', 'repo-b'], ['b2', 'repo-b'],
    ].map(([id, repo]) => JSON.stringify({
      id,
      repo: 'owner/' + repo,
      baseCommit: id + '-sha',
      prompt: 'task ' + id,
      evaluator: { commands: [['node', '--version']] },
    })).join('\n'));

    const sample = balancedSample(tasks, 2);
    expect(new Set(sample.map((task) => task.repo)).size).toBe(2);
  });

  it('requires command arrays so benchmark agents cannot smuggle shell syntax through configuration', () => {
    expect(() => validateAgentMatrix([
      { id: 'bad', argv: 'codex --dangerous' },
    ])).toThrow(/argv/i);

    const [agent] = validateAgentMatrix([
      {
        id: 'codex',
        argv: ['codex', 'exec', '-'],
        metadata: { provider: 'openai', model: 'codex' },
      },
    ]);

    expect(agent).toMatchObject({
      id: 'codex',
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('injects hidden evaluator files only after the agent has exited', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'archeagent-benchmark-fixture-'));
    const sourceRepo = join(fixture, 'source');
    const agentScript = join(fixture, 'agent.mjs');

    try {
      await exec(['git', 'init', '--quiet', sourceRepo], fixture);
      await exec(['git', 'config', 'user.email', 'benchmark@example.invalid'], sourceRepo);
      await exec(['git', 'config', 'user.name', 'Benchmark Fixture'], sourceRepo);
      await writeFile(join(sourceRepo, 'answer.txt'), 'bad\n', 'utf8');
      await exec(['git', 'add', '.'], sourceRepo);
      await exec(['git', 'commit', '--quiet', '-m', 'fixture'], sourceRepo);

      const commit = await new Promise<string>((resolve, reject) => {
        const child = spawn('git', ['rev-parse', 'HEAD'], {
          cwd: sourceRepo,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        });
        let stdout = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve(stdout.trim()) : reject(new Error('rev-parse failed')),
        );
      });

      await writeFile(
        agentScript,
        [
          "import { existsSync, writeFileSync } from 'node:fs';",
          "const cheated = existsSync('hidden/check.mjs');",
          "writeFileSync('answer.txt', cheated ? 'CHEATED\\n' : 'good\\n');",
        ].join('\n'),
        'utf8',
      );

      const task = parseTaskDataset(JSON.stringify({
        id: 'hidden-file-isolation',
        repo: 'fixture/local',
        repoUrl: sourceRepo,
        baseCommit: commit,
        prompt: 'Change answer.txt to good.',
        setup: {
          commands: [['node', '--version']],
        },
        evaluator: {
          commands: [['node', 'hidden/check.mjs']],
          files: [{
            path: 'hidden/check.mjs',
            content: [
              "import { readFileSync } from 'node:fs';",
              "process.exit(readFileSync('answer.txt', 'utf8').trim() === 'good' ? 0 : 1);",
            ].join('\n'),
          }],
        },
      }))[0]!;

      const [agent] = validateAgentMatrix([
        { id: 'fixture-agent', argv: ['node', agentScript], timeoutMs: 30_000 },
      ]);

      const record = await runBenchmarkTask(task, agent!);

      expect(record.passed).toBe(true);
      expect(record.changed).toBe(true);
      expect(record.setupRuns).toHaveLength(1);
      expect(record.setupRuns[0]!.exitCode).toBe(0);
      expect(record.evaluatorRuns).toHaveLength(1);
      expect(record.evaluatorRuns[0]!.exitCode).toBe(0);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  }, 30_000);

  it('fails when setup mutates tracked repository state', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'archeagent-setup-drift-'));
    const sourceRepo = join(fixture, 'source');
    const setupScript = join(fixture, 'setup.mjs');

    try {
      await exec(['git', 'init', '--quiet', sourceRepo], fixture);
      await exec(['git', 'config', 'user.email', 'benchmark@example.invalid'], sourceRepo);
      await exec(['git', 'config', 'user.name', 'Benchmark Fixture'], sourceRepo);
      await writeFile(join(sourceRepo, 'answer.txt'), 'original\n', 'utf8');
      await exec(['git', 'add', '.'], sourceRepo);
      await exec(['git', 'commit', '--quiet', '-m', 'fixture'], sourceRepo);

      const commit = await new Promise<string>((resolve, reject) => {
        const child = spawn('git', ['rev-parse', 'HEAD'], {
          cwd: sourceRepo,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        });
        let stdout = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve(stdout.trim()) : reject(new Error('rev-parse failed')),
        );
      });

      await writeFile(
        setupScript,
        "import { writeFileSync } from 'node:fs';\nwriteFileSync('answer.txt', 'setup-mutated\\n');\n",
        'utf8',
      );

      const task = parseTaskDataset(JSON.stringify({
        id: 'setup-drift',
        repo: 'fixture/local',
        repoUrl: sourceRepo,
        baseCommit: commit,
        prompt: 'No-op.',
        setup: { commands: [['node', setupScript]] },
        evaluator: { commands: [['node', '--version']] },
      }))[0]!;

      const [agent] = validateAgentMatrix([
        { id: 'fixture-agent', argv: ['node', '--version'] },
      ]);

      await expect(runBenchmarkTask(task, agent!)).rejects.toThrow(
        /setup modified tracked repository state/i,
      );
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  }, 30_000);
});
