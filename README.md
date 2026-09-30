# Archeagent

**Empirical engineering labor market and release-control plane for coding-agent teams**

Coding agents can write code. Archeagent learns who should implement, who should review, how much authority each worker has earned, what verification depth a change requires, and whether that work survived production.

Archeagent treats models and agents as an evolving engineering workforce. It combines contextual labor intelligence, independent verification, production feedback, and exact-state release authorization to make auditable engineering decisions.

## Why this exists

AI coding tools make implementation dramatically faster, but speed creates a new engineering bottleneck: verification and labor allocation.

A plausible patch can still:

- pass a happy path while failing on retry;
- preserve types while breaking an API contract;
- compile while weakening an authorization boundary;
- depend on a schema change that was never migrated;
- come from the wrong worker for this repository and failure class;
- claim success without reproducible evidence.

Archeagent treats agent output as an untrusted proposal. It measures workers from observed outcomes, composes teams from contextual evidence, and makes release evidence first-class.

## Product loop

The demo is one continuous engineering lifecycle:

1. mission context enters the system;
2. eligible workers are scored by learned contextual success probability and explicit expected utility;
3. a primary implementer and counterfactual shadow workers are selected;
4. reviewer complementarity is estimated against the implementer's observed blind spots;
5. candidate patches are independently evaluated;
6. evidence, policy and verification-depth gates are applied;
7. an Ed25519 release lease binds authorization to the exact code and evidence state;
8. deployment evidence is used to derive attribution confidence;
9. sufficiently attributed production outcomes update contextual trust for future routing.

The core idea is not "more agents". It is an empirical labor market whose routing policy changes when workers prove or disprove themselves.

## Stack

- Next.js 16
- React 19
- TypeScript
- Zod
- Vitest
- PostgreSQL
- Redis Streams
- OpenTelemetry
- Go execution boundary
- TLA+ release-authority model

Implemented prototype infrastructure:

- PostgreSQL mission, event, execution, trust, production-outcome, and lease persistence
- Redis Streams with consumer groups, retry, reclaim, dead-letter handling, and duplicate suppression
- fenced durable mission workers with lease renewal and stale-worker rejection
- contextual Bayesian trust graph conditioned on repository, language, framework, task class, and risk
- learned success-probability routing with explicit expected-utility economics
- contextual implementer-reviewer complementarity learning
- counterfactual shadow tournaments
- evidence-derived post-deployment attribution
- calibrated authority ladder and risk-adaptive verification escalation
- SHA-256 evidence Merkle roots
- Ed25519 proof-carrying release authorization
- atomic PostgreSQL replay consumption for one-time release leases
- TLA+ release-authority model with a deliberately unsafe negative control
- provider-backed benchmark harness with hidden evaluators and an append-only living results ledger
- Go Docker execution boundary with explicit isolation limits
- OpenTelemetry tracing hooks

## Run locally

~~~bash
pnpm install
pnpm dev
~~~

Open http://localhost:3000.

For the full integration suite, provide isolated PostgreSQL and Redis endpoints:

~~~bash
export ARCHEAGENT_TEST_DATABASE_URL='postgres://archeagent:archeagent@127.0.0.1:5432/archeagent'
export ARCHEAGENT_TEST_REDIS_URL='redis://127.0.0.1:6379/15'
pnpm verify
~~~

The checked-in Docker Compose file can provision the integration services.

## API

### GET /api/intelligence/demo

Returns the end-to-end labor-intelligence demonstration: routing, shadow assignment, reviewer complementarity, authority, verification plan, release lease, and production attribution.

### GET /api/demo

Returns the independent deterministic candidate-patch evaluation used inside the lifecycle demo.

### POST /api/evaluate

Accepts a repository target and candidate patch evidence, validates it with Zod, and returns ranked candidate evaluations plus the release decision.

## Engineering principle

**Do not trust the model. Trust the measured worker, the evidence, and the exact release state.**

## Empirical labor intelligence

Archeagent does not use one global "best model" score.

For each eligible worker it estimates contextual success from outcome history. The context includes repository, language, framework, task class, and risk. Profile trust is only a cold-start prior when contextual evidence does not yet exist.

Routing then optimizes explicit expected utility:

~~~text
expected success value
- expected failure cost
- worker cost
- latency cost
~~~

Risk changes the economics. A cheap worker with weak production survival can therefore lose a critical task to a more expensive worker without relying on unexplained fixed route weights.

Reviewer selection follows the same empirical principle. Archeagent estimates:

~~~text
P(reviewer catches defect | implementer, failure class, repository context)
~~~

The goal is not to pick the globally highest-rated reviewer. It is to cover this implementer's likely blind spots for this change.

## Production attribution

Production feedback only updates trust when independently observed evidence crosses an attribution threshold.

Current signals include:

- deployed patch SHA alignment;
- rollback-to-patch alignment;
- changed-file and incident-file overlap;
- whether the failure signal appeared after deployment;
- whether rollback removed the signal;
- canary reproduction;
- feature-flag cohort alignment;
- runtime trace correlation;
- subsystem ownership alignment.

Caller-supplied confidence is retained only for wire compatibility and is not an authority input.

This is evidence-derived attribution, not a claim of perfect causal inference.

## Proof-carrying release authority

A release lease binds authorization to repository, base SHA, patch SHA, policy hash, evidence Merkle root, environment, expiry, nonce, and lease identity.

Base movement, patch mutation, policy drift, evidence drift, expiry, or replay invalidates authorization. Replay consumption is atomic in PostgreSQL so concurrent consumers cannot both spend the same lease.

## Execution plane

The Go executor converts a validated execution specification into direct Docker argv. Its default contract disables networking, uses a read-only root filesystem, drops Linux capabilities, sets no-new-privileges, and applies CPU, memory, PID, and timeout bounds.

Docker is the current isolation boundary. Archeagent does not claim VM-grade isolation.

## Synthetic routing benchmark

The checked-in deterministic benchmark validates contextual-routing mechanics over held-out synthetic tasks.

Receipt: benchmarks/results/contextual-routing-synthetic-v1.json

For seed 20260927:

- static baseline success rate: 85.31 percent;
- contextual router success rate: 93.28 percent;
- delta: +7.97 percentage points;
- static average synthetic task cost: $0.6200;
- contextual average synthetic task cost: $0.5825.

This benchmark is not evidence of real-model performance.

## Provider-backed benchmark harness

benchmarks/provider/ contains the executable real-agent harness.

A task pins a real repository and base commit. The coding agent receives the issue prompt but not the hidden evaluator commands. Archeagent captures the produced Git diff, runs independent evaluator commands afterward, hashes the patch, and appends the result to a JSONL living ledger.

Example:

~~~bash
node benchmarks/provider/run.mjs \
  --dataset=/secure/path/tasks.jsonl \
  --agents=/secure/path/agents.json \
  --count=100 \
  --ledger=benchmarks/provider/results/living-benchmark.jsonl
~~~

The harness is implemented and locally validated. No real-provider performance claim is made until actual provider agents are run against an executable task corpus.

See benchmarks/provider/README.md for the data contract.

## Current verification

The repository contains:

- 22 TypeScript test files;
- 54 TypeScript tests;
- PostgreSQL and Redis integration coverage for durable missions, replay/fencing, stream recovery, and production feedback;
- ESLint;
- Next.js production build;
- Go executor tests;
- TLA+ release-authority verification with negative control;
- provider-benchmark harness validation;
- deterministic synthetic routing benchmark.

Run the complete gate with:

~~~bash
pnpm verify
~~~

## Claim boundary

Archeagent is a research-engineering prototype.

It does not currently claim:

- production-grade multi-tenant isolation;
- VM-grade sandboxing;
- measured routing gains across real commercial providers;
- perfect causal incident attribution;
- automatic high-risk merge authority;
- universal formal verification.

The next empirical stage is to run the provider harness across pinned executable repository tasks and publish reproducible provider-backed receipts rather than model self-reports.

See docs/ARCHITECTURE.md and docs/RESEARCH_POSITIONING.md.
