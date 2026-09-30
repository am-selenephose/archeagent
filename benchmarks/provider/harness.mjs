import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(label + ' must be a non-empty string');
  }
  return value;
}

function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('benchmark task must be an object');

  const evaluator = raw.evaluator;
  if (!evaluator || !Array.isArray(evaluator.commands) || evaluator.commands.length === 0) {
    throw new Error('benchmark task evaluator.commands must be a non-empty array');
  }

  for (const command of evaluator.commands) {
    assertNonEmptyString(command, 'evaluator command');
  }

  return {
    id: assertNonEmptyString(raw.id, 'task id'),
    repo: assertNonEmptyString(raw.repo, 'task repo'),
    repoUrl: raw.repoUrl ? assertNonEmptyString(raw.repoUrl, 'task repoUrl') : null,
    baseCommit: assertNonEmptyString(raw.baseCommit, 'task baseCommit'),
    prompt: assertNonEmptyString(raw.prompt, 'task prompt'),
    evaluator: {
      commands: [...evaluator.commands],
      timeoutMs:
        Number.isFinite(evaluator.timeoutMs) && evaluator.timeoutMs > 0
          ? evaluator.timeoutMs
          : 600000,
    },
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
  };
}

export function parseTaskDataset(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return normalizeTask(JSON.parse(line));
      } catch (error) {
        throw new Error(
          'invalid benchmark task at line ' + (index + 1) + ': ' + error.message,
        );
      }
    });
}

export function balancedSample(tasks, count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('sample count must be a positive integer');
  }

  const byRepo = new Map();
  for (const task of tasks) {
    const bucket = byRepo.get(task.repo) ?? [];
    bucket.push(task);
    byRepo.set(task.repo, bucket);
  }

  const repos = [...byRepo.keys()].sort();
  const result = [];
  let offset = 0;

  while (result.length < Math.min(count, tasks.length)) {
    let added = false;
    for (const repo of repos) {
      const task = byRepo.get(repo)?.[offset];
      if (!task) continue;
      result.push(task);
      added = true;
      if (result.length >= count) break;
    }
    if (!added) break;
    offset += 1;
  }

  return result;
}

export function validateAgentMatrix(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('agent matrix must be a non-empty array');
  }

  return raw.map((agent, index) => {
    if (!agent || typeof agent !== 'object') {
      throw new Error('agent at index ' + index + ' must be an object');
    }
    const id = assertNonEmptyString(agent.id, 'agent id');
    if (
      !Array.isArray(agent.argv) ||
      agent.argv.length === 0 ||
      agent.argv.some((part) => typeof part !== 'string' || part.length === 0)
    ) {
      throw new Error('agent ' + id + ' argv must be a non-empty string array');
    }

    return {
      id,
      argv: [...agent.argv],
      env:
        agent.env && typeof agent.env === 'object'
          ? Object.fromEntries(
              Object.entries(agent.env).map(([key, value]) => [
                key,
                String(value),
              ]),
            )
          : {},
      timeoutMs:
        Number.isFinite(agent.timeoutMs) && agent.timeoutMs > 0
          ? agent.timeoutMs
          : 900000,
    };
  });
}

function runProcess(argv, { cwd, input = '', env = {}, timeoutMs = 600000 } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        timedOut,
        stdout,
        stderr: stderr + '\n' + error.message,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        signal,
        timedOut,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });

    child.stdin.end(input);
  });
}

async function runEvaluatorCommand(command, cwd, timeoutMs) {
  return runProcess(['bash', '-lc', command], { cwd, timeoutMs });
}

function githubUrl(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('repo must be owner/name for default GitHub cloning');
  }
  return 'https://github.com/' + repo + '.git';
}

export async function runBenchmarkTask(task, agent) {
  const workspace = await mkdtemp(join(tmpdir(), 'archeagent-provider-'));
  const repoDir = join(workspace, 'repo');

  try {
    const clone = await runProcess(
      ['git', 'clone', '--quiet', '--no-checkout', task.repoUrl ?? githubUrl(task.repo), repoDir],
      { timeoutMs: 300000 },
    );
    if (clone.exitCode !== 0) {
      throw new Error('git clone failed: ' + clone.stderr.trim());
    }

    const checkout = await runProcess(
      ['git', '-C', repoDir, 'checkout', '--quiet', '--detach', task.baseCommit],
      { timeoutMs: 120000 },
    );
    if (checkout.exitCode !== 0) {
      throw new Error('git checkout failed: ' + checkout.stderr.trim());
    }

    const clean = await runProcess(['git', '-C', repoDir, 'status', '--porcelain']);
    if (clean.stdout.trim() !== '') {
      throw new Error('benchmark workspace is not clean before agent run');
    }

    const agentPrompt = [
      task.prompt,
      '',
      'Work only inside the current repository.',
      'Do not run or inspect hidden benchmark evaluator commands.',
      'Make the smallest correct patch and leave changes in the worktree.',
    ].join('\n');

    const agentRun = await runProcess(agent.argv, {
      cwd: repoDir,
      input: agentPrompt,
      env: agent.env,
      timeoutMs: agent.timeoutMs,
    });

    const diff = await runProcess(['git', '-C', repoDir, 'diff', '--binary', '--no-ext-diff']);
    const changed = diff.stdout.trim() !== '';

    const evaluatorRuns = [];
    for (const command of task.evaluator.commands) {
      const result = await runEvaluatorCommand(
        command,
        repoDir,
        task.evaluator.timeoutMs,
      );
      evaluatorRuns.push({
        commandHash: await hashText(command),
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        stderrTail: result.stderr.slice(-2000),
      });
    }

    const passed =
      changed &&
      agentRun.exitCode === 0 &&
      !agentRun.timedOut &&
      evaluatorRuns.every((result) => result.exitCode === 0 && !result.timedOut);

    return {
      schema: 'archeagent.provider-benchmark-run.v1',
      taskId: task.id,
      repo: task.repo,
      baseCommit: task.baseCommit,
      agentId: agent.id,
      passed,
      changed,
      agentExitCode: agentRun.exitCode,
      agentTimedOut: agentRun.timedOut,
      agentDurationMs: agentRun.durationMs,
      patchSha256: changed ? await hashText(diff.stdout) : null,
      patchBytes: Buffer.byteLength(diff.stdout),
      evaluatorRuns,
      recordedAt: new Date().toISOString(),
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function hashText(text) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text).digest('hex');
}

export async function appendLedger(path, record) {
  await appendFile(path, JSON.stringify(record) + '\n', 'utf8');
}

export async function loadDataset(path) {
  return parseTaskDataset(await readFile(path, 'utf8'));
}

export async function loadAgentMatrix(path) {
  return validateAgentMatrix(JSON.parse(await readFile(path, 'utf8')));
}
