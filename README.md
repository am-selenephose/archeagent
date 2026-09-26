# ShipProof

**AI-native production engineering control plane**

Agents can write code. ShipProof decides if it is safe to ship.

ShipProof compares competing AI-generated patches against deterministic release gates and produces an auditable decision: `MERGE`, `NEEDS_WORK` or `REJECT`.

## Why this exists

AI coding tools make implementation dramatically faster, but speed creates a new engineering bottleneck: verification.

A plausible patch can still:

- pass a happy path while failing on retry;
- preserve types while breaking an API contract;
- compile while weakening an authorization boundary;
- depend on a schema change that was never migrated;
- claim success without reproducible evidence.

ShipProof treats agent output as an untrusted proposal and makes release evidence first-class.

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

Planned production adapters:

- PostgreSQL
- Redis / BullMQ
- isolated Git worktrees
- OpenTelemetry
- AWS
- multi-provider coding agents

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
