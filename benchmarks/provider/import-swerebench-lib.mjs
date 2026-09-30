function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(label + ' must be a non-empty string');
  }
  return value.trim();
}

function unique(values) {
  return [...new Set(values)];
}

function safeInstanceId(value) {
  return requiredString(value, 'instance_id').replace(/[^A-Za-z0-9_.-]+/g, '_');
}

function pythonEvaluatorTargets(cache) {
  const failToPass = Array.isArray(cache.FAIL_TO_PASS)
    ? cache.FAIL_TO_PASS.filter((value) => typeof value === 'string' && value)
    : [];
  const passToPass = Array.isArray(cache.PASS_TO_PASS)
    ? cache.PASS_TO_PASS.filter((value) => typeof value === 'string' && value)
    : [];

  const targets = unique([...failToPass, ...passToPass]);
  if (targets.length === 0) {
    throw new Error('SWE-Rebench Python cache must include FAIL_TO_PASS or PASS_TO_PASS tests');
  }
  return targets;
}


function extractTestFiles(testPatch) {
  const files = [];

  for (const line of testPatch.split(/\r?\n/)) {
    if (!line.startsWith('+++ ')) continue;
    const raw = line.slice(4).trim();
    if (raw === '/dev/null') continue;

    const path = raw.startsWith('b/') ? raw.slice(2) : raw;
    const portable = path.replaceAll('\\\\', '/');

    if (
      portable === '' ||
      portable.startsWith('/') ||
      portable === '..' ||
      portable.startsWith('../') ||
      portable.includes('/../')
    ) {
      throw new Error('SWE-Rebench test patch path escapes repository: ' + raw);
    }

    files.push(portable);
  }

  const uniqueFiles = unique(files);
  if (uniqueFiles.length === 0) {
    throw new Error('SWE-Rebench test_patch does not identify test files');
  }
  return uniqueFiles;
}

function normalizePythonVersion(cache) {
  const version = requiredString(
    cache.install_config?.python,
    'install_config.python',
  );
  if (!/^\d+\.\d+$/.test(version)) {
    throw new Error(
      'install_config.python must be major.minor, for example 3.9',
    );
  }
  return version;
}

function normalizeEditableInstall(cache) {
  const install = requiredString(
    cache.install_config?.install,
    'install_config.install',
  );
  const normalized = install.replace(/\s+/g, ' ').trim();

  if (normalized === 'pip install -e .') return '.';
  if (normalized === 'pip install -e .[dev]') return '.[dev]';

  throw new Error(
    'unsupported SWE-Rebench Python install command: ' + normalized,
  );
}

function normalizeRequirementFiles(cache) {
  const raw = cache.install_config?.reqs_path;
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('install_config.reqs_path must be an array');
  }

  return unique(
    raw.map((entry) => {
      if (typeof entry !== 'string' || entry.trim() === '') {
        throw new Error(
          'install_config.reqs_path entries must be non-empty strings',
        );
      }

      const portable = entry.trim().replaceAll('\\', '/');
      if (
        portable.startsWith('/') ||
        portable === '..' ||
        portable.startsWith('../') ||
        portable.includes('/../') ||
        portable.includes('\0')
      ) {
        throw new Error(
          'unsafe install_config.reqs_path entry: ' + entry,
        );
      }

      if (!/^[A-Za-z0-9._/-]+$/.test(portable)) {
        throw new Error(
          'unsafe install_config.reqs_path entry: ' + entry,
        );
      }

      return portable;
    }),
  );
}

function normalizePipPackages(cache) {
  const raw = cache.install_config?.pip_packages;
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('install_config.pip_packages must be an array');
  }

  const requirementPattern =
    /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9._,-]+\])?(?:(?:===|==|!=|~=|>=|<=|>|<)[A-Za-z0-9.*+!_-]+)?$/;
  const tokens = [];

  for (const entry of raw) {
    if (typeof entry !== 'string') {
      throw new Error('install_config.pip_packages entries must be strings');
    }

    for (const token of entry.trim().split(/\s+/).filter(Boolean)) {
      if (!requirementPattern.test(token)) {
        throw new Error(
          'unsafe install_config.pip_packages token: ' + token,
        );
      }
      tokens.push(token);
    }
  }

  return unique(tokens);
}

function quoteSafeRequirement(value) {
  return "'" + value + "'";
}

function makePythonDockerEvaluator({
  hiddenPatchPath,
  baseCommit,
  testFiles,
  pythonVersion,
  packageSpec,
  requirementFiles,
  pipPackages,
  targets,
}) {
  return [
    "import { spawnSync } from 'node:child_process';",
    "import { resolve } from 'node:path';",
    '',
    "function run(argv) {",
    "  const result = spawnSync(argv[0], argv.slice(1), {",
    "    cwd: process.cwd(),",
    "    encoding: 'utf8',",
    "    stdio: ['ignore', 'pipe', 'pipe'],",
    "    shell: false,",
    "  });",
    "  if (result.stdout) process.stdout.write(result.stdout);",
    "  if (result.stderr) process.stderr.write(result.stderr);",
    "  if (result.error) throw result.error;",
    "  if (result.status !== 0) process.exit(result.status ?? 1);",
    "}",
    '',
    'const patchPath = ' + JSON.stringify(hiddenPatchPath) + ';',
    'const baseCommit = ' + JSON.stringify(baseCommit) + ';',
    'const testFiles = ' + JSON.stringify(testFiles) + ';',
    'const image = ' +
      JSON.stringify('python:' + pythonVersion + '-slim') +
      ';',
    'const packageSpec = ' + JSON.stringify(packageSpec) + ';',
    'const requirementFiles = ' + JSON.stringify(requirementFiles) + ';',
    'const pipPackages = ' + JSON.stringify(pipPackages) + ';',
    'const targets = ' + JSON.stringify(targets) + ';',
    '',
    "run(['git', 'checkout', baseCommit, '--', ...testFiles]);",
    "run(['git', 'apply', '--whitespace=nowarn', patchPath]);",
    '',
    "const repoDir = resolve(process.cwd());",
    "const installAndTest = [",
    "  'set -eu',",
    "  'apt-get update -qq',",
    "  'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gcc git >/dev/null',",
    "  'python -m pip install -q --upgrade pip',",
    ...requirementFiles.map(
      (path) =>
        '  ' +
        JSON.stringify(
          'python -m pip install -q -r ' + quoteSafeRequirement(path),
        ) +
        ',',
    ),
    pipPackages.length > 0
      ? '  ' +
        JSON.stringify(
          'python -m pip install -q ' +
            pipPackages.map(quoteSafeRequirement).join(' '),
        ) +
        ','
      : "  ':',",
    "  'python -m pip install -q -e \"' + packageSpec + '\"',",
    "  'exec python -m pytest --no-header -rA --tb=line --color=no -p no:cacheprovider -W ignore::DeprecationWarning \"$@\"',",
    "].join(' && ');",
    '',
    "run([",
    "  'docker',",
    "  'run',",
    "  '--rm',",
    "  '--network',",
    "  'host',",
    "  '-v',",
    "  repoDir + ':/testbed',",
    "  '-w',",
    "  '/testbed',",
    "  image,",
    "  'sh',",
    "  '-lc',",
    "  installAndTest,",
    "  'archeagent-evaluator',",
    "  ...targets,",
    "]);",
    '',
  ].join('\n');
}

export function convertSweRebenchRecord(record, cache) {
  if (!record || typeof record !== 'object') {
    throw new Error('SWE-Rebench record must be an object');
  }
  if (!cache || typeof cache !== 'object') {
    throw new Error('SWE-Rebench cache must be an object');
  }

  const id = requiredString(record.instance_id, 'instance_id');
  const repo = requiredString(record.repo, 'repo');
  const baseCommit = requiredString(record.base_commit, 'base_commit');
  const prompt = requiredString(record.problem_statement, 'problem_statement');
  const rawTestPatch = requiredString(record.test_patch, 'test_patch');
  const testPatch = rawTestPatch.endsWith('\n')
    ? rawTestPatch
    : rawTestPatch + '\n';
  const testFiles = extractTestFiles(testPatch);

  if (cache.instance_id && cache.instance_id !== id) {
    throw new Error(
      'SWE-Rebench cache instance_id does not match source record: ' +
        cache.instance_id +
        ' != ' +
        id,
    );
  }
  if (cache.repo && cache.repo !== repo) {
    throw new Error(
      'SWE-Rebench cache repo does not match source record: ' +
        cache.repo +
        ' != ' +
        repo,
    );
  }

  if (cache.language !== 'py') {
    throw new Error(
      'SWE-Rebench importer currently supports Python task caches only',
    );
  }

  const hiddenStem = '.archeagent-hidden/' + safeInstanceId(id);
  const hiddenPatchPath = hiddenStem + '.test.patch';
  const hiddenEvaluatorPath = hiddenStem + '.evaluate.mjs';
  const targets = pythonEvaluatorTargets(cache);
  const pythonVersion = normalizePythonVersion(cache);
  const packageSpec = normalizeEditableInstall(cache);
  const requirementFiles = normalizeRequirementFiles(cache);
  const pipPackages = normalizePipPackages(cache);

  return {
    id,
    repo,
    baseCommit,
    prompt,
    setup: {
      commands: [],
      timeoutMs: 600000,
    },
    evaluator: {
      files: [
        {
          path: hiddenPatchPath,
          content: testPatch,
        },
        {
          path: hiddenEvaluatorPath,
          content: makePythonDockerEvaluator({
            hiddenPatchPath,
            baseCommit,
            testFiles,
            pythonVersion,
            packageSpec,
            requirementFiles,
            pipPackages,
            targets,
          }),
        },
      ],
      commands: [['node', hiddenEvaluatorPath]],
      timeoutMs: 900000,
    },
    metadata: {
      source: 'swe-rebench',
      instanceId: id,
      language: cache.language,
      python: pythonVersion,
      installSpec: packageSpec,
      requirementFiles,
      pipPackages,
      evaluatorRuntime: 'docker',
      evaluatorImage: 'python:' + pythonVersion + '-slim',
      failToPass: Array.isArray(cache.FAIL_TO_PASS)
        ? [...cache.FAIL_TO_PASS]
        : [],
      passToPass: Array.isArray(cache.PASS_TO_PASS)
        ? [...cache.PASS_TO_PASS]
        : [],
      isLite: record.meta?.is_lite === true,
      hasHiddenTestPatch: true,
    },
  };
}

export function selectSweRebenchRecords(records, instanceIds) {
  if (!Array.isArray(records)) {
    throw new Error('SWE-Rebench source dataset must be an array');
  }
  if (!Array.isArray(instanceIds) || instanceIds.length === 0) {
    throw new Error('at least one SWE-Rebench instance id is required');
  }

  const byId = new Map(
    records
      .filter(
        (record) =>
          record &&
          typeof record === 'object' &&
          typeof record.instance_id === 'string',
      )
      .map((record) => [record.instance_id, record]),
  );

  return instanceIds.map((id) => {
    const record = byId.get(id);
    if (!record) {
      throw new Error('SWE-Rebench instance not found: ' + id);
    }
    return record;
  });
}
