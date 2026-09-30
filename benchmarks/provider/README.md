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
- write_file
- finish

Repository traversal and symlink escapes are rejected. Hidden evaluator assets are still injected by the benchmark harness only after the model process exits.

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
