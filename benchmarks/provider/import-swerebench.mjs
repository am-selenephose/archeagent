#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  convertSweRebenchRecord,
  selectSweRebenchRecords,
} from './import-swerebench-lib.mjs';

function option(name) {
  const prefix = '--' + name + '=';
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const inputPath = option('input');
const cacheDir = option('cache-dir');
const instancesRaw = option('instances');
const outputPath = option('out');

if (!inputPath || !cacheDir || !instancesRaw || !outputPath) {
  console.error(
    'usage: node benchmarks/provider/import-swerebench.mjs ' +
      '--input=dataset.json --cache-dir=cache/swe_rebench ' +
      '--instances=id1,id2 --out=tasks.jsonl',
  );
  process.exit(2);
}

const records = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
const instanceIds = instancesRaw
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const selected = selectSweRebenchRecords(records, instanceIds);

const tasks = [];
for (const record of selected) {
  const cachePath = resolve(cacheDir, record.instance_id + '.json');
  const cache = JSON.parse(await readFile(cachePath, 'utf8'));
  tasks.push(convertSweRebenchRecord(record, cache));
}

await writeFile(
  resolve(outputPath),
  tasks.map((task) => JSON.stringify(task)).join('\n') + '\n',
  'utf8',
);

console.log(
  JSON.stringify({
    schema: 'archeagent.swerebench-import.v1',
    input: resolve(inputPath),
    cacheDir: resolve(cacheDir),
    output: resolve(outputPath),
    instances: tasks.map((task) => task.id),
    count: tasks.length,
  }),
);
