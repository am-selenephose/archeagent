# Provider benchmark results

This directory is reserved for append-only provider benchmark receipts.

A real run writes JSONL records using schema:

archeagent.provider-benchmark-run.v1

Do not check in fabricated provider results. The synthetic routing receipt lives separately under benchmarks/results/.

Recommended publication bundle for a real provider study:

- immutable task dataset or dataset manifest;
- exact provider/agent matrix;
- pinned repository/base commits;
- living-benchmark.jsonl;
- aggregate summary generated from that ledger;
- evaluator version/hash;
- cost and latency assumptions;
- failures and harness errors, not only successful runs.

The example task file in the parent directory is schema documentation only and is not a benchmark claim.
