# Provider-backed benchmark

This directory is Archeagent's real-agent benchmark harness. It is intentionally separate from the deterministic synthetic routing benchmark.

## What it measures

Each benchmark task pins a real repository and base commit, gives the coding agent only the issue prompt, and keeps evaluator commands outside the prompt. The harness:

1. clones the repository at the pinned commit;
2. runs the configured coding agent in that worktree;
3. captures the produced Git diff;
4. runs the hidden evaluator commands independently;
5. records pass/fail, runtime, patch hash and evaluator receipts in an append-only JSONL ledger.

This makes model confidence irrelevant. The unit of truth is an executable patch against a pinned repository state.

## Dataset format

One JSON object per line:

```json
{"id":"django__django-12345","repo":"django/django","baseCommit":"<40-char-sha>","prompt":"<issue text>","evaluator":{"commands":["python -m pytest path/to/hidden_test.py"],"timeoutMs":600000},"metadata":{"source":"swe-bench"}}
```

The recommended source is a locally materialized SWE-bench Verified/Lite selection or an internal issue corpus. Large third-party datasets are not vendored into this repository.

## Agent matrix

Agent commands are arrays, never shell strings:

```json
[
  {"id":"codex","argv":["codex","exec","-"],"timeoutMs":900000},
  {"id":"claude","argv":["claude","-p"],"timeoutMs":900000},
  {"id":"gemini","argv":["gemini"],"timeoutMs":900000},
  {"id":"local","argv":["your-local-agent","--stdin"],"timeoutMs":900000}
]
```

Use the exact CLI invocation installed in the benchmark environment. Secrets stay in environment variables consumed by those tools; they are never written to the ledger.

## Run

```bash
node benchmarks/provider/run.mjs \
  --dataset=/secure/path/tasks.jsonl \
  --agents=/secure/path/agents.json \
  --count=100 \
  --ledger=benchmarks/provider/results/living-benchmark.jsonl
```

The ledger is the living benchmark. New runs append evidence rather than overwriting history.

## Integrity

`pnpm benchmark:provider:validate` validates parser, sampling, configuration and fixture assumptions without calling external providers or spending money.

A provider-backed result is not claimed until real agent commands and executable real-repository evaluator tasks have actually been run.
