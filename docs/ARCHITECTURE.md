# Archeagent Architecture

Archeagent is an empirical engineering labor market and release-control plane for coding-agent teams.

The core rule is simple:

> Model output is a proposal, not a release decision.

## Closed-loop control flow

1. A mission enters with repository, language, framework, task class, capabilities, risk and budget.
2. The registry filters workers that can execute within capability and budget constraints.
3. Contextual outcome history estimates each worker's success probability. Profile trust is only the cold-start prior.
4. Expected utility combines success value, failure cost, worker price and latency cost. Risk changes those economics.
5. Counterfactual shadow workers preserve comparison evidence instead of only observing the selected worker.
6. A reviewer is selected for complementarity with the implementer's observed blind spots.
7. Candidate work executes inside a bounded runtime and produces an evidence graph.
8. Independent release gates evaluate tests, contracts, security, migration, performance and evidence quality.
9. Risk-adaptive verification determines additional human or formal checks.
10. A signed release lease authorizes one exact repository/base/patch/policy/evidence/environment state.
11. Deployment evidence is observed independently from the model that wrote the patch.
12. Attribution confidence is derived from evidence. Sufficiently attributed production outcomes update contextual trust.
13. Future routing and reviewer selection change from that history.

This is the empirical labor loop.

## Contextual trust

Trust is conditioned on repository, language, framework, task class and risk tier.

A Bayesian posterior records evidence mass, mean reliability and a conservative score. Fallback can move from exact context to broader priors, but the router does not pretend sparse evidence is certainty.

Trust and authority are separate. High observed success does not by itself grant release power.

## Learned routing

The router does not use a fixed weighted formula such as "50 percent contextual trust plus 25 percent profile trust".

For each eligible agent it estimates contextual success probability and evaluates:

~~~text
expectedUtility =
    conservativeSuccessProbability * successValue
  - (1 - conservativeSuccessProbability) * failureCost
  - taskPrice
  - latencyCost
~~~

Risk determines success value, failure cost and latency sensitivity. This makes route selection economically explicit and inspectable.

## Reviewer complementarity

Reviewer intelligence is keyed by implementer, reviewer, failure class and optional exact task context.

The learned quantity is approximately:

~~~text
P(reviewer catches defect | implementer, failure class, context)
~~~

False-positive history is also penalized. The selected reviewer is the worker with the strongest evidence for covering the current implementer's blind spot, not simply the reviewer with the highest global score.

## Counterfactual shadows

Selection creates observation bias: the system gets rich outcome data for chosen workers and little data for ignored workers.

Shadow tournaments preserve bounded exploration. Non-primary workers can be evaluated counterfactually so the trust graph can discover that the current route is wrong rather than permanently reinforcing its first choice.

## Independent evaluation

Critical release gates include:

- regression tests;
- API and schema contracts;
- authorization and security boundaries;
- database migrations;
- performance budget;
- evidence quality and reproducibility.

Critical failures cannot be outweighed by a high aggregate score.

## Durable execution plane

Implemented infrastructure includes:

- PostgreSQL mission, event, execution, contextual-trust, production-outcome and release-consumption persistence;
- Redis Streams consumer groups;
- duplicate suppression and mission identity contracts;
- retry, reclaim and dead-letter handling;
- worker leases and fencing;
- lease renewal and stale-worker rejection;
- atomic one-time release-lease consumption;
- OpenTelemetry tracing hooks.

The Go executor owns the bounded runtime boundary. It passes Docker arguments directly rather than interpolating untrusted commands through a host shell. Defaults include network-off, read-only rootfs, Linux capability drop, no-new-privileges, PID limits, CPU/memory quotas and timeout.

Docker is not represented as VM-grade isolation.

## Evidence-derived production attribution

A production observation cannot update trust from a caller-provided confidence scalar.

Archeagent currently derives confidence from:

- deployed patch SHA match;
- rollback-to-patch match;
- overlap between changed and incident files;
- signal introduction after deployment;
- rollback resolution;
- canary reproduction;
- feature-flag cohort alignment;
- trace correlation;
- code-ownership alignment.

Contradictory evidence reduces confidence. Below the threshold, the observation produces no trust mutation.

This mechanism is disciplined attribution, not a claim of perfect causality.

## Authority ladder

Current authority levels are:

- SHADOW
- PROPOSE
- EXECUTE_LOW_RISK
- EXECUTE_MEDIUM_RISK

Promotion requires calibration and conservative contextual evidence. No current level grants automatic high-risk merge authority.

## Proof-carrying release authority

The Ed25519 lease binds one authorization to repository, base SHA, patch SHA, policy hash, evidence Merkle root, environment, expiry, nonce and lease identity.

Base movement, patch mutation, policy drift, evidence drift, expiry or replay invalidates authorization.

Replay consumption is an atomic insert-if-unused operation in PostgreSQL.

## Formal release invariant

The TLA+ model checks release-authority invariants over state transitions. A separate unsafe configuration deliberately removes exact-base fencing and must produce a counterexample.

That negative control matters: a formal method is only useful here if the verifier can demonstrate that the broken policy is actually detected.

## Benchmark plane

Archeagent has two benchmark classes.

### Synthetic routing benchmark

A deterministic fixture checks routing mechanics and keeps a reproducible checked-in receipt. It is intentionally not presented as evidence of real-provider superiority.

### Provider-backed benchmark harness

The provider harness:

1. pins a repository and base commit;
2. gives only the issue prompt to the coding agent;
3. keeps hidden evaluator commands outside the agent prompt;
4. records the resulting Git diff;
5. executes hidden evaluators independently;
6. hashes the patch and evaluator command identities;
7. appends run receipts to a JSONL living ledger.

The harness accepts any coding agent exposed as an argv-based command, including commercial CLIs and local agents.

Actual provider performance claims require executing this harness on a pinned task corpus.

## Human boundary

Archeagent can earn bounded execution authority, but high-risk release decisions remain reviewable. The system is designed to make authority auditable and revocable rather than to turn model confidence into permission.
