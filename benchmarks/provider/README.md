# Provider-backed benchmark

This directory is Archeagent's real-agent benchmark harness. It is intentionally separate from the deterministic synthetic routing benchmark.

## Integrity model

A benchmark result is only useful if the coding agent cannot inspect its hidden evaluator and if reruns cannot silently replace failed first attempts.

The v2 harness therefore enforces:

1. each task pins a repository and base commit;
2. deterministic setup commands run before the agent and must leave tracked repository state clean;
3. the agent sees only the issue prompt and normal repository state;
4. hidden evaluator files do not exist in the worktree while the agent is running;
5. hidden evaluator files are injected only after the agent process exits;
6. evaluator commands are argv arrays executed with shell=false;
7. evaluator paths may not escape the worktree or overwrite agent-visible repository content;
8. the produced patch is captured before evaluator injection;
9. agent executable identity is fingerprinted from id, argv, environment-variable names and metadata;
10. the append-only ledger keeps every attempt;
11. published primary metrics use the first recorded task+agent attempt, not a later retry.

## Dataset format

One JSON object per line:

~~~json
{
  "id": "django__django-12345",
  "repo": "django/django",
  "baseCommit": "<40-char-sha>",
  "prompt": "<issue text>",
  "setup": {
    "commands": [
      ["pnpm", "install", "--frozen-lockfile"]
    ],
    "timeoutMs": 600000
  },
  "evaluator": {
    "commands": [
      ["python", "-m", "pytest", "-q", "hidden/test_regression.py"]
    ],
    "files": [
      {
        "path": "hidden/test_regression.py",
        "content": "<hidden evaluator source>"
      }
    ],
    "timeoutMs": 600000
  },
  "metadata": {
    "source": "swe-bench"
  }
}
~~~

Setup commands are agent-visible environment preparation. If setup changes tracked files or creates untracked non-ignored files, the task fails before the agent runs.

Evaluator files are benchmark-authority material. They are loaded by the harness but not placed in the repository until after the agent exits.

Large third-party datasets are not vendored into this repository.

## Agent matrix

Agent commands are arrays, never shell strings:

~~~json
[
  {
    "id": "codex",
    "argv": ["codex", "exec", "-"],
    "metadata": { "provider": "openai", "model": "codex" },
    "timeoutMs": 900000
  }
]
~~~

The harness records a SHA-256 fingerprint for each agent identity. Reusing the same agent id with a different executable identity causes the report stage to fail rather than silently mixing results.

Secrets must stay in environment variables consumed by the provider CLI. Secret values are not written to the ledger and are not part of the identity fingerprint; only environment-variable names are included.

## Run

~~~bash
node benchmarks/provider/run.mjs \
  --dataset=/secure/path/tasks.jsonl \
  --agents=/secure/path/agents.json \
  --count=100 \
  --ledger=benchmarks/provider/results/living-benchmark.jsonl
~~~

New attempts append to the ledger. Existing records are never overwritten.

## Report

~~~bash
node benchmarks/provider/report.mjs \
  --ledger=benchmarks/provider/results/living-benchmark.jsonl \
  --out=benchmarks/provider/results/summary.json
~~~

Primary pass rates are computed from the first recorded attempt for each taskId+agentId pair. Later retries are counted separately and cannot improve the primary score.

The report also emits:

- harness-error rate;
- average agent runtime;
- average evaluator runtime;
- average patch bytes;
- pairwise agent wins on commonly attempted tasks;
- retry count;
- pinned-state integrity checks;
- agent-identity integrity checks.

Harness errors count as failed primary runs. They are never silently dropped.

## Verification

pnpm benchmark:provider:validate validates parser, sampling, agent fingerprinting, first-attempt reporting and fixture assumptions without calling external providers or spending money.

A provider-backed result is not claimed until real agent commands and executable real-repository evaluator tasks have actually been run.


## Bounded OpenAI-compatible local agent

Archeagent includes a provider-agnostic local coding adapter at:

benchmarks/provider/agents/openai-compatible-agent.mjs

It talks to an OpenAI-compatible chat-completions endpoint and deliberately does not expose shell execution to the model.

The model can only request:

- list_files
- read_file
- read_lines
- search_text
- replace_text
- write_file
- finish

Repository traversal and symlink escapes are rejected. `read_file` remains bounded; oversized files return a recoverable `FILE_TOO_LARGE` result and can be inspected through streaming `search_text` plus bounded 1-based `read_lines` windows. `replace_text` can edit an exact unique match in a large file without exposing the full file to the model. Hidden evaluator assets are still injected by the benchmark harness only after the model process exits.

Environment:

~~~bash
export ARCHEAGENT_AGENT_BASE_URL=http://127.0.0.1:11436/v1
export ARCHEAGENT_AGENT_MODEL=qwen2.5-14b-am
export ARCHEAGENT_AGENT_MAX_STEPS=24
~~~

The same adapter can target another OpenAI-compatible endpoint by changing the base URL and model. An optional ARCHEAGENT_AGENT_API_KEY is sent as a Bearer token but is never written to the benchmark ledger.

## Local integration smoke receipt

On 2026-09-30, the adapter was exercised against a local llama.cpp server exposing qwen2.5-14b-am.

One deliberately trivial fixture required the model to edit a tracked text file. The hidden evaluator did not exist in the model worktree until after the model exited.

The final smoke run produced:

- agent exit code: 0
- patch changed: true
- hidden evaluator exit code: 0
- benchmark result: PASS
- agent duration: 863 ms
- patch SHA-256: 1d9282d75a08356c24fae0be2a81c9b35464fe41328d9064c3bbb8baaf0a160b

This proves only the end-to-end plumbing: local model -> bounded editing tools -> patch capture -> hidden evaluator -> receipt. It is not evidence of coding-model quality and is not included in provider performance claims.

The qualified receipt is stored at benchmarks/provider/results/local-qwen-smoke-v1.json.

## SWE-Rebench import

Archeagent can convert selected Python SWE-Rebench records into provider-benchmark tasks without exposing the gold solution patch to the coding agent.

~~~bash
pnpm benchmark:provider:import:swerebench -- \
  --input=/path/to/swe-rebench.json \
  --cache-dir=/path/to/ood_data_unit_tests_cache/swe_rebench \
  --instances=fair-workflows__nanopub-140,fairlearn__fairlearn-636 \
  --out=/secure/path/tasks.jsonl
~~~

Current importer guarantees:

- problem_statement becomes the agent prompt;
- base_commit remains the pinned repository state;
- the gold patch field is discarded and never serialized into the task;
- test_patch is benchmark-authority material and is injected only after agent exit;
- hidden patch files are normalized to a valid terminal newline without changing patch semantics;
- generated hidden evaluator modules are syntax-checked by tests;
- Python tasks run hidden tests in a pinned python:<major.minor>-slim Docker image;
- Docker uses host networking on the validated benchmark host because its default Docker DNS could not resolve package mirrors;
- only allowlisted editable install forms are accepted: pip install -e . and pip install -e .[dev];
- cache-declared pip_packages are tokenized and validated before argv-safe installation;
- cache-declared repo-relative reqs_path requirement files are path-validated before pip install -r;
- requirement paths may not escape the repository;
- arbitrary dataset shell commands are never executed by the importer;
- FAIL_TO_PASS plus PASS_TO_PASS targets are evaluated together;
- hidden test files are restored to the pinned base state before the hidden test patch is applied.

The importer still rejects non-Python tasks rather than inventing an evaluator it cannot reproduce.

A converted task is not a benchmark result. It becomes evidence only after authority controls and the hidden evaluator produce receipts.

## Bounded local OpenAI-compatible coding agent

The local adapter intentionally exposes no shell tool to the model. Allowed model actions are:

- list_files
- read_file
- read_lines
- search_text
- replace_text
- write_file
- finish

Security and reliability boundaries:

- repository traversal and symlink escapes are rejected;
- replace_text requires exactly one match;
- malformed JSON actions receive a compact retry instead of silently guessing intent;
- read_file ENOENT is a recoverable tool result so a model may list/search again;
- path/security violations remain hard failures;
- large model-facing tool results are clipped with explicit truncation metadata;
- older tool turns are compacted when needed while preserving the system prompt and original task prompt;
- the internal action transcript is not replaced by the compacted model-facing context.

The same adapter can target any compatible /v1/chat/completions endpoint by changing the base URL and model. An optional ARCHEAGENT_AGENT_API_KEY is sent as a Bearer token and is not written to the benchmark ledger.

## SWE-Rebench pilot v1

The first frozen pilot corpus selected every local demo record that satisfied the predeclared Python/importer criteria before model outcomes were observed.

Frozen corpus:

- fair-workflows__nanopub-140
- fairlearn__fairlearn-636
- falconry__falcon-2254

Authority-control policy:

1. the pinned base plus hidden tests must fail;
2. the authority-held gold solution plus the same hidden tests must pass;
3. a frozen task that fails controls is marked INVALID_CONTROL rather than silently removed.

At the time of the v1 primary run:

- nanopub-140: VALID control;
- fairlearn-636: VALID control;
- falcon-2254: INVALID_CONTROL because the then-current importer did not yet install its cache-declared requirements files.

The frozen Qwen primary ledger therefore scored two tasks:

- primary runs: 2
- passes: 0
- failures: 2
- retries: 0
- primary pass rate: 0%

Those failures are preserved. They are not replaced by later development replays.

Post-pilot diagnostics identified infrastructure issues without rewriting the original ledger:

- bounded context compaction removed a local-model context-overflow failure mode;
- recoverable missing-file reads removed a model-path-guess crash;
- Fairlearn then produced a patch cleanly, but the hidden evaluator still rejected it with 52/53 tests passing;
- validated reqs_path support later made Falcon's control valid.

Files:

- benchmarks/provider/pilots/swerebench-pilot-v1.manifest.json
- benchmarks/provider/pilots/swerebench-pilot-v1.controls.json
- benchmarks/provider/pilots/swerebench-pilot-v1.summary.json
- benchmarks/provider/results/swerebench-pilot-v1-qwen-primary.jsonl
- benchmarks/provider/results/swerebench-pilot-v1-qwen-summary.json
- benchmarks/provider/pilots/swerebench-pilot-v1.fairlearn-postpilot-diagnostic.json
- benchmarks/provider/pilots/swerebench-pilot-v1.falcon-revalidation.json

This pilot is evidence that the benchmark plumbing can preserve failures, validate hidden evaluators with gold controls, and distinguish infrastructure defects from model-patch defects. It is not a comparative provider benchmark and is not evidence that one model is superior to another.

## R2E-Gym hidden authority benchmark

Archeagent also supports a stronger hidden-authority path built from R2E-Gym Lite.

The R2E path differs from the SWE-Rebench importer:

- the coding agent works on a normal host checkout at the exact parent commit;
- only problem_statement is sent to the model;
- dataset prompt, parsed gold commit material, authority execution traces, hidden tests, and expected status maps are not exposed to the agent;
- the frozen public manifest stores hashes of issue/oracle material, not their raw contents;
- the authority Docker image is instantiated only after the agent exits;
- Docker networking is disabled for evaluation;
- /r2e_tests exists outside /testbed in the authority image and is linked into /testbed only during evaluation;
- the candidate patch is mounted read-only into the authority container;
- pass/fail is based on exact parsed pytest status-map equality with expected_output_json, not the pytest process exit code.

This matters because R2E tasks may intentionally contain known baseline FAILED or ERROR statuses. A valid candidate must reproduce the exact declared map.

### Fresh v1 corpus

r2e-fresh-v1 was frozen from R2E-Gym/R2E-Gym-Lite dev_10pr_v1 before model execution.

Selection properties:

- exploratory row 0 was excluded;
- 10 fresh rows were selected, balanced one per supported repository;
- exact parent SHAs were resolved from Git;
- the hidden authority task artifact was hashed and withheld from the public repository;
- all 10 tasks passed authority controls: base state did not match the oracle, authority-held target patch did match the oracle.

Frozen local-Qwen primary result:

- primary runs: 10
- passes: 1
- failures: 9
- pass rate: 10 percent
- retries: 0
- harness errors: 0
- changed candidates: 3
- unchanged candidates: 7

The passing v1 task was the Scrapy row. Its v1 receipt is preserved exactly as run.

### Authority v2

After the v1 run, receipt audit showed that the passing Scrapy patch was large and its stored diff tail contained ordinary repository test-code mutation signals. Because the v1 full diff was intentionally truncated in the receipt, Archeagent does not retroactively relabel that run.

Instead authority v2 adds a stricter forward-only contract:

- candidate changes under obvious test paths are rejected;
- .archeagent-hidden and r2e_tests paths are forbidden;
- every benchmark receipt records changedPaths and changedPathCount;
- hardened authority results use schema archeagent.r2e-authority-result.v2.

The v1 1/10 result remains historical. Future runs use v2 semantics.

Evidence:

- benchmarks/provider/pilots/r2e-fresh-v1.freeze.json
- benchmarks/provider/pilots/r2e-fresh-v1.manifest.json
- benchmarks/provider/pilots/r2e-fresh-v1.controls.json
- benchmarks/provider/pilots/r2e-fresh-v1.summary.json
- benchmarks/provider/results/r2e-fresh-v1-qwen-primary.jsonl
- benchmarks/provider/results/r2e-fresh-v1-qwen-summary.json

The public repository intentionally does not contain the frozen raw authority task JSONL because that artifact includes hidden expected status maps.

This is a local-model baseline and benchmark-integrity result, not a ranking of commercial model providers.

### Fresh v2 development baseline

A second balanced 10-task R2E corpus was selected from rows not used by the v1 primary corpus. Its hidden authority task JSONL remains withheld because it contains expected status maps.

The preserved local-Qwen primary result is:

- primary runs: 10
- passes: 0
- failures: 10
- retries: 0
- changed candidates: 4
- initial large-file adapter crashes: 3

The final task artifact SHA-256 is `a3af6a585c023d8c14b7a04db3ff3d1d29e085b179421486a508b71ceacb867a`. Exact base/gold controls for that final artifact were revalidated after the primary run and all 10 passed the required pattern: base status map did not match the oracle, gold status map matched exactly. Because this exact-artifact revalidation happened post-primary, v2 is labeled a development baseline rather than a preregistered comparative benchmark.

A post-primary diagnostic then reran only the three tasks that had previously hard-crashed on oversized source reads after adding bounded large-file navigation:

- NumPy: no read-limit crash; exhausted the 32-step diagnostic budget without a patch.
- Pandas: no read-limit crash; exhausted the 32-step diagnostic budget without a patch.
- Pillow: produced a 514-byte source-only patch, but the hidden authority rejected it semantically.

The diagnostic does not change the frozen 0/10 primary score. It shows that the large-file adapter failure class was removed and exposes the next bottlenecks as planning budget and model semantics.

Public evidence:

- `benchmarks/provider/pilots/r2e-fresh-v2.manifest.json`
- `benchmarks/provider/pilots/r2e-fresh-v2.exclusions.json`
- `benchmarks/provider/pilots/r2e-fresh-v2.controls.json`
- `benchmarks/provider/pilots/r2e-fresh-v2.summary.json`
- `benchmarks/provider/pilots/r2e-fresh-v2.largefile-diagnostic.summary.json`
- `benchmarks/provider/results/r2e-fresh-v2-qwen-primary.jsonl`
- `benchmarks/provider/results/r2e-fresh-v2-qwen-summary.json`
- `benchmarks/provider/results/r2e-fresh-v2-largefile-diagnostic.jsonl`

The preregistered v3 corpus below is the next clean empirical run: its exact final authority artifact passed controls before the first model attempt.

### Convergence v3.1 post-primary diagnostic

After the frozen r2e-fresh-v2 primary run, three representative failure classes were replayed on the same frozen tasks using a separately versioned diagnostic agent. This diagnostic does not replace or improve the frozen 0/10 primary score.

The adapter changes were generic and benchmark-visible rather than task-specific:

- replace_text rejects identical old/new text as a recoverable NO_OP_REPLACE result;
- every model-facing tool result carries used/remaining step budget;
- the final quarter of the step budget carries an explicit convergence warning to stop broad exploration and make the best supported source edit or finish;
- safe-path replace_text ENOENT is recoverable so guessed source paths do not crash the agent;
- R2E tasks declare a source-only-no-tests candidate policy;
- the harness tells constrained agents not to modify tests, conftest.py, or .archeagent-hidden authority paths before execution.

Observed diagnostic outcomes:

- Pyramid: produced a source patch and exited cleanly; hidden authority rejected the patch semantically.
- Orange3: the prior missing-path hard crash was removed; the agent exited cleanly but produced no patch.
- Coverage.py: the prior candidate test-file mutation did not recur; the agent exited cleanly but produced no patch.

The diagnostic recorded 0/3 passes. Its value is failure-class separation and adapter robustness, not a performance claim.

Evidence:

- benchmarks/provider/pilots/r2e-convergence-v31-diagnostic.summary.json
- benchmarks/provider/results/r2e-convergence-v31-diagnostic.jsonl



### Fresh v3 preregistered primary

r2e-fresh-v3 froze 10 explicit rows from dev_10pr_v1 before model execution. The public manifest contains issue/oracle hashes and immutable base/target commits; the raw authority task artifact remains private because it contains expected status maps.

Pre-run integrity:

- authority artifact SHA-256: `53061dd18f92009cf16d9a2cb27bc7c564aa8e8f0d1e1e3b59ec12421beea4f7`;
- authority controls SHA-256: `07cc489ba8852d2c7ca97b37b67b886ceb6764318e7e0fe2fb58a00a177e4a48`;
- 10/10 base/gold controls passed before the primary run;
- primary agent config revision 2 SHA-256: `841e6cee5b199ddfca56bebeb54ebf94b32250041aad66d7e7c9c573150b16c7`;
- primary agent fingerprint: `da11cb6384bf3204753ab32b39b4f17f28475b697f19b5793f89da5cd4682ee1`.

Frozen primary result:

- primary runs: 10;
- passes: 0;
- failures: 10;
- retries: 0;
- harness errors: 1;
- harness-error rate: 10 percent;
- first recorded attempt: 2026-10-02T17:04:11.437Z;
- last recorded attempt: 2026-10-02T17:15:38.044Z.

The pandas task failed during repository clone with `fatal: early EOF`. The harness error remains in the primary denominator. Seven tasks produced candidate patches, two completed with no patch, and one failed before candidate execution.

After the primary completed, current-main convergence and source-only edit-policy hardening were reconciled into the research branch. Those changes are explicitly post-primary; they do not upgrade, replace, or rerun the frozen v3 result.

Evidence:

- `benchmarks/provider/pilots/r2e-fresh-v3.freeze.json`
- `benchmarks/provider/pilots/r2e-fresh-v3.manifest.json`
- `benchmarks/provider/pilots/r2e-fresh-v3.controls.json`
- `benchmarks/provider/pilots/r2e-fresh-v3.agent.json`
- `benchmarks/provider/pilots/r2e-fresh-v3.summary.json`
- `benchmarks/provider/results/r2e-fresh-v3-qwen-primary.jsonl`
- `benchmarks/provider/results/r2e-fresh-v3-qwen-summary.json`

This is a preregistered local-model baseline, not a comparative provider ranking.

### Forward authority v3 and unseen-corpus hardening

After the frozen r2e-fresh-v3 primary completed, Archeagent added forward-only benchmark hardening. These changes do not rewrite any historical ledger or historical authority receipt.

- R2E corpus freezing accepts a prior corpus manifest and excludes those row indexes before balanced selection. The resulting manifest records the excluded row indexes.
- Authority result schema v3 adds aggregate mismatch diagnostics: mismatched status count, missing expected count, unexpected actual count, and PASSED/FAILED/ERROR totals. Hidden test names are not emitted by this summary.
- The local bounded agent warns on three heavily overlapping read windows and on long read-only exploration streaks before the step budget is exhausted.
- Repository cloning retries once only for recognized transient transport failures such as early EOF, RPC/curl/TLS disconnects, or timeout. Deterministic clone failures still fail immediately.
- Successful benchmark receipts record cloneAttempts so transport recovery is auditable.

Example unseen freeze:

~~~bash
node benchmarks/provider/import-r2e-gym.mjs \
  --split=dev_10pr_v1 \
  --source-length=100 \
  --count=10 \
  --exclude-manifest=benchmarks/provider/pilots/<prior>.manifest.json \
  --out=/secure/path/r2e-next.jsonl \
  --manifest=/secure/path/r2e-next.manifest.json
~~~

For multiple historical corpora, construct one validated exclusion manifest containing the union of previously frozen row entries, or use explicit row indices. The next clean benchmark must be frozen before model execution and must not reuse previously observed rows.

