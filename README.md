# Archeagent

**Empirical engineering labor market and release-control plane for coding-agent teams**

Coding agents can write code. Archeagent learns who should implement, who should review, how much authority each worker has earned, what verification depth a change requires, and whether that work survived production.

Archeagent treats models and agents as an evolving engineering workforce. It combines contextual labor intelligence, independent verification, production feedback, and exact-state release authorization to make auditable engineering decisions.

## Why this exists

AI coding tools make implementation dramatically faster, but speed creates a new engineering bottleneck: verification.

A plausible patch can still:

- pass a happy path while failing on retry;
- preserve types while breaking an API contract;
- compile while weakening an authorization boundary;
- depend on a schema change that was never migrated;
- claim success without reproducible evidence.

Archeagent treats agent output as an untrusted proposal and makes release evidence first-class.

## Live demo scenario

The included demo evaluates three patches for the same production bug:

1. **FastFix** is quick, but fails persistent retry and security boundaries.
2. **SmartPatch** passes tests, but forgets the deployable database migration.
3. **VerifiedPatch** passes tests, contracts, security, migration, performance and evidence gates.

Only the third patch receives `MERGE`.

## Stack

- Next.js 16
- React 19
- TypeScript
- Zod
- Vitest
- deterministic evaluator API
- responsive production-style dashboard

Implemented prototype infrastructure:

- PostgreSQL mission, event, execution, trust, outcome, and lease persistence
- Redis Streams with consumer groups, retry, reclaim, dead-letter handling, and duplicate suppression
- fenced durable mission workers with lease renewal and stale-worker rejection
- OpenTelemetry tracing hooks
- Go Docker execution boundary with explicit isolation limits
- contextual trust routing and reviewer pairing
- Ed25519 proof-carrying release authorization
- atomic PostgreSQL replay consumption for one-time release leases
- TLA+ release-authority model with negative control

## Run locally

```bash
pnpm install
pnpm test
pnpm dev
```

Open `http://localhost:3000`.

## Verify

```bash
pnpm test
pnpm lint
pnpm build
```

## API

### `GET /api/demo`

Returns a complete deterministic demonstration evaluation.

### `POST /api/evaluate`

Accepts a repository target and candidate patch evidence, validates it with Zod, and returns ranked candidate evaluations plus the release decision.

## Engineering principle

**Evidence beats confidence. A plausible patch is not a safe patch.**

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the production design.


## Contextual engineering intelligence

Archeagent does not treat coding agents as interchangeable.

The current implementation contains a Contextual Trust Graph conditioned on repository, language, framework, task class, and risk tier. A contextual router combines outcome history with capability, profile trust, cost, and latency.

It also includes:

- counterfactual shadow tournaments;
- implementer-reviewer pairing intelligence;
- post-deployment outcome classification;
- a calibrated authority ladder from SHADOW to bounded execution;
- risk-adaptive verification escalation;
- SHA-256 evidence roots;
- Ed25519 proof-carrying release leases;
- exact base, patch, policy, evidence, environment, expiry, and replay checks.

A release lease fails closed when the code or authority context drifts.

## Execution plane

The Go executor converts a validated execution specification into direct Docker argv. Its default contract disables networking, uses a read-only root filesystem, drops Linux capabilities, sets no-new-privileges, and applies CPU, memory, PID, and timeout bounds.

Docker is the current isolation boundary. Archeagent does not claim VM-grade isolation.

## Synthetic routing benchmark

The deterministic synthetic fixture compares one static generic-agent route with contextual routing over held-out synthetic tasks.

Current checked-in receipt:

benchmarks/results/contextual-routing-synthetic-v1.json

For seed 20260927:

- static baseline success rate: 85.31 percent;
- contextual router success rate: 93.28 percent;
- delta: +7.97 percentage points;
- static average synthetic task cost: $0.6200;
- contextual average synthetic task cost: $0.5825.

This benchmark validates routing mechanics only. It is not evidence of real-model performance.

## Current verification

pnpm verify runs:

- 18 TypeScript test files;
- 47 TypeScript tests;
- ESLint;
- Next.js production build;
- Go executor tests;
- TLA+ release-authority verification with negative control;
- deterministic routing benchmark.

## Claim boundary

Archeagent is an engineering prototype. It does not currently claim production-grade multi-tenant isolation, VM-grade sandboxing, real-provider routing gains, causal incident attribution, automatic high-risk merge authority, or universal formal verification.

The next evidence stage is provider-backed evaluation on executable repository tasks with independent verification.
