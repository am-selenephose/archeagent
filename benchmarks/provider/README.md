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

Archeagent can convert selected Python SWE-Rebench records into provider-benchmark tasks without exposing the gold solution patch to the agent.

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
- Python tasks run their hidden tests in a pinned python:<major.minor>-slim Docker image;
- Docker uses host networking because the validated benchmark host cannot resolve package mirrors through its default Docker DNS;
- only allowlisted editable install forms are accepted: pip install -e . and pip install -e .[dev];
- arbitrary dataset shell commands are not executed by the importer.

The importer currently rejects non-Python tasks rather than inventing an evaluator it cannot reproduce.


## SWE-Rebench importer

Archeagent can convert selected Python SWE-Rebench records into the provider benchmark task format without exposing the gold solution patch to the coding agent.

The importer:

- requires an immutable repository and base commit;
- copies only the problem statement into the agent prompt;
- drops the gold solution patch entirely;
- stores the benchmark test patch as a hidden evaluator asset;
- restores hidden test files to the pinned base state before applying the hidden patch;
- rejects hidden patch paths that escape the repository;
- rejects arbitrary dataset install shell and only accepts explicit editable-install shapes;
- evaluates Python tasks in a pinned Python slim Docker image using targeted FAIL_TO_PASS plus PASS_TO_PASS tests.

Example:

~~~bash
pnpm benchmark:swerebench:import -- \
  --input=/path/to/swe-rebench.json \
  --cache-dir=/path/to/swe_rebench/cache \
  --instances=fair-workflows__nanopub-140 \
  --out=/tmp/archeagent-swerebench-tasks.jsonl
~~~

Current support is deliberately narrow: Python tasks whose cache metadata declares Python major.minor and an allowlisted editable install command. Unsupported languages or install recipes are rejected rather than approximated.

A task imported from SWE-Rebench is still not a benchmark result. It becomes evidence only after an agent actually runs and the hidden evaluator produces a receipt.


## Real SWE-Rebench development pilot

The first imported real-task development pilot used fair-workflows__nanopub-140.

Controls:

- the pinned base environment passed the selected existing tests;
- the hidden evaluator accepted the authority-held gold solution with 3/3 selected tests passing;
- the gold solution and hidden test patch were not exposed to the coding agent.

The local qwen2.5-14b-am development adapter then failed the task. After protocol recovery improvements it produced a real patch and exited cleanly, but the hidden evaluator rejected the patch with 2 failed and 1 passed selected tests.

This failure is preserved rather than replaced by a retry. It demonstrates that the importer/evaluator can reject a plausible but incorrect model patch.

Qualified receipt:

benchmarks/provider/results/local-qwen-swerebench-nanopub-140-dev-v1.json

This single development task is not included as a provider-performance claim.
