function assertRecord(record, index) {
  if (!record || typeof record !== 'object') {
    throw new Error('ledger record ' + index + ' must be an object');
  }
  if (record.schema !== 'archeagent.provider-benchmark-run.v2') {
    throw new Error(
      'ledger record ' + index + ' must use archeagent.provider-benchmark-run.v2',
    );
  }
  for (const field of ['taskId', 'repo', 'baseCommit', 'agentId', 'agentFingerprint']) {
    if (typeof record[field] !== 'string' || record[field].trim() === '') {
      throw new Error('ledger record ' + index + ' missing ' + field);
    }
  }
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function primaryKey(record) {
  return record.taskId + '::' + record.agentId;
}

export function parseLedger(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(
          'invalid benchmark ledger JSON at line ' +
            (index + 1) +
            ': ' +
            error.message,
        );
      }
    });
}

export function summarizeLedger(records) {
  const taskStates = new Map();
  const agentIdentities = new Map();
  const firstAttempts = new Map();
  const retryCounts = new Map();

  records.forEach((record, index) => {
    assertRecord(record, index);

    const pinnedState = record.repo + '@' + record.baseCommit;
    const priorState = taskStates.get(record.taskId);
    if (priorState && priorState !== pinnedState) {
      throw new Error(
        'task ' +
          record.taskId +
          ' changed pinned state from ' +
          priorState +
          ' to ' +
          pinnedState,
      );
    }
    taskStates.set(record.taskId, pinnedState);

    const priorIdentity = agentIdentities.get(record.agentId);
    if (priorIdentity && priorIdentity !== record.agentFingerprint) {
      throw new Error(
        'agent identity changed for ' +
          record.agentId +
          ': ' +
          priorIdentity +
          ' -> ' +
          record.agentFingerprint,
      );
    }
    agentIdentities.set(record.agentId, record.agentFingerprint);

    const key = primaryKey(record);
    if (!firstAttempts.has(key)) {
      firstAttempts.set(key, record);
    } else {
      retryCounts.set(key, (retryCounts.get(key) ?? 0) + 1);
    }
  });

  const primary = [...firstAttempts.values()];
  const agentIds = [...agentIdentities.keys()].sort();
  /** @type {Record<string, {
   *   fingerprint: string,
   *   primaryRuns: number,
   *   passed: number,
   *   failed: number,
   *   passRate: number | null,
   *   retries: number,
   *   harnessErrors: number,
   *   harnessErrorRate: number | null,
   *   averageAgentDurationMs: number | null,
   *   averageEvaluatorDurationMs: number | null,
   *   averagePatchBytes: number | null
   * }>} */
  const agents = {};

  for (const agentId of agentIds) {
    const runs = primary.filter((record) => record.agentId === agentId);
    const retries = [...retryCounts.entries()]
      .filter(([key]) => key.endsWith('::' + agentId))
      .reduce((sum, [, count]) => sum + count, 0);

    const durations = runs
      .map((record) => record.agentDurationMs)
      .filter((value) => Number.isFinite(value));
    const evaluatorDurations = runs.flatMap((record) =>
      Array.isArray(record.evaluatorRuns)
        ? record.evaluatorRuns
            .map((run) => run.durationMs)
            .filter((value) => Number.isFinite(value))
        : [],
    );
    const patchBytes = runs
      .map((record) => record.patchBytes)
      .filter((value) => Number.isFinite(value));

    const passed = runs.filter((record) => record.passed === true).length;
    const harnessErrors = runs.filter(
      (record) =>
        typeof record.harnessError === 'string' &&
        record.harnessError.trim() !== '',
    ).length;

    agents[agentId] = {
      fingerprint: agentIdentities.get(agentId),
      primaryRuns: runs.length,
      passed,
      failed: runs.length - passed,
      passRate: runs.length === 0 ? null : passed / runs.length,
      retries,
      harnessErrors,
      harnessErrorRate:
        runs.length === 0 ? null : harnessErrors / runs.length,
      averageAgentDurationMs: average(durations),
      averageEvaluatorDurationMs: average(evaluatorDurations),
      averagePatchBytes: average(patchBytes),
    };
  }

  const pairwise = [];
  for (let i = 0; i < agentIds.length; i += 1) {
    for (let j = i + 1; j < agentIds.length; j += 1) {
      const agentA = agentIds[i];
      const agentB = agentIds[j];

      const byTaskA = new Map(
        primary
          .filter((record) => record.agentId === agentA)
          .map((record) => [record.taskId, record]),
      );
      const byTaskB = new Map(
        primary
          .filter((record) => record.agentId === agentB)
          .map((record) => [record.taskId, record]),
      );

      const commonTasks = [...byTaskA.keys()]
        .filter((taskId) => byTaskB.has(taskId))
        .sort();

      let agentAWins = 0;
      let agentBWins = 0;
      let ties = 0;

      for (const taskId of commonTasks) {
        const aPassed = byTaskA.get(taskId).passed === true;
        const bPassed = byTaskB.get(taskId).passed === true;
        if (aPassed && !bPassed) agentAWins += 1;
        else if (!aPassed && bPassed) agentBWins += 1;
        else ties += 1;
      }

      pairwise.push({
        agentA,
        agentB,
        comparedTasks: commonTasks.length,
        agentAWins,
        agentBWins,
        ties,
      });
    }
  }

  const recordedTimes = records
    .map((record) => Date.parse(record.recordedAt))
    .filter((value) => Number.isFinite(value));

  return {
    schema: 'archeagent.provider-benchmark-summary.v1',
    records: records.length,
    primaryRuns: primary.length,
    retries: records.length - primary.length,
    uniqueTasks: taskStates.size,
    uniqueAgents: agentIdentities.size,
    firstRecordedAt:
      recordedTimes.length === 0
        ? null
        : new Date(Math.min(...recordedTimes)).toISOString(),
    lastRecordedAt:
      recordedTimes.length === 0
        ? null
        : new Date(Math.max(...recordedTimes)).toISOString(),
    agents,
    pairwise,
    methodology: {
      primaryScore: 'first recorded attempt per taskId+agentId',
      retriesExcludedFromPrimaryScore: true,
      harnessErrorsCountAsFailures: true,
    },
  };
}
