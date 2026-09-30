#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  appendLedger,
  balancedSample,
  loadAgentMatrix,
  loadDataset,
  runBenchmarkTask,
} from './harness.mjs';

function option(name, fallback = null) {
  const prefix = '--' + name + '=';
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const datasetPath = option('dataset');
const agentsPath = option('agents');
const ledgerPath = resolve(option('ledger', 'benchmarks/provider/results/living-benchmark.jsonl'));
const count = Number(option('count', '100'));

if (!datasetPath || !agentsPath) {
  console.error(
    'usage: node benchmarks/provider/run.mjs --dataset=tasks.jsonl --agents=agents.json [--count=100] [--ledger=path]',
  );
  process.exit(2);
}

const tasks = balancedSample(await loadDataset(datasetPath), count);
const agents = await loadAgentMatrix(agentsPath);
await mkdir(dirname(ledgerPath), { recursive: true });

let failures = 0;
for (const task of tasks) {
  for (const agent of agents) {
    process.stdout.write('[' + task.id + '] ' + agent.id + ' ... ');
    try {
      const record = await runBenchmarkTask(task, agent);
      await appendLedger(ledgerPath, record);
      console.log(record.passed ? 'PASS' : 'FAIL');
      if (!record.passed) failures += 1;
    } catch (error) {
      failures += 1;
      const record = {
        schema: 'archeagent.provider-benchmark-run.v1',
        taskId: task.id,
        repo: task.repo,
        baseCommit: task.baseCommit,
        agentId: agent.id,
        passed: false,
        harnessError: error instanceof Error ? error.message : String(error),
        recordedAt: new Date().toISOString(),
      };
      await appendLedger(ledgerPath, record);
      console.log('HARNESS_ERROR');
    }
  }
}

console.log(
  JSON.stringify({
    tasks: tasks.length,
    agents: agents.length,
    runs: tasks.length * agents.length,
    failures,
    ledgerPath,
  }),
);
process.exitCode = failures === 0 ? 0 : 1;
