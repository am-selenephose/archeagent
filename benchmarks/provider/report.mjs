#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseLedger, summarizeLedger } from './report-lib.mjs';

function option(name, fallback = null) {
  const prefix = '--' + name + '=';
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const ledgerPath = option('ledger');
const outputPath = option('out');

if (!ledgerPath) {
  console.error(
    'usage: node benchmarks/provider/report.mjs --ledger=results.jsonl [--out=summary.json]',
  );
  process.exit(2);
}

const records = parseLedger(await readFile(resolve(ledgerPath), 'utf8'));
const summary = summarizeLedger(records);
const json = JSON.stringify(summary, null, 2) + '\n';

if (outputPath) {
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, json, 'utf8');
}

process.stdout.write(json);
