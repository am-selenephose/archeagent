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

function exec(argv, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(argv.join(' ') + ' failed: ' + code)));
  });
}

const parsed = parseTaskDataset([
  JSON.stringify({
    id: 'a',
    repo: 'owner/one',
    baseCommit: 'abc',
    prompt: 'fix a',
    evaluator: { commands: ['true'] },
  }),
  JSON.stringify({
    id: 'b',
    repo: 'owner/two',
    baseCommit: 'def',
    prompt: 'fix b',
    evaluator: { commands: ['true'] },
  }),
].join('\n'));

if (parsed.length !== 2 || balancedSample(parsed, 2).length !== 2) {
  throw new Error('dataset parsing or balanced sampling failed');
}

validateAgentMatrix([{ id: 'fixture', argv: ['node', 'fixture-agent.mjs'] }]);

const dir = await mkdtemp(join(tmpdir(), 'archeagent-harness-validate-'));
try {
  await exec(['git', 'init', '--quiet'], dir);
  await exec(['git', 'config', 'user.email', 'ci@example.invalid'], dir);
  await exec(['git', 'config', 'user.name', 'Archeagent CI'], dir);
  await writeFile(join(dir, 'value.txt'), 'bad\n');
  await mkdir(join(dir, 'test'));
  await writeFile(
    join(dir, 'test', 'verify.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\ntest "$(cat value.txt)" = "good"\n',
    { mode: 0o755 },
  );
  await exec(['git', 'add', '.'], dir);
  await exec(['git', 'commit', '--quiet', '-m', 'fixture'], dir);
  const head = (await new Promise((resolve, reject) => {
    const child = spawn('git', ['rev-parse', 'HEAD'], { cwd: dir, shell: false });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error('rev-parse failed')));
  }));

  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error('fixture commit invalid');
  const testScript = await readFile(join(dir, 'test', 'verify.sh'), 'utf8');
  if (!testScript.includes('value.txt')) throw new Error('hidden evaluator fixture missing');
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log('Provider benchmark harness validation PASS');
