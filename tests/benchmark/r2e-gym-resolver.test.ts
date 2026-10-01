import { describe, expect, it } from 'vitest';
import {
  parseR2EInput,
  resolveR2EBaseProbe,
} from '../../benchmarks/provider/import-r2e-gym-lib.mjs';

const target = 'd2b52d7c32a744379438c466e68ad2cb471deeba';
const parent = '871fedcb014c0e568f4eed3ef5c74ae94c59c936';

describe('R2E-Gym base resolver', () => {
  it('parses JSON arrays and JSONL inputs', () => {
    const a = { repo_name: 'aiohttp', commit_hash: target };
    const b = { repo_name: 'pandas', commit_hash: '1'.repeat(40) };

    expect(parseR2EInput(JSON.stringify([a, b]))).toEqual([a, b]);
    expect(
      parseR2EInput(JSON.stringify(a) + '\n' + JSON.stringify(b) + '\n'),
    ).toEqual([a, b]);
  });

  it('validates a Docker authority probe only when image HEAD is the target parent', () => {
    expect(
      resolveR2EBaseProbe({
        repoName: 'aiohttp',
        targetCommit: target,
        stdout: [
          'BASE_HEAD=' + parent,
          'TARGET_PARENT=' + parent,
          'TARGET_TYPE=commit',
          'ROOT_TESTS=yes',
          'RUN_TESTS=yes',
        ].join('\n'),
      }),
    ).toEqual({
      baseCommit: parent,
      targetParent: parent,
      rootTestsPresent: true,
      runTestsPresent: true,
    });
  });

  it('rejects authority probes with parent mismatch or missing hidden tests', () => {
    expect(() =>
      resolveR2EBaseProbe({
        repoName: 'aiohttp',
        targetCommit: target,
        stdout: [
          'BASE_HEAD=' + '2'.repeat(40),
          'TARGET_PARENT=' + parent,
          'TARGET_TYPE=commit',
          'ROOT_TESTS=yes',
          'RUN_TESTS=yes',
        ].join('\n'),
      }),
    ).toThrow(/parent/i);

    expect(() =>
      resolveR2EBaseProbe({
        repoName: 'aiohttp',
        targetCommit: target,
        stdout: [
          'BASE_HEAD=' + parent,
          'TARGET_PARENT=' + parent,
          'TARGET_TYPE=commit',
          'ROOT_TESTS=no',
          'RUN_TESTS=yes',
        ].join('\n'),
      }),
    ).toThrow(/hidden tests/i);
  });
});
