# ShipProof Architecture

ShipProof is an AI-native production engineering control plane.

The core rule is simple:

> Model output is a proposal, not a release decision.

## Control flow

1. A repository and acceptance target enter ShipProof.
2. Candidate coding agents work in isolated branches or worktrees.
3. Each candidate produces a patch manifest plus evidence.
4. Deterministic release gates evaluate the candidate.
5. The evaluator produces MERGE, NEEDS_WORK or REJECT.
6. A human retains final merge authority.

## Release gates

- regression tests;
- API and schema contracts;
- authorization and security boundaries;
- database migrations;
- performance budget;
- evidence quality and reproducibility.

Critical failures cannot be outweighed by a high aggregate score.

## Production expansion

The current demo keeps the evaluator deterministic and local. The production target adds:

- PostgreSQL for runs, candidates, evidence and decisions;
- Redis and BullMQ for durable evaluation queues;
- isolated Git worktrees or containers for candidate execution;
- provider adapters for multiple coding models;
- OpenTelemetry traces and structured logs;
- object storage for evidence bundles;
- GitHub App integration after account authorization is available;
- AWS deployment with separate web, worker and database boundaries.

## Trust boundary

Candidate patches are untrusted input. A coding model cannot mark its own work as verified. Evidence is produced or checked by independent gates, and the final decision remains reviewable by a human.
