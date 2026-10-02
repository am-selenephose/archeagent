import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  buildR2ERowsUrl,
  convertR2EGymRecord,
  extractR2ERowPage,
  fetchR2ERowPage,
  findForbiddenR2ECandidatePaths,
  freezeR2ECorpus,
  makeR2ECorpusManifest,
  parseR2EImportArgs,
  parseR2EPytestStatuses,
  resolveR2EBaseCommit,
  selectBalancedR2ERows,
  statusMapsEqual,
} from '../../benchmarks/provider/import-r2e-gym-lib.mjs';

const targetCommit = '6d3d1fcf2583eb7b8330b194c00356ce169b2ebd';
const baseCommit = 'ea84f22423bccb022f088deec2fe081f1f1fa29a';

const source = {
  repo_name: 'aiohttp',
  docker_image: 'namanjain12/aiohttp_final:' + targetCommit,
  commit_hash: targetCommit,
  parsed_commit_content: 'SECRET_GOLD_PATCH',
  execution_result_content: 'SECRET_AUTHORITY_TRACE',
  modified_files: ['aiohttp/http_parser.py', 'tests/test_http_parser.py'],
  prompt: 'SECRET prompt containing the gold commit diff and tests',
  problem_statement: '[ISSUE]\nFix chunk separators split across data chunks.\n[/ISSUE]',
  expected_output_json: JSON.stringify({
    'test_existing[pyloop]': 'PASSED',
    'test_known_baseline_failure': 'FAILED',
    'test_known_collection_error': 'ERROR',
  }),
  num_non_test_files: 1,
  num_non_test_lines: 4,
};

describe('R2E-Gym authority importer', () => {
  it('converts a row without leaking gold commit material into the agent prompt', () => {
    const task = convertR2EGymRecord(source, { baseCommit });

    expect(task).toMatchObject({
      id: 'r2e-gym__aiohttp__' + targetCommit,
      repo: 'aio-libs/aiohttp',
      baseCommit,
      prompt: source.problem_statement,
      setup: { commands: [] },
      evaluator: {
        commands: [['node', expect.stringMatching(/\.evaluate\.mjs$/)]],
      },
      metadata: {
        source: 'r2e-gym-lite',
        repoName: 'aiohttp',
        targetCommit,
        dockerImage: source.docker_image,
        expectedStatusCount: 3,
        candidatePathPolicy: 'source-only-no-tests',
      },
    });

    const serialized = JSON.stringify(task);
    expect(task.prompt).not.toContain('SECRET');
    expect(serialized).not.toContain('SECRET_GOLD_PATCH');
    expect(serialized).not.toContain('SECRET_AUTHORITY_TRACE');
    expect(serialized).not.toContain(source.prompt);
    expect(task.repoUrl).toBe('https://github.com/aio-libs/aiohttp.git');
  });

  it('generates a post-agent Docker evaluator with network disabled and hidden tests linked only inside authority execution', () => {
    const task = convertR2EGymRecord(source, { baseCommit });
    const evaluator = task.evaluator.files.find((file) =>
      file.path.endsWith('.evaluate.mjs'),
    );

    expect(evaluator).toBeDefined();
    expect(evaluator!.content).toContain(source.docker_image);
    expect(evaluator!.content).toContain(baseCommit);
    expect(evaluator!.content).toContain("'--network'");
    expect(evaluator!.content).toContain("'none'");
    expect(evaluator!.content).toContain("'git', '-C', repoDir, 'diff', '--binary', '--no-ext-diff'");
    expect(evaluator!.content).toContain("ln -s /r2e_tests /testbed/r2e_tests");
    expect(evaluator!.content).toContain("git apply --check /authority/candidate.patch");
    expect(evaluator!.content).toContain("bash ./run_tests.sh");
    expect(evaluator!.content).toContain('"test_known_baseline_failure":"FAILED"');
  });

  it('parses the exact R2E pytest status domain and ignores summary noise', () => {
    const parsed = parseR2EPytestStatuses([
      'random prelude',
      '================ short test summary info ================',
      'PASSED r2e_tests/test_1.py::test_ok',
      'FAILED r2e_tests/test_1.py::test_bad - AssertionError: nope',
      'ERROR r2e_tests/test_1.py::test_boom - RuntimeError',
      'SKIPPED [1] r2e_tests/test_1.py:99: optional dependency',
      '================ 1 failed, 1 passed in 0.10s ================',
    ].join('\n'));

    expect(parsed).toEqual({
      test_ok: 'PASSED',
      test_bad: 'FAILED',
      test_boom: 'ERROR',
    });
  });

  it('normalizes ANSI formatting in expected status keys before freezing authority', () => {
    const task = convertR2EGymRecord(
      {
        ...source,
        expected_output_json: JSON.stringify({
          '\u001b[1mtest_getxmp\u001b[0m': 'PASSED',
        }),
      },
      { baseCommit },
    );

    const evaluator = task.evaluator.files.find((file) =>
      file.path.endsWith('.evaluate.mjs'),
    );
    const expectedLine = evaluator?.content
      .split('\n')
      .find((line) => line.startsWith('const expectedStatuses = '));

    expect(expectedLine).toBe(
      'const expectedStatuses = {"test_getxmp":"PASSED"};',
    );
  });

  it('rejects expected status keys that collide after ANSI normalization', () => {
    expect(() =>
      convertR2EGymRecord(
        {
          ...source,
          expected_output_json: JSON.stringify({
            '\u001b[1mtest_same\u001b[0m': 'PASSED',
            test_same: 'FAILED',
          }),
        },
        { baseCommit },
      ),
    ).toThrow(/duplicate.*normalization/i);
  });

  it('rejects candidate changes to test or hidden-authority paths', () => {
    expect(findForbiddenR2ECandidatePaths([
      'scrapy/downloadermiddlewares/redirect.py',
      'tests/test_downloadermiddleware_redirect.py',
      '.archeagent-hidden/evaluator.mjs',
      'pkg/conftest.py',
    ])).toEqual([
      '.archeagent-hidden/evaluator.mjs',
      'pkg/conftest.py',
      'tests/test_downloadermiddleware_redirect.py',
    ]);

    expect(findForbiddenR2ECandidatePaths([
      'aiohttp/_http_parser.pyx',
      'numpy/core/src/multiarray/arraytypes.c.src',
    ])).toEqual([]);
  });

  it('embeds the candidate-path guard into the authority evaluator', () => {
    const task = convertR2EGymRecord(source, { baseCommit });
    const evaluator = task.evaluator.files.find((file) =>
      file.path.endsWith('.evaluate.mjs'),
    );

    expect(evaluator?.content).toContain('R2E evaluator forbids candidate test-path changes');
    expect(evaluator?.content).toContain("git', '-C', repoDir, 'diff', '--name-only'");
    expect(evaluator?.content).toContain('findForbiddenR2ECandidatePaths');
    expect(evaluator?.content).toContain(
      "schema: 'archeagent.r2e-authority-result.v2'",
    );
  });

  it('compares status maps exactly rather than trusting pytest exit code', () => {
    expect(statusMapsEqual(
      { a: 'PASSED', b: 'FAILED', c: 'ERROR' },
      { c: 'ERROR', b: 'FAILED', a: 'PASSED' },
    )).toBe(true);

    expect(statusMapsEqual(
      { a: 'PASSED', b: 'FAILED' },
      { a: 'PASSED', b: 'PASSED' },
    )).toBe(false);

    expect(statusMapsEqual(
      { a: 'PASSED' },
      { a: 'PASSED', b: 'FAILED' },
    )).toBe(false);
  });

  it('rejects malformed authority metadata instead of approximating evaluation', () => {
    expect(() =>
      convertR2EGymRecord(
        { ...source, problem_statement: '' },
        { baseCommit },
      ),
    ).toThrow(/problem_statement/i);

    expect(() =>
      convertR2EGymRecord(
        { ...source, expected_output_json: '{}' },
        { baseCommit },
      ),
    ).toThrow(/expected_output_json/i);

    expect(() =>
      convertR2EGymRecord(
        {
          ...source,
          expected_output_json: JSON.stringify({ a: 'SKIPPED' }),
        },
        { baseCommit },
      ),
    ).toThrow(/status/i);

    expect(() =>
      convertR2EGymRecord(
        { ...source, docker_image: 'ubuntu:latest' },
        { baseCommit },
      ),
    ).toThrow(/docker_image/i);

    expect(() =>
      convertR2EGymRecord(
        { ...source, repo_name: 'unknown-repo' },
        { baseCommit },
      ),
    ).toThrow(/repo_name/i);
  });

  it('maps Orange3 to the official biolab repository', () => {
    const orangeTarget = 'a'.repeat(40);
    const orangeTask = convertR2EGymRecord(
      {
        ...source,
        repo_name: 'orange3',
        commit_hash: orangeTarget,
        docker_image: 'namanjain12/orange3_final:' + orangeTarget,
      },
      { baseCommit: 'b'.repeat(40) },
    );

    expect(orangeTask.repo).toBe('biolab/orange3');
    expect(orangeTask.repoUrl).toBe('https://github.com/biolab/orange3.git');
  });

  it('requires immutable target and base SHAs', () => {
    expect(() =>
      convertR2EGymRecord(
        { ...source, commit_hash: 'main' },
        { baseCommit },
      ),
    ).toThrow(/commit_hash/i);

    expect(() =>
      convertR2EGymRecord(source, { baseCommit: 'HEAD^' }),
    ).toThrow(/baseCommit/i);

    expect(() =>
      convertR2EGymRecord(source, { baseCommit: targetCommit }),
    ).toThrow(/different/i);
  });
});


describe('R2E-Gym corpus freeze helpers', () => {

  it('accepts complete Hugging Face row pages and rejects partial responses', () => {
    const page = extractR2ERowPage({
      rows: [
        { row_idx: 42, row: source, truncated_cells: [] },
      ],
      num_rows_total: 100,
      partial: false,
    });

    expect(page).toEqual({
      totalRows: 100,
      entries: [{ rowIndex: 42, record: source }],
    });

    expect(() =>
      extractR2ERowPage({
        rows: [{ row_idx: 42, row: source }],
        num_rows_total: 100,
        partial: true,
      }),
    ).toThrow(/partial/i);
  });

  it('builds the official dataset rows endpoint and enforces its 100-row page limit', () => {
    const url = new URL(buildR2ERowsUrl({
      split: 'dev_10pr_v1',
      offset: 0,
      length: 100,
    }));

    expect(url.origin + url.pathname).toBe(
      'https://datasets-server.huggingface.co/rows',
    );
    expect(url.searchParams.get('dataset')).toBe('R2E-Gym/R2E-Gym-Lite');
    expect(url.searchParams.get('config')).toBe('default');
    expect(url.searchParams.get('split')).toBe('dev_10pr_v1');
    expect(url.searchParams.get('offset')).toBe('0');
    expect(url.searchParams.get('length')).toBe('100');

    expect(() =>
      buildR2ERowsUrl({ split: 'dev_10pr_v1', offset: 0, length: 101 }),
    ).toThrow(/100/i);
    expect(() =>
      buildR2ERowsUrl({ split: '../escape', offset: 0, length: 10 }),
    ).toThrow(/split/i);
  });

  it('selects across repositories before taking a second row from one repo', () => {
    const rows = [
      { repo_name: 'aiohttp', commit_hash: 'a'.repeat(40) },
      { repo_name: 'aiohttp', commit_hash: 'b'.repeat(40) },
      { repo_name: 'pandas', commit_hash: 'c'.repeat(40) },
      { repo_name: 'pandas', commit_hash: 'd'.repeat(40) },
      { repo_name: 'numpy', commit_hash: 'e'.repeat(40) },
    ];

    expect(
      selectBalancedR2ERows(rows, 3).map((row) => row.commit_hash),
    ).toEqual([
      'a'.repeat(40),
      'e'.repeat(40),
      'c'.repeat(40),
    ]);
  });

  it('resolves the immutable parent SHA of a target commit from Git', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archeagent-r2e-parent-'));
    try {
      const run = (args: string[]) => {
        const result = spawnSync('git', args, {
          cwd: dir,
          encoding: 'utf8',
          shell: false,
        });
        if (result.status !== 0) {
          throw new Error(result.stderr || 'git failed');
        }
        return result.stdout.trim();
      };

      run(['init', '--quiet']);
      run(['config', 'user.email', 'r2e@example.invalid']);
      run(['config', 'user.name', 'R2E Fixture']);
      await writeFile(join(dir, 'x.txt'), 'one\n', 'utf8');
      run(['add', 'x.txt']);
      run(['commit', '--quiet', '-m', 'base']);
      const base = run(['rev-parse', 'HEAD']);

      await writeFile(join(dir, 'x.txt'), 'two\n', 'utf8');
      run(['commit', '--quiet', '-am', 'target']);
      const target = run(['rev-parse', 'HEAD']);

      await expect(resolveR2EBaseCommit({
        repoUrl: dir,
        targetCommit: target,
      })).resolves.toBe(base);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('creates a freeze manifest without exposing raw issue or oracle material', () => {
    const manifest = makeR2ECorpusManifest({
      split: 'dev_10pr_v1',
      offset: 0,
      sourceRows: 100,
      entries: [{
        rowIndex: 7,
        record: source,
        baseCommit,
      }],
    });

    expect(manifest).toMatchObject({
      schema: 'archeagent.r2e-corpus-manifest.v1',
      dataset: 'R2E-Gym/R2E-Gym-Lite',
      split: 'dev_10pr_v1',
      sourceRows: 100,
      selectedRows: 1,
      entries: [{
        rowIndex: 7,
        repoName: 'aiohttp',
        targetCommit,
        baseCommit,
        dockerImage: source.docker_image,
        problemStatementSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        expectedOutputSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }],
    });

    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain(source.problem_statement);
    expect(serialized).not.toContain(source.expected_output_json);
    expect(serialized).not.toContain('SECRET');
  });

  it('fetches one complete row page through an injected transport', async () => {
    const calls: string[] = [];
    const payload = {
      rows: [{ row_idx: 9, row: source, truncated_cells: [] }],
      num_rows_total: 100,
      partial: false,
    };

    const page = await fetchR2ERowPage(
      { split: 'dev_10pr_v1', offset: 5, length: 10 },
      {
        fetchImpl: async (url: string) => {
          calls.push(url);
          return {
            ok: true,
            status: 200,
            async json() {
              return payload;
            },
          };
        },
      },
    );

    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!).searchParams.get('offset')).toBe('5');
    expect(page.entries[0]!.rowIndex).toBe(9);
  });

  it('freezes a balanced corpus before execution and resolves exact parents', async () => {
    const records = [
      {
        ...source,
        repo_name: 'aiohttp',
        commit_hash: '1'.repeat(40),
        docker_image: 'namanjain12/aiohttp_final:' + '1'.repeat(40),
      },
      {
        ...source,
        repo_name: 'aiohttp',
        commit_hash: '2'.repeat(40),
        docker_image: 'namanjain12/aiohttp_final:' + '2'.repeat(40),
      },
      {
        ...source,
        repo_name: 'pandas',
        commit_hash: '3'.repeat(40),
        docker_image: 'namanjain12/pandas_final:' + '3'.repeat(40),
      },
      {
        ...source,
        repo_name: 'numpy',
        commit_hash: '4'.repeat(40),
        docker_image: 'namanjain12/numpy_final:' + '4'.repeat(40),
      },
    ];

    const calls: Array<{ repoUrl: string; targetCommit: string }> = [];
    const frozen = await freezeR2ECorpus({
      split: 'dev_10pr_v1',
      offset: 0,
      page: {
        totalRows: 100,
        entries: records.map((record, rowIndex) => ({ rowIndex, record })),
      },
      count: 3,
      resolveBaseCommit: async (input) => {
        calls.push(input);
        return '0'.repeat(40);
      },
    });

    expect(frozen.tasks.map((task) => task.metadata.repoName)).toEqual([
      'aiohttp',
      'numpy',
      'pandas',
    ]);
    expect(frozen.tasks.every((task) => task.baseCommit === '0'.repeat(40)))
      .toBe(true);
    expect(frozen.manifest.selectedRows).toBe(3);
    expect(frozen.manifest.entries.map((entry) => entry.rowIndex)).toEqual([
      0,
      3,
      2,
    ]);
    expect(calls).toEqual([
      {
        repoUrl: 'https://github.com/aio-libs/aiohttp.git',
        targetCommit: '1'.repeat(40),
      },
      {
        repoUrl: 'https://github.com/numpy/numpy.git',
        targetCommit: '4'.repeat(40),
      },
      {
        repoUrl: 'https://github.com/pandas-dev/pandas.git',
        targetCommit: '3'.repeat(40),
      },
    ]);
  });


  it('freezes an explicit immutable row-index corpus without balanced reselection', async () => {
    const records = Array.from({ length: 6 }, (_, rowIndex) => ({
      ...source,
      repo_name: rowIndex < 3 ? 'aiohttp' : 'pandas',
      commit_hash: String(rowIndex + 1).repeat(40),
      docker_image:
        'namanjain12/' +
        (rowIndex < 3 ? 'aiohttp' : 'pandas') +
        '_final:' +
        String(rowIndex + 1).repeat(40),
    }));

    const frozen = await freezeR2ECorpus({
      split: 'dev_10pr_v1',
      offset: 0,
      page: {
        totalRows: 100,
        entries: records.map((record, rowIndex) => ({ rowIndex, record })),
      },
      count: 2,
      rowIndices: [2, 5],
      resolveBaseCommit: async () => '0'.repeat(40),
    });

    expect(frozen.tasks.map((task) => task.metadata.targetCommit)).toEqual([
      '3'.repeat(40),
      '6'.repeat(40),
    ]);
    expect(frozen.manifest).toMatchObject({
      selectionMode: 'explicit-row-indices',
      rowIndices: [2, 5],
      selectedRows: 2,
    });

    await expect(freezeR2ECorpus({
      split: 'dev_10pr_v1',
      offset: 0,
      page: {
        totalRows: 100,
        entries: records.map((record, rowIndex) => ({ rowIndex, record })),
      },
      count: 2,
      rowIndices: [2, 99],
      resolveBaseCommit: async () => '0'.repeat(40),
    })).rejects.toThrow(/row.*99/i);
  });


  it('parses a bounded corpus-freeze CLI contract', () => {
    expect(parseR2EImportArgs([
      '--out=/tmp/tasks.jsonl',
    ])).toEqual({
      split: 'dev_10pr_v1',
      offset: 0,
      sourceLength: 100,
      count: 10,
      rowIndices: null,
      out: '/tmp/tasks.jsonl',
      manifest: '/tmp/tasks.jsonl.manifest.json',
    });

    expect(parseR2EImportArgs([
      '--split=dev_100pr_v7',
      '--offset=20',
      '--source-length=50',
      '--count=7',
      '--out=/tmp/tasks.jsonl',
      '--manifest=/tmp/manifest.json',
    ])).toEqual({
      split: 'dev_100pr_v7',
      offset: 20,
      sourceLength: 50,
      count: 7,
      rowIndices: null,
      out: '/tmp/tasks.jsonl',
      manifest: '/tmp/manifest.json',
    });

    expect(parseR2EImportArgs([
      '--source-length=100',
      '--count=3',
      '--row-indices=3,12,22',
      '--out=/tmp/tasks.jsonl',
    ])).toMatchObject({
      sourceLength: 100,
      count: 3,
      rowIndices: [3, 12, 22],
    });

    expect(() => parseR2EImportArgs([
      '--count=2',
      '--row-indices=3,12,22',
      '--out=/tmp/tasks.jsonl',
    ])).toThrow(/count.*row-indices/i);

    expect(() => parseR2EImportArgs([
      '--row-indices=3,3',
      '--out=/tmp/tasks.jsonl',
    ])).toThrow(/duplicate/i);

    expect(() => parseR2EImportArgs([])).toThrow(/--out/i);
    expect(() => parseR2EImportArgs([
      '--source-length=101',
      '--out=/tmp/tasks.jsonl',
    ])).toThrow(/100/i);
    expect(() => parseR2EImportArgs([
      '--source-length=5',
      '--count=6',
      '--out=/tmp/tasks.jsonl',
    ])).toThrow(/count/i);
    expect(() => parseR2EImportArgs([
      '--wat=yes',
      '--out=/tmp/tasks.jsonl',
    ])).toThrow(/unknown/i);
  });

});
