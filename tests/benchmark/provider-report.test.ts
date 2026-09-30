import { describe, expect, it } from 'vitest';
import { summarizeLedger } from '../../benchmarks/provider/report-lib.mjs';

function record(overrides: Record<string, unknown>) {
  return {
    schema: 'archeagent.provider-benchmark-run.v2',
    taskId: 'task-1',
    repo: 'owner/repo',
    baseCommit: 'abc123',
    agentId: 'agent-a',
    agentFingerprint: 'fingerprint-a',
    passed: false,
    changed: true,
    agentExitCode: 0,
    agentTimedOut: false,
    agentDurationMs: 1000,
    patchSha256: 'patch',
    patchBytes: 100,
    evaluatorFilesInjected: 1,
    evaluatorRuns: [
      {
        commandHash: 'cmd',
        exitCode: 1,
        timedOut: false,
        durationMs: 200,
        stderrTail: '',
      },
    ],
    recordedAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('provider benchmark report', () => {
  it('uses the first task-agent attempt for the primary score and counts retries separately', () => {
    const summary = summarizeLedger([
      record({ passed: false }),
      record({
        passed: true,
        recordedAt: '2026-09-30T00:01:00.000Z',
        evaluatorRuns: [{
          commandHash: 'cmd',
          exitCode: 0,
          timedOut: false,
          durationMs: 180,
          stderrTail: '',
        }],
      }),
    ]);

    expect(summary.primaryRuns).toBe(1);
    expect(summary.retries).toBe(1);
    expect(summary.agents['agent-a']).toMatchObject({
      primaryRuns: 1,
      passed: 0,
      passRate: 0,
      retries: 1,
    });
  });

  it('computes pairwise wins only on tasks both agents attempted', () => {
    const summary = summarizeLedger([
      record({ taskId: 'one', agentId: 'agent-a', agentFingerprint: 'a', passed: true }),
      record({ taskId: 'one', agentId: 'agent-b', agentFingerprint: 'b', passed: false }),
      record({ taskId: 'two', agentId: 'agent-a', agentFingerprint: 'a', passed: false }),
      record({ taskId: 'two', agentId: 'agent-b', agentFingerprint: 'b', passed: false }),
      record({ taskId: 'three', agentId: 'agent-a', agentFingerprint: 'a', passed: true }),
    ]);

    expect(summary.pairwise).toContainEqual({
      agentA: 'agent-a',
      agentB: 'agent-b',
      comparedTasks: 2,
      agentAWins: 1,
      agentBWins: 0,
      ties: 1,
    });
  });

  it('refuses to combine one task id across different pinned repository states', () => {
    expect(() => summarizeLedger([
      record({ taskId: 'same', baseCommit: 'aaa' }),
      record({ taskId: 'same', baseCommit: 'bbb', agentId: 'agent-b', agentFingerprint: 'b' }),
    ])).toThrow(/pinned state/i);
  });

  it('refuses to combine one agent id across different executable identities', () => {
    expect(() => summarizeLedger([
      record({ taskId: 'one', agentFingerprint: 'fingerprint-a' }),
      record({ taskId: 'two', agentFingerprint: 'changed-fingerprint' }),
    ])).toThrow(/agent identity/i);
  });

  it('counts harness errors in scheduled runs instead of silently dropping them', () => {
    const summary = summarizeLedger([
      record({
        passed: false,
        harnessError: 'provider CLI crashed',
        agentExitCode: null,
        evaluatorRuns: [],
      }),
    ]);

    expect(summary.agents['agent-a']).toMatchObject({
      primaryRuns: 1,
      passed: 0,
      harnessErrors: 1,
      passRate: 0,
    });
  });
});
