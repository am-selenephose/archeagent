import { describe, expect, it } from 'vitest';
import {
  findForbiddenSourceOnlyPaths,
} from '../../benchmarks/provider/path-policy.mjs';

describe('shared source-only edit policy', () => {
  it('matches benchmark authority semantics for test and hidden paths', () => {
    expect(findForbiddenSourceOnlyPaths([
      'src/module.py',
      'tests/test_module.py',
      'pkg/conftest.py',
      'web/button_test.ts',
      '.archeagent-hidden/evaluator.mjs',
      'src/contest.py',
    ])).toEqual([
      '.archeagent-hidden/evaluator.mjs',
      'pkg/conftest.py',
      'tests/test_module.py',
      'web/button_test.ts',
    ]);
  });

  it('normalizes path separators and rejects malformed entries', () => {
    expect(findForbiddenSourceOnlyPaths([
      'tests\\test_windows.py',
    ])).toEqual(['tests/test_windows.py']);

    expect(() =>
      findForbiddenSourceOnlyPaths(['']),
    ).toThrow(/non-empty/i);
  });
});
