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
- search_text
- replace_text
- write_file
- finish

Repository traversal and symlink escapes are rejected. replace_text requires one exact unique match, so small fixes do not require retransmitting an entire source file. Hidden evaluator assets are still injected by the benchmark harness only after the model process exits.

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

