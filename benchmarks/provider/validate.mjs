#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  balancedSample,
  parseTaskDataset,
  validateAgentMatrix,
} from './harness.mjs';
import { summarizeLedger } from './report-lib.mjs';

function exec(argv, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(argv.join(' ') + ' failed: ' + code)),
    );
  });
}

const parsed = parseTaskDataset([
  JSON.stringify({
    id: 'a',
    repo: 'owner/one',
    baseCommit: 'abc',
    prompt: 'fix a',
    evaluator: {
      commands: [['node', 'hidden/check-a.mjs']],
      files: [{
        path: 'hidden/check-a.mjs',
        content: 'process.exit(0);',
      }],
    },
  }),
  JSON.stringify({
    id: 'b',
    repo: 'owner/two',
    baseCommit: 'def',
    prompt: 'fix b',
    evaluator: {
      commands: [['node', 'hidden/check-b.mjs']],
      files: [{
        path: 'hidden/check-b.mjs',
        content: 'process.exit(0);',
      }],
    },
  }),
].join('\n'));

if (parsed.length !== 2 || balancedSample(parsed, 2).length !== 2) {
  throw new Error('dataset parsing or balanced sampling failed');
}

const [fixtureAgent] = validateAgentMatrix([{
  id: 'fixture',
  argv: ['node', 'fixture-agent.mjs'],
  metadata: { provider: 'fixture', model: 'fixture' },
}]);

if (!/^[0-9a-f]{64}$/.test(fixtureAgent.fingerprint)) {
  throw new Error('agent fingerprint validation failed');
}

const summary = summarizeLedger([
  {
    schema: 'archeagent.provider-benchmark-run.v2',
    taskId: 'a',
    repo: 'owner/one',
    baseCommit: 'abc',
    agentId: fixtureAgent.id,
    agentFingerprint: fixtureAgent.fingerprint,
    passed: false,
    changed: true,
    agentExitCode: 0,
    agentTimedOut: false,
    agentDurationMs: 1,
    patchSha256: 'patch',
    patchBytes: 1,
    evaluatorFilesInjected: 1,
    evaluatorRuns: [],
    recordedAt: '2026-09-30T00:00:00.000Z',
  },
  {
    schema: 'archeagent.provider-benchmark-run.v2',
    taskId: 'a',
    repo: 'owner/one',
    baseCommit: 'abc',
    agentId: fixtureAgent.id,
    agentFingerprint: fixtureAgent.fingerprint,
    passed: true,
    changed: true,
    agentExitCode: 0,
    agentTimedOut: false,
    agentDurationMs: 1,
    patchSha256: 'patch-2',
    patchBytes: 1,
    evaluatorFilesInjected: 1,
    evaluatorRuns: [],
    recordedAt: '2026-09-30T00:01:00.000Z',
  },
]);

if (summary.primaryRuns !== 1 || summary.retries !== 1) {
  throw new Error('first-attempt reporting rule validation failed');
}

const dir = await mkdtemp(join(tmpdir(), 'archeagent-harness-validate-'));
try {
  await exec(['git', 'init', '--quiet'], dir);
  await exec(['git', 'config', 'user.email', 'ci@example.invalid'], dir);
  await exec(['git', 'config', 'user.name', 'Archeagent CI'], dir);
  await writeFile(join(dir, 'value.txt'), 'bad\n');
  await mkdir(join(dir, 'test'));
  await writeFile(
    join(dir, 'test', 'verify.mjs'),
    "import { readFileSync } from 'node:fs';\nprocess.exit(readFileSync('value.txt','utf8').trim() === 'good' ? 0 : 1);\n",
    'utf8',
  );
  await exec(['git', 'add', '.'], dir);
  await exec(['git', 'commit', '--quiet', '-m', 'fixture'], dir);

  const head = await new Promise((resolve, reject) => {
    const child = spawn('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(out.trim())
        : reject(new Error('rev-parse failed')),
    );
  });

  if (!/^[0-9a-f]{40}$/.test(head)) {
    throw new Error('fixture commit invalid');
  }

  const testScript = await readFile(join(dir, 'test', 'verify.mjs'), 'utf8');
  if (!testScript.includes('value.txt')) {
    throw new Error('evaluator fixture missing');
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log('Provider benchmark harness validation PASS');
