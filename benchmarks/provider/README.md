# Provider-backed benchmark

This directory is Archeagent's real-agent benchmark harness. It is intentionally separate from the deterministic synthetic routing benchmark.

## Integrity model

A benchmark result is only useful if the coding agent cannot inspect its hidden evaluator and if reruns cannot silently replace failed first attempts.

The v2 harness therefore enforces:

1. each task pins a repository and base commit;
2. the agent sees only the issue prompt and normal repository state;
3. hidden evaluator files do not exist in the worktree while the agent is running;
4. hidden evaluator files are injected only after the agent process exits;
5. evaluator commands are argv arrays executed with shell=false;
6. evaluator paths may not escape the worktree or overwrite agent-visible repository content;
7. the produced patch is captured before evaluator injection;
8. agent executable identity is fingerprinted from id, argv, environment-variable names and metadata;
9. the append-only ledger keeps every attempt;
10. published primary metrics use the first recorded task+agent attempt, not a later retry.

## Dataset format

One JSON object per line:

~~~json
{
  "id": "django__django-12345",
  "repo": "django/django",
  "baseCommit": "<40-char-sha>",
  "prompt": "<issue text>",
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
