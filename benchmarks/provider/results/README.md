# Provider benchmark results

This directory is reserved for append-only provider benchmark receipts.

A real run writes JSONL records using schema:

archeagent.provider-benchmark-run.v2

A generated report uses schema:

archeagent.provider-benchmark-summary.v1

Do not check in fabricated provider results. The synthetic routing receipt lives separately under benchmarks/results/.

## Publication rule

Primary performance numbers must come from the first recorded attempt for every taskId+agentId pair.

Retries remain in the living ledger and are reported separately. They may be used for debugging or recovery analysis, but they do not replace the primary attempt.

The report refuses to combine:

- one task id across different repository/base-commit states;
- one agent id across different executable identity fingerprints.

Harness errors remain failures in the primary denominator.

## Recommended publication bundle

- immutable task dataset or dataset manifest;
- exact provider/agent matrix;
- pinned repository/base commits;
- living-benchmark.jsonl;
- generated summary.json;
- evaluator version/hash or evaluator bundle hash;
- cost and latency assumptions;
- failures and harness errors, not only successful runs.

The example task file in the parent directory is schema documentation only and is not a benchmark claim.
