# Archeagent Architecture

Archeagent is an AI-native production engineering control plane.

The core rule is simple:

> Model output is a proposal, not a release decision.

## Control flow

1. A repository and acceptance target enter Archeagent.
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
- Redis Streams for durable mission queues with consumer groups, retry, reclaim, and dead-letter handling;
- isolated Git worktrees or containers for candidate execution;
- provider adapters for multiple coding models;
- OpenTelemetry traces and structured logs;
- object storage for evidence bundles;
- GitHub App integration after account authorization is available;
- AWS deployment with separate web, worker and database boundaries.

## Trust boundary

Candidate patches are untrusted input. A coding model cannot mark its own work as verified. Evidence is produced or checked by independent gates, and the final decision remains reviewable by a human.


## Outcome-grounded control loop

The differentiating loop is:

task context -> contextual team formation -> isolated execution -> independent verification -> proof-carrying release authority -> post-deployment outcome -> contextual trust update.

Trust and authority remain separate.

Contextual trust is conditioned by repository, language, framework, task class, and risk tier. Production regressions, rollbacks, and security incidents reduce trust more strongly than local evaluation wins increase it.

The authority ladder is SHADOW, PROPOSE, EXECUTE_LOW_RISK, and EXECUTE_MEDIUM_RISK. No current level grants automatic high-risk merge authority.

## Proof-carrying release authority

The current Ed25519 lease binds one authorization to repository, base SHA, patch SHA, policy hash, evidence Merkle root, environment, expiry, nonce, and lease identity.

Base movement, patch mutation, policy drift, evidence drift, expiry, or replay invalidates the authorization.

## Go executor boundary

The Go service owns the bounded runtime boundary. It does not invoke untrusted commands through a host shell. Docker arguments are passed directly and fail-closed defaults include network-off, read-only rootfs, capability drop, no-new-privileges, PID bounds, CPU and memory quotas, and timeout.

Docker is not represented as VM-grade isolation.
