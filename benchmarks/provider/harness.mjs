import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(label + ' must be a non-empty string');
  }
  return value;
}

function normalizeArgv(value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((part) => typeof part !== 'string' || part.length === 0)
  ) {
    throw new Error(label + ' argv must be a non-empty string array');
  }
  return [...value];
}

function normalizeEvaluatorFile(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('evaluator file must be an object');
  }

  const path = assertNonEmptyString(raw.path, 'evaluator file path');
  const portable = path.replaceAll('\\', '/');

  if (
    isAbsolute(path) ||
    portable === '..' ||
    portable.startsWith('../') ||
    portable.includes('/../')
  ) {
    throw new Error('evaluator file path must remain inside the benchmark worktree');
  }

  return {
    path: portable,
    content: typeof raw.content === 'string' ? raw.content : '',
  };
}

function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('benchmark task must be an object');
  }

  const evaluator = raw.evaluator;
  if (
    !evaluator ||
    !Array.isArray(evaluator.commands) ||
    evaluator.commands.length === 0
  ) {
    throw new Error(
      'benchmark task evaluator.commands must be a non-empty array',
    );
  }

  const commands = evaluator.commands.map((command, index) =>
    normalizeArgv(command, 'evaluator command ' + index),
  );
  const files = Array.isArray(evaluator.files)
    ? evaluator.files.map(normalizeEvaluatorFile)
    : [];

  const setup = raw.setup && typeof raw.setup === 'object' ? raw.setup : {};
  const setupCommands = Array.isArray(setup.commands)
    ? setup.commands.map((command, index) =>
        normalizeArgv(command, 'setup command ' + index),
      )
    : [];

  return {
    id: assertNonEmptyString(raw.id, 'task id'),
    repo: assertNonEmptyString(raw.repo, 'task repo'),
    repoUrl: raw.repoUrl
      ? assertNonEmptyString(raw.repoUrl, 'task repoUrl')
      : null,
    baseCommit: assertNonEmptyString(raw.baseCommit, 'task baseCommit'),
    prompt: assertNonEmptyString(raw.prompt, 'task prompt'),
    setup: {
      commands: setupCommands,
      timeoutMs:
        Number.isFinite(setup.timeoutMs) && setup.timeoutMs > 0
          ? setup.timeoutMs
          : 600000,
    },
    evaluator: {
      commands,
      files,
      timeoutMs:
        Number.isFinite(evaluator.timeoutMs) && evaluator.timeoutMs > 0
          ? evaluator.timeoutMs
          : 600000,
    },
    metadata:
      raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
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
          'invalid benchmark task at line ' +
            (index + 1) +
            ': ' +
            error.message,
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

function fingerprintAgent({ id, argv, env, metadata }) {
  return createHash('sha256')
    .update(JSON.stringify({
      id,
      argv,
      envKeys: Object.keys(env).sort(),
      metadata,
    }))
    .digest('hex');
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
    const argv = normalizeArgv(agent.argv, 'agent ' + id);

    const env =
        agent.env && typeof agent.env === 'object'
          ? Object.fromEntries(
              Object.entries(agent.env).map(([key, value]) => [
                key,
                String(value),
              ]),
            )
          : {};
    const metadata =
      agent.metadata && typeof agent.metadata === 'object'
        ? { ...agent.metadata }
        : {};

    return {
      id,
      argv,
      env,
      metadata,
      fingerprint: fingerprintAgent({ id, argv, env, metadata }),
      timeoutMs:
        Number.isFinite(agent.timeoutMs) && agent.timeoutMs > 0
          ? agent.timeoutMs
          : 900000,
    };
  });
}

function runProcess(
  argv,
  { cwd, input = '', env = {}, timeoutMs = 600000 } = {},
) {
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
    let stdinError = null;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdin.on('error', (error) => {
      if (error?.code === 'EPIPE') return;
      stdinError = error;
      child.kill('SIGKILL');
    });

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
        exitCode: stdinError ? null : code,
        signal,
        timedOut,
        stdout,
        stderr:
          stdinError == null
            ? stderr
            : stderr + '\nstdin write failed: ' + stdinError.message,
        durationMs: Date.now() - startedAt,
      });
    });

    child.stdin.end(input);
  });
}

async function materializeEvaluatorFiles(files, repoDir) {
  const repoRoot = resolve(repoDir) + sep;

  for (const file of files) {
    const target = resolve(repoDir, file.path);
    if (!target.startsWith(repoRoot)) {
      throw new Error(
        'evaluator file path escaped the benchmark worktree: ' + file.path,
      );
    }

    await mkdir(dirname(target), { recursive: true });
    try {
      await writeFile(target, file.content, {
        encoding: 'utf8',
        flag: 'wx',
      });
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        throw new Error(
          'evaluator file would overwrite agent-visible repository content: ' +
            file.path,
        );
      }
      throw error;
    }
  }
}

async function runEvaluatorCommand(argv, cwd, timeoutMs) {
  return runProcess(argv, { cwd, timeoutMs });
}

function isTransientCloneFailure(result) {
  if (result?.timedOut === true) return true;
  const stderr = String(result?.stderr ?? '').toLowerCase();
  return [
    'fatal: early eof',
    'rpc failed',
    'curl 18',
    'curl 56',
    'connection reset',
    'remote end hung up unexpectedly',
    'gnutls recv error',
    'tls connection',
    'http/2 stream',
    'unexpected disconnect',
  ].some((needle) => stderr.includes(needle));
}

/**
 * @param {{
 *   repoUrl: string,
 *   repoDir: string,
 *   run?: (
 *     argv: string[],
 *     options?: {
 *       cwd?: string,
 *       input?: string,
 *       env?: Record<string, string>,
 *       timeoutMs?: number
 *     }
 *   ) => Promise<{
 *     exitCode: number | null,
 *     timedOut?: boolean,
 *     stderr?: string,
 *     stdout?: string
 *   }>,
 *   maxAttempts?: number
 * }} options
 * @returns {Promise<{ attempts: number }>}
 */
export async function cloneRepositoryWithRetry({
  repoUrl,
  repoDir,
  run = runProcess,
  maxAttempts = 2,
} = {}) {
  if (typeof repoUrl !== 'string' || repoUrl.trim() === '') {
    throw new Error('repoUrl must be a non-empty string');
  }
  if (typeof repoDir !== 'string' || repoDir.trim() === '') {
    throw new Error('repoDir must be a non-empty string');
  }
  if (typeof run !== 'function') {
    throw new Error('clone run function is required');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error('maxAttempts must be an integer between 1 and 3');
  }

  let lastResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await run(
      [
        'git',
        'clone',
        '--quiet',
        '--no-checkout',
        repoUrl,
        repoDir,
      ],
      { timeoutMs: 300000 },
    );
    lastResult = result;

    if (result.exitCode === 0 && result.timedOut !== true) {
      return { attempts: attempt };
    }

    const retryable =
      attempt < maxAttempts && isTransientCloneFailure(result);
    if (!retryable) {
      throw new Error(
        'git clone failed: ' + String(result.stderr ?? '').trim(),
      );
    }

    await rm(repoDir, { recursive: true, force: true });
  }

  throw new Error(
    'git clone failed after retries: ' +
      String(lastResult?.stderr ?? '').trim(),
  );
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
    const cloneReceipt = await cloneRepositoryWithRetry({
      repoUrl: task.repoUrl ?? githubUrl(task.repo),
      repoDir,
    });

    const checkout = await runProcess(
      [
        'git',
        '-C',
        repoDir,
        'checkout',
        '--quiet',
        '--detach',
        task.baseCommit,
      ],
      { timeoutMs: 120000 },
    );
    if (checkout.exitCode !== 0) {
      throw new Error('git checkout failed: ' + checkout.stderr.trim());
    }

    const clean = await runProcess([
      'git',
      '-C',
      repoDir,
      'status',
      '--porcelain',
    ]);
    if (clean.stdout.trim() !== '') {
      throw new Error('benchmark workspace is not clean before agent run');
    }

    const setupRuns = [];
    for (const command of task.setup.commands) {
      const result = await runProcess(command, {
        cwd: repoDir,
        timeoutMs: task.setup.timeoutMs,
      });
      setupRuns.push({
        commandHash: await hashText(JSON.stringify(command)),
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        stderrTail: result.stderr.slice(-2000),
      });

      if (result.exitCode !== 0 || result.timedOut) {
        throw new Error(
          'benchmark setup command failed: ' +
            command[0] +
            ' exit=' +
            String(result.exitCode) +
            ' timedOut=' +
            String(result.timedOut),
        );
      }
    }

    const postSetupStatus = await runProcess([
      'git',
      '-C',
      repoDir,
      'status',
      '--porcelain',
    ]);
    if (postSetupStatus.stdout.trim() !== '') {
      throw new Error(
        'setup modified tracked repository state or created untracked files: ' +
          postSetupStatus.stdout.trim(),
      );
    }

    const candidatePolicy =
      task.metadata?.candidatePathPolicy === 'source-only-no-tests'
        ? [
            'Do not modify tests, test files, conftest.py, or .archeagent-hidden paths.',
            'Change source implementation only; benchmark authority files are evaluator-owned.',
          ]
        : [];

    const agentPrompt = [
      task.prompt,
      '',
      'Work only inside the current repository.',
      'Hidden evaluator assets do not exist in the worktree while you run.',
      ...candidatePolicy,
      'Make the smallest correct patch and leave changes in the worktree.',
    ].join('\n');

    const agentRun = await runProcess(agent.argv, {
      cwd: repoDir,
      input: agentPrompt,
      env: agent.env,
      timeoutMs: agent.timeoutMs,
    });

    const diff = await runProcess([
      'git',
      '-C',
      repoDir,
      'diff',
      '--binary',
      '--no-ext-diff',
    ]);
    const changedPathRun = await runProcess([
      'git',
      '-C',
      repoDir,
      'diff',
      '--name-only',
      '--no-ext-diff',
    ]);
    if (changedPathRun.exitCode !== 0) {
      throw new Error(
        'git diff --name-only failed: ' + changedPathRun.stderr.trim(),
      );
    }
    const changedPaths = changedPathRun.stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    const changed = diff.stdout.trim() !== '';

    await materializeEvaluatorFiles(task.evaluator.files, repoDir);

    const evaluatorRuns = [];
    for (const command of task.evaluator.commands) {
      const result = await runEvaluatorCommand(
        command,
        repoDir,
        task.evaluator.timeoutMs,
      );
      evaluatorRuns.push({
        commandHash: await hashText(JSON.stringify(command)),
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        stdoutTail: result.stdout.slice(-4000),
        stderrTail: result.stderr.slice(-4000),
      });
    }

    const passed =
      changed &&
      agentRun.exitCode === 0 &&
      !agentRun.timedOut &&
      evaluatorRuns.every(
        (result) => result.exitCode === 0 && !result.timedOut,
      );

    return {
      schema: 'archeagent.provider-benchmark-run.v2',
      taskId: task.id,
      repo: task.repo,
      baseCommit: task.baseCommit,
      agentId: agent.id,
      agentFingerprint: agent.fingerprint,
      cloneAttempts: cloneReceipt.attempts,
      setupRuns,
      passed,
      changed,
      agentExitCode: agentRun.exitCode,
      agentTimedOut: agentRun.timedOut,
      agentDurationMs: agentRun.durationMs,
      agentStdoutTail: agentRun.stdout.slice(-4000),
      agentStderrTail: agentRun.stderr.slice(-4000),
      patchSha256: changed ? await hashText(diff.stdout) : null,
      patchBytes: Buffer.byteLength(diff.stdout),
      changedPaths,
      changedPathCount: changedPaths.length,
      patchDiffTail: diff.stdout.slice(-8000),
      patchDiffTruncated: diff.stdout.length > 8000,
      evaluatorFilesInjected: task.evaluator.files.length,
      evaluatorRuns,
      recordedAt: new Date().toISOString(),
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function hashText(text) {
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
