#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  extractExcludedR2ERowIndexes,
  fetchR2ERowPage,
  freezeR2ECorpus,
  parseR2EImportArgs,
} from './import-r2e-gym-lib.mjs';

async function writeAtomically(path, content) {
  const target = resolve(path);
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const temporary =
    target + '.tmp-' + String(process.pid) + '-' + String(Date.now());
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, target);
}

async function main() {
  const options = parseR2EImportArgs(process.argv.slice(2));
  if (resolve(options.out) === resolve(options.manifest)) {
    throw new Error('--out and --manifest must be different files');
  }
  if (
    options.excludeManifest &&
    (
      resolve(options.excludeManifest) === resolve(options.out) ||
      resolve(options.excludeManifest) === resolve(options.manifest)
    )
  ) {
    throw new Error(
      '--exclude-manifest must be different from --out and --manifest',
    );
  }

  let excludeRowIndexes = [];
  if (options.excludeManifest) {
    const previousManifest = JSON.parse(
      await readFile(resolve(options.excludeManifest), 'utf8'),
    );
    excludeRowIndexes = extractExcludedR2ERowIndexes(previousManifest, {
      split: options.split,
    });
  }

  const page = await fetchR2ERowPage({
    split: options.split,
    offset: options.offset,
    length: options.sourceLength,
  });

  const frozen = await freezeR2ECorpus({
    split: options.split,
    offset: options.offset,
    page,
    count: options.count,
    rowIndices: options.rowIndices,
    excludeRowIndexes,
  });

  if (frozen.tasks.length !== options.count) {
    throw new Error(
      'R2E freeze selected ' +
        frozen.tasks.length +
        ' tasks but --count requested ' +
        options.count,
    );
  }

  await writeAtomically(
    options.out,
    frozen.tasks.map((task) => JSON.stringify(task)).join('\n') + '\n',
  );
  await writeAtomically(
    options.manifest,
    JSON.stringify(frozen.manifest, null, 2) + '\n',
  );

  process.stdout.write(
    JSON.stringify({
      schema: 'archeagent.r2e-freeze-result.v1',
      dataset: frozen.manifest.dataset,
      split: frozen.manifest.split,
      offset: frozen.manifest.offset,
      sourceRows: frozen.manifest.sourceRows,
      selectedRows: frozen.manifest.selectedRows,
      excludedRows: frozen.manifest.excludedRowIndexes.length,
      out: resolve(options.out),
      manifest: resolve(options.manifest),
    }) + '\n',
  );
}

main().catch((error) => {
  process.stderr.write(
    'R2E corpus freeze failed: ' +
      (error instanceof Error ? error.message : String(error)) +
      '\n',
  );
  process.exitCode = 1;
});
