import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findForbiddenSourceOnlyPaths } from './path-policy.mjs';

const SHA40 = /^[0-9a-f]{40}$/;

export const R2E_REPO_MAP = Object.freeze({
  aiohttp: 'aio-libs/aiohttp',
  coveragepy: 'nedbat/coveragepy',
  datalad: 'datalad/datalad',
  numpy: 'numpy/numpy',
  orange3: 'biolab/orange3',
  pandas: 'pandas-dev/pandas',
  pillow: 'python-pillow/Pillow',
  pyramid: 'Pylons/pyramid',
  scrapy: 'scrapy/scrapy',
  tornado: 'tornadoweb/tornado',
});
const R2E_DATASET = 'R2E-Gym/R2E-Gym-Lite';
const R2E_CONFIG = 'default';


export function parseR2EImportArgs(argv) {
  if (!Array.isArray(argv)) {
    throw new Error('argv must be an array');
  }

  const values = new Map();
  const supported = new Set([
    'split',
    'offset',
    'source-length',
    'count',
    'row-indices',
    'out',
    'manifest',
  ]);

  for (const arg of argv) {
    if (typeof arg !== 'string' || !arg.startsWith('--') || !arg.includes('=')) {
      throw new Error('R2E import arguments must use --name=value');
    }
    const separator = arg.indexOf('=');
    const key = arg.slice(2, separator);
    const value = arg.slice(separator + 1);
    if (!supported.has(key)) {
      throw new Error('unknown R2E import argument: --' + key);
    }
    if (values.has(key)) {
      throw new Error('duplicate R2E import argument: --' + key);
    }
    values.set(key, value);
  }

  const out = requiredString(values.get('out'), '--out');
  const split = values.has('split')
    ? requiredString(values.get('split'), '--split')
    : 'dev_10pr_v1';
  if (!/^[A-Za-z0-9._-]+$/.test(split)) {
    throw new Error('--split contains unsupported characters');
  }

  function integerOption(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (!values.has(name)) return fallback;
    const raw = values.get(name);
    if (!/^(0|[1-9]\d*)$/.test(raw)) {
      throw new Error('--' + name + ' must be an integer');
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(
        '--' + name + ' must be between ' + min + ' and ' + max,
      );
    }
    return value;
  }

  const offset = integerOption('offset', 0);
  const sourceLength = integerOption('source-length', 100, {
    min: 1,
    max: 100,
  });
  let count = integerOption('count', 10, {
    min: 1,
    max: sourceLength,
  });
  if (count > sourceLength) {
    throw new Error('--count cannot exceed --source-length');
  }

  let rowIndices = null;
  if (values.has('row-indices')) {
    const raw = requiredString(values.get('row-indices'), '--row-indices');
    const pieces = raw.split(',').map((value) => value.trim());
    if (
      pieces.length === 0 ||
      pieces.some((value) => !/^(0|[1-9]\d*)$/.test(value))
    ) {
      throw new Error('--row-indices must be comma-separated non-negative integers');
    }

    rowIndices = pieces.map(Number);
    if (new Set(rowIndices).size !== rowIndices.length) {
      throw new Error('--row-indices contains a duplicate row index');
    }

    const pageStart = offset;
    const pageEndExclusive = offset + sourceLength;
    const outsidePage = rowIndices.find(
      (value) => value < pageStart || value >= pageEndExclusive,
    );
    if (outsidePage !== undefined) {
      throw new Error(
        '--row-indices row ' +
          outsidePage +
          ' is outside the fetched page [' +
          pageStart +
          ', ' +
          pageEndExclusive +
          ')',
      );
    }

    if (values.has('count') && count !== rowIndices.length) {
      throw new Error('--count must match --row-indices length');
    }
    count = rowIndices.length;
  }

  const manifest = values.has('manifest')
    ? requiredString(values.get('manifest'), '--manifest')
    : out + '.manifest.json';

  return {
    split,
    offset,
    sourceLength,
    count,
    rowIndices,
    out,
    manifest,
  };
}

function hashText(value) {
  return createHash('sha256').update(value).digest('hex');
}

function runProcess(argv, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function runGit(argv, options) {
  const result = await runProcess(['git', ...argv], options);
  if (result.code !== 0) {
    throw new Error(
      'git command failed: git ' + argv.join(' ') + '\n' + result.stderr.trim(),
    );
  }
  return result.stdout.trim();
}

/**
 * @param {{ split: string, offset?: number, length?: number }} options
 */
export function buildR2ERowsUrl({
  split,
  offset = 0,
  length = 100,
} = {}) {
  const normalizedSplit = requiredString(split, 'split');
  if (!/^[A-Za-z0-9._-]+$/.test(normalizedSplit)) {
    throw new Error('split contains unsupported characters');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer');
  }
  if (!Number.isInteger(length) || length < 1 || length > 100) {
    throw new Error('length must be an integer between 1 and 100');
  }

  const url = new URL('https://datasets-server.huggingface.co/rows');
  url.searchParams.set('dataset', R2E_DATASET);
  url.searchParams.set('config', R2E_CONFIG);
  url.searchParams.set('split', normalizedSplit);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('length', String(length));
  return url.toString();
}

export function extractR2ERowPage(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('R2E rows response must be an object');
  }
  if (payload.partial === true) {
    throw new Error('R2E rows response is partial and cannot be frozen');
  }
  if (!Array.isArray(payload.rows)) {
    throw new Error('R2E rows response must include rows');
  }
  if (!Number.isInteger(payload.num_rows_total) || payload.num_rows_total < 0) {
    throw new Error('R2E rows response num_rows_total must be a non-negative integer');
  }

  const requiredFields = new Set([
    'repo_name',
    'docker_image',
    'commit_hash',
    'problem_statement',
    'expected_output_json',
  ]);

  const entries = payload.rows.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !Number.isInteger(entry.row_idx) ||
      entry.row_idx < 0 ||
      !entry.row ||
      typeof entry.row !== 'object'
    ) {
      throw new Error('R2E rows response contains a malformed row');
    }

    const truncated = Array.isArray(entry.truncated_cells)
      ? entry.truncated_cells
      : [];
    const truncatedNames = truncated.map((cell) =>
      typeof cell === 'string'
        ? cell
        : cell && typeof cell === 'object'
          ? cell.column ?? cell.name ?? ''
          : '',
    );
    const requiredTruncation = truncatedNames.find((name) =>
      requiredFields.has(name),
    );
    if (requiredTruncation) {
      throw new Error(
        'R2E row ' +
          entry.row_idx +
          ' truncated required field: ' +
          requiredTruncation,
      );
    }

    return {
      rowIndex: entry.row_idx,
      record: entry.row,
    };
  });

  return {
    totalRows: payload.num_rows_total,
    entries,
  };
}

/**
 * @param {{ split: string, offset?: number, length?: number }} options
 * @param {{
 *   fetchImpl?: (url: string) => Promise<{
 *     ok: boolean,
 *     status?: number,
 *     json: () => Promise<any>
 *   }>
 * }} dependencies
 */
export async function fetchR2ERowPage(
  options,
  { fetchImpl = globalThis.fetch } = {},
) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch implementation is required');
  }

  const url = buildR2ERowsUrl(options);
  const response = await fetchImpl(url);
  if (!response || response.ok !== true) {
    throw new Error(
      'R2E rows request failed with status ' + String(response?.status ?? 'unknown'),
    );
  }

  return extractR2ERowPage(await response.json());
}

/**
 * @param {{
 *   split: string,
 *   offset?: number,
 *   page: {
 *     entries: Array<{ rowIndex: number, record: any }>,
 *     totalRows: number
 *   },
 *   count: number,
 *   rowIndices?: number[] | null,
 *   resolveBaseCommit?: (
 *     input: { repoUrl: string, targetCommit: string }
 *   ) => Promise<string>
 * }} options
 */
export async function freezeR2ECorpus({
  split,
  offset = 0,
  page,
  count,
  rowIndices = null,
  resolveBaseCommit = resolveR2EBaseCommit,
} = {}) {
  const normalizedSplit = requiredString(split, 'split');
  if (
    !page ||
    typeof page !== 'object' ||
    !Array.isArray(page.entries) ||
    !Number.isInteger(page.totalRows)
  ) {
    throw new Error('page must be a validated R2E row page');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('count must be a positive integer');
  }
  if (typeof resolveBaseCommit !== 'function') {
    throw new Error('resolveBaseCommit must be a function');
  }

  let selectedEntries;
  if (rowIndices !== null) {
    if (!Array.isArray(rowIndices) || rowIndices.length !== count) {
      throw new Error('rowIndices must be an array whose length matches count');
    }
    if (
      rowIndices.some(
        (value) => !Number.isInteger(value) || value < 0,
      )
    ) {
      throw new Error('rowIndices must contain non-negative integers');
    }
    if (new Set(rowIndices).size !== rowIndices.length) {
      throw new Error('rowIndices contains a duplicate row index');
    }

    selectedEntries = rowIndices.map((rowIndex) => {
      const entry = page.entries.find(
        (candidate) => candidate.rowIndex === rowIndex,
      );
      if (!entry) {
        throw new Error(
          'requested R2E row ' +
            rowIndex +
            ' is not present in the fetched page',
        );
      }
      return entry;
    });
  } else {
    const selectedRecords = selectBalancedR2ERows(
      page.entries.map((entry) => entry.record),
      count,
    );
    selectedEntries = selectedRecords.map((record) => {
      const entry = page.entries.find(
        (candidate) => candidate.record === record,
      );
      if (!entry) throw new Error('selected R2E row lost its source index');
      return entry;
    });
  }

  const frozenEntries = [];
  const tasks = [];

  for (const entry of selectedEntries) {
    const repoName = requiredString(entry.record.repo_name, 'repo_name');
    const repo = R2E_REPO_MAP[repoName];
    if (!repo) {
      throw new Error('unsupported R2E repo_name: ' + repoName);
    }
    const targetCommit = requiredSha(
      entry.record.commit_hash,
      'commit_hash',
    );
    const repoUrl = 'https://github.com/' + repo + '.git';
    const baseCommit = await resolveBaseCommit({
      repoUrl,
      targetCommit,
    });

    tasks.push(convertR2EGymRecord(entry.record, { baseCommit }));
    frozenEntries.push({
      rowIndex: entry.rowIndex,
      record: entry.record,
      baseCommit,
    });
  }

  return {
    tasks,
    manifest: makeR2ECorpusManifest({
      split: normalizedSplit,
      offset,
      sourceRows: page.entries.length,
      entries: frozenEntries,
      rowIndices,
    }),
  };
}

export function selectBalancedR2ERows(rows, count) {
  if (!Array.isArray(rows)) {
    throw new Error('R2E rows must be an array');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('R2E sample count must be a positive integer');
  }

  const byRepo = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      throw new Error('R2E row must be an object');
    }
    const repoName = requiredString(row.repo_name, 'repo_name');
    const bucket = byRepo.get(repoName) ?? [];
    bucket.push(row);
    byRepo.set(repoName, bucket);
  }

  const repos = [...byRepo.keys()].sort();
  const selected = [];
  let round = 0;
  while (selected.length < Math.min(count, rows.length)) {
    let added = false;
    for (const repo of repos) {
      const row = byRepo.get(repo)?.[round];
      if (!row) continue;
      selected.push(row);
      added = true;
      if (selected.length >= count) break;
    }
    if (!added) break;
    round += 1;
  }
  return selected;
}

/**
 * @param {{ repoUrl: string, targetCommit: string }} options
 */
export async function resolveR2EBaseCommit({ repoUrl, targetCommit } = {}) {
  const remote = requiredString(repoUrl, 'repoUrl');
  const target = requiredSha(targetCommit, 'targetCommit');
  const workspace = await mkdtemp(join(tmpdir(), 'archeagent-r2e-parent-'));
  const bareRepo = join(workspace, 'repo.git');

  try {
    await runGit(['init', '--bare', '--quiet', bareRepo]);
    await runGit(['-C', bareRepo, 'remote', 'add', 'origin', remote]);
    await runGit([
      '-C',
      bareRepo,
      'fetch',
      '--quiet',
      '--no-tags',
      '--depth=2',
      'origin',
      target,
    ]);
    const parent = await runGit([
      '-C',
      bareRepo,
      'rev-parse',
      target + '^',
    ]);
    return requiredSha(parent, 'resolved base commit');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

/**
 * @param {{
 *   split: string,
 *   offset?: number,
 *   sourceRows: number,
 *   entries: Array<{ rowIndex: number, record: any, baseCommit: string }>,
 *   rowIndices?: number[] | null
 * }} options
 */
export function makeR2ECorpusManifest({
  split,
  offset = 0,
  sourceRows,
  entries,
  rowIndices = null,
} = {}) {
  const normalizedSplit = requiredString(split, 'split');
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer');
  }
  if (!Number.isInteger(sourceRows) || sourceRows < 1) {
    throw new Error('sourceRows must be a positive integer');
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('manifest entries must be a non-empty array');
  }

  const safeEntries = entries.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error('manifest entry must be an object');
    }
    const record = entry.record;
    if (!record || typeof record !== 'object') {
      throw new Error('manifest entry record must be an object');
    }

    const repoName = requiredString(record.repo_name, 'repo_name');
    if (!R2E_REPO_MAP[repoName]) {
      throw new Error('unsupported R2E repo_name: ' + repoName);
    }
    const targetCommit = requiredSha(record.commit_hash, 'commit_hash');
    const baseCommit = requiredSha(entry.baseCommit, 'baseCommit');
    const dockerImage = validateDockerImage(
      repoName,
      targetCommit,
      record.docker_image,
    );
    const problemStatement = requiredString(
      record.problem_statement,
      'problem_statement',
    );
    const expectedOutput = requiredString(
      record.expected_output_json,
      'expected_output_json',
    );

    if (!Number.isInteger(entry.rowIndex) || entry.rowIndex < 0) {
      throw new Error('rowIndex must be a non-negative integer');
    }

    return {
      rowIndex: entry.rowIndex,
      repoName,
      repo: R2E_REPO_MAP[repoName],
      targetCommit,
      baseCommit,
      dockerImage,
      problemStatementSha256: hashText(problemStatement),
      expectedOutputSha256: hashText(expectedOutput),
    };
  });

  const manifest = {
    schema: 'archeagent.r2e-corpus-manifest.v1',
    dataset: R2E_DATASET,
    config: R2E_CONFIG,
    split: normalizedSplit,
    offset,
    sourceRows,
    selectedRows: safeEntries.length,
    entries: safeEntries,
  };

  if (rowIndices !== null) {
    if (
      !Array.isArray(rowIndices) ||
      rowIndices.length !== safeEntries.length
    ) {
      throw new Error(
        'manifest rowIndices must match the selected entry count',
      );
    }
    manifest.selectionMode = 'explicit-row-indices';
    manifest.rowIndices = [...rowIndices];
  }

  return manifest;
}


function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(label + ' must be a non-empty string');
  }
  return value.trim();
}

function requiredSha(value, label) {
  const sha = requiredString(value, label);
  if (!SHA40.test(sha)) {
    throw new Error(label + ' must be a lowercase 40-hex commit SHA');
  }
  return sha;
}

function safeIdPart(value) {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '_');
}

function stripR2EAnsi(value) {
  return String(value).replace(/\u001b\[[0-9;]*m/g, '');
}

function normalizeExpectedStatuses(raw) {
  let parsed;
  try {
    parsed = JSON.parse(requiredString(raw, 'expected_output_json'));
  } catch (error) {
    if (error instanceof Error && /expected_output_json/.test(error.message)) {
      throw error;
    }
    throw new Error('expected_output_json must be valid JSON');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length === 0
  ) {
    throw new Error('expected_output_json must contain at least one test status');
  }

  const normalized = {};
  for (const [name, status] of Object.entries(parsed)) {
    const testName = stripR2EAnsi(
      requiredString(name, 'expected test name').split(' - ')[0],
    ).trim();
    if (!testName) {
      throw new Error('expected test name is empty after ANSI normalization');
    }
    if (!['PASSED', 'FAILED', 'ERROR'].includes(status)) {
      throw new Error(
        'unsupported R2E expected status for ' + testName + ': ' + String(status),
      );
    }
    if (Object.prototype.hasOwnProperty.call(normalized, testName)) {
      throw new Error(
        'duplicate expected test name after ANSI normalization: ' + testName,
      );
    }
    normalized[testName] = status;
  }

  return Object.fromEntries(
    Object.entries(normalized).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export function parseR2EInput(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('R2E input must be non-empty JSON or JSONL');
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('R2E JSON input must be an array');
    }
    return parsed;
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(
          'invalid R2E JSONL at line ' +
            (index + 1) +
            ': ' +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    });
}

function probeFields(stdout) {
  const fields = {};
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) continue;
    fields[match[1]] = match[2].trim();
  }
  return fields;
}

export function resolveR2EBaseProbe({
  repoName,
  targetCommit,
  stdout,
}) {
  requiredString(repoName, 'repoName');
  const target = requiredSha(targetCommit, 'targetCommit');
  const fields = probeFields(stdout);

  const baseCommit = requiredSha(fields.BASE_HEAD, 'BASE_HEAD');
  const targetParent = requiredSha(
    fields.TARGET_PARENT,
    'TARGET_PARENT',
  );

  if (fields.TARGET_TYPE !== 'commit') {
    throw new Error('R2E authority target must resolve to a commit');
  }
  if (baseCommit !== targetParent) {
    throw new Error(
      'R2E authority image HEAD must equal target parent commit',
    );
  }
  if (target === baseCommit) {
    throw new Error('R2E authority target must differ from its parent');
  }
  if (fields.ROOT_TESTS !== 'yes') {
    throw new Error('R2E authority image is missing hidden tests');
  }
  if (fields.RUN_TESTS !== 'yes') {
    throw new Error('R2E authority image is missing run_tests.sh');
  }

  return {
    baseCommit,
    targetParent,
    rootTestsPresent: true,
    runTestsPresent: true,
  };
}

export function parseR2EPytestStatuses(log) {
  if (typeof log !== 'string' || !log.includes('short test summary info')) {
    return {};
  }

  const summary = log.split('short test summary info', 2)[1] ?? '';
  const statuses = {};

  for (const line of summary.trim().split(/\r?\n/)) {
    let status = null;
    if (line.includes('PASSED')) status = 'PASSED';
    else if (line.includes('FAILED')) status = 'FAILED';
    else if (line.includes('ERROR')) status = 'ERROR';
    if (!status) continue;

    let name = line.split('::').slice(1).join('.');
    if (status !== 'PASSED') {
      name = name.split(' - ')[0];
    }
    name = stripR2EAnsi(name).split(' - ')[0].trim();
    if (name) statuses[name] = status;
  }

  return Object.fromEntries(
    Object.entries(statuses).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export function statusMapsEqual(left, right) {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }

  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));

  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(
    ([name, status], index) =>
      rightEntries[index]?.[0] === name &&
      rightEntries[index]?.[1] === status,
  );
}

export const findForbiddenR2ECandidatePaths = findForbiddenSourceOnlyPaths;
function validateDockerImage(repoName, targetCommit, value) {
  const image = requiredString(value, 'docker_image');
  const expected = 'namanjain12/' + repoName + '_final:' + targetCommit;
  if (image !== expected) {
    throw new Error(
      'docker_image must equal the pinned R2E authority image ' + expected,
    );
  }
  return image;
}

function makeR2EEvaluator({
  image,
  baseCommit,
  expectedStatuses,
}) {
  const parserSource = parseR2EPytestStatuses.toString();
  const compareSource = statusMapsEqual.toString();
  const forbiddenPathSource = findForbiddenR2ECandidatePaths.toString();

  return [
    "import { spawnSync } from 'node:child_process';",
    "import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';",
    "import { tmpdir } from 'node:os';",
    "import { join, resolve } from 'node:path';",
    '',
    'const parseR2EPytestStatuses = ' + parserSource + ';',
    'const statusMapsEqual = ' + compareSource + ';',
    'const findForbiddenR2ECandidatePaths = ' + forbiddenPathSource + ';',
    '',
    'const image = ' + JSON.stringify(image) + ';',
    'const baseCommit = ' + JSON.stringify(baseCommit) + ';',
    'const expectedStatuses = ' + JSON.stringify(expectedStatuses) + ';',
    'const repoDir = resolve(process.cwd());',
    '',
    "function run(argv, options = {}) {",
    "  const result = spawnSync(argv[0], argv.slice(1), {",
    "    cwd: options.cwd ?? repoDir,",
    "    encoding: 'utf8',",
    "    stdio: ['ignore', 'pipe', 'pipe'],",
    "    shell: false,",
    "    timeout: options.timeoutMs ?? 600000,",
    "  });",
    "  if (result.error) throw result.error;",
    "  return result;",
    "}",
    '',
    "const head = run(['git', '-C', repoDir, 'rev-parse', 'HEAD']);",
    "if (head.status !== 0 || head.stdout.trim() !== baseCommit) {",
    "  console.error('R2E evaluator base commit mismatch');",
    "  process.exit(2);",
    "}",
    '',
    "const changedPathRun = run(['git', '-C', repoDir, 'diff', '--name-only', '--no-ext-diff']);",
    "if (changedPathRun.status !== 0) {",
    "  console.error('R2E evaluator could not enumerate candidate paths');",
    "  process.exit(5);",
    "}",
    "const changedPaths = changedPathRun.stdout.split(/\\r?\\n/).map((value) => value.trim()).filter(Boolean);",
    "const forbiddenPaths = findForbiddenR2ECandidatePaths(changedPaths);",
    "if (forbiddenPaths.length > 0) {",
    "  console.error('R2E evaluator forbids candidate test-path changes: ' + JSON.stringify(forbiddenPaths));",
    "  process.exit(5);",
    "}",
    '',
    "const diff = run(['git', '-C', repoDir, 'diff', '--binary', '--no-ext-diff']);",
    "if (diff.status !== 0 || diff.stdout.trim() === '') {",
    "  console.error('R2E evaluator requires a non-empty candidate patch');",
    "  process.exit(3);",
    "}",
    '',
    "const authorityDir = mkdtempSync(join(tmpdir(), 'archeagent-r2e-authority-'));",
    "const patchPath = join(authorityDir, 'candidate.patch');",
    "writeFileSync(patchPath, diff.stdout, 'utf8');",
    '',
    "const authorityScript = [",
    "  'set -eu',",
    "  'cd /testbed',",
    '  ' +
      JSON.stringify(
        'test "$(git rev-parse HEAD)" = "' + baseCommit + '"',
      ) +
      ',',
    "  'rm -rf /testbed/r2e_tests',",
    "  'ln -s /r2e_tests /testbed/r2e_tests',",
    "  'git apply --check /authority/candidate.patch',",
    "  'git apply /authority/candidate.patch',",
    "  'bash ./run_tests.sh',",
    "].join('; ');",
    '',
    "try {",
    "  const result = run([",
    "    'docker',",
    "    'run',",
    "    '--rm',",
    "    '--network',",
    "    'none',",
    "    '-v',",
    "    patchPath + ':/authority/candidate.patch:ro',",
    "    '--entrypoint',",
    "    'sh',",
    "    image,",
    "    '-lc',",
    "    authorityScript,",
    "  ], { timeoutMs: 900000 });",
    '',
    "  const output = (result.stdout ?? '') + '\\n' + (result.stderr ?? '');",
    "  if (result.signal || result.error) {",
    "    console.error('R2E authority container failed to execute');",
    "    process.exit(4);",
    "  }",
    '',
    "  const actualStatuses = parseR2EPytestStatuses(output);",
    "  const matched = statusMapsEqual(actualStatuses, expectedStatuses);",
    "  console.log(JSON.stringify({",
    "    schema: 'archeagent.r2e-authority-result.v2',",
    "    matched,",
    "    dockerExitCode: result.status,",
    "    expectedStatusCount: Object.keys(expectedStatuses).length,",
    "    actualStatusCount: Object.keys(actualStatuses).length,",
    "    changedPaths,",
    "    changedPathCount: changedPaths.length,",
    "  }));",
    "  process.exit(matched ? 0 : 1);",
    "} finally {",
    "  rmSync(authorityDir, { recursive: true, force: true });",
    "}",
    '',
  ].join('\n');
}

export function convertR2EGymRecord(record, { baseCommit } = {}) {
  if (!record || typeof record !== 'object') {
    throw new Error('R2E-Gym record must be an object');
  }

  const repoName = requiredString(record.repo_name, 'repo_name');
  const repo = R2E_REPO_MAP[repoName];
  if (!repo) {
    throw new Error('unsupported R2E repo_name: ' + repoName);
  }

  const targetCommit = requiredSha(record.commit_hash, 'commit_hash');
  const pinnedBaseCommit = requiredSha(baseCommit, 'baseCommit');
  if (pinnedBaseCommit === targetCommit) {
    throw new Error('baseCommit must be different from target commit');
  }

  const prompt = requiredString(record.problem_statement, 'problem_statement');
  const image = validateDockerImage(
    repoName,
    targetCommit,
    record.docker_image,
  );
  const expectedStatuses = normalizeExpectedStatuses(
    record.expected_output_json,
  );

  const id =
    'r2e-gym__' + safeIdPart(repoName) + '__' + safeIdPart(targetCommit);
  const evaluatorPath = '.archeagent-hidden/' + id + '.evaluate.mjs';

  return {
    id,
    repo,
    repoUrl: 'https://github.com/' + repo + '.git',
    baseCommit: pinnedBaseCommit,
    prompt,
    setup: {
      commands: [],
      timeoutMs: 600000,
    },
    evaluator: {
      commands: [['node', evaluatorPath]],
      files: [
        {
          path: evaluatorPath,
          content: makeR2EEvaluator({
            image,
            baseCommit: pinnedBaseCommit,
            expectedStatuses,
          }),
        },
      ],
      timeoutMs: 900000,
    },
    metadata: {
      source: 'r2e-gym-lite',
      repoName,
      targetCommit,
      dockerImage: image,
      expectedStatusCount: Object.keys(expectedStatuses).length,
      evaluatorRuntime: 'r2e-authority-docker',
      authorityNetwork: 'none',
      hiddenTestsVisibleToAgent: false,
      candidatePathPolicy: 'source-only-no-tests',
    },
  };
}
