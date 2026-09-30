# Archeagent Research Positioning

Archeagent does not claim that multi-agent orchestration, sandboxing, code review, budgets, audit trails, or Bayesian reputation are novel by themselves.

The research hypothesis is the closed-loop combination of labor allocation, complementary review, bounded authority, release-state fencing, and production survival feedback.

## Hypothesis

A coding-agent organization should perform better when it learns a contextual labor market instead of routing every task to one globally strongest model.

The unit of intelligence is therefore not:

~~~text
best model
~~~

It is:

~~~text
best implementer for this context
+ best reviewer for this implementer's blind spots
+ verification depth justified by risk
+ authority earned from calibrated history
+ production evidence that changes the next decision
~~~

## Implemented research mechanisms

1. contextual agent reliability conditioned on repository, language, framework, task class and risk;
2. conservative Bayesian success estimates;
3. expected-utility routing instead of unexplained fixed route weights;
4. counterfactual shadow evaluation to reduce selection bias;
5. contextual implementer-reviewer complementarity;
6. evidence-derived post-deployment attribution;
7. calibrated authority promotion;
8. risk-adaptive verification;
9. signed proof-carrying release leases;
10. exact-base, exact-patch, exact-policy, exact-evidence and exact-environment fencing;
11. atomic replay consumption;
12. explicit worker-cost, failure-cost and latency economics;
13. a provider-agnostic executable benchmark harness with hidden evaluators and an append-only living ledger.

## What is already evidence

The repository has engineering evidence for its internal mechanisms:

- unit and integration tests for trust, routing, complementarity, durable missions, Redis recovery, release fencing and production feedback;
- PostgreSQL and Redis integration paths;
- a TLA+ safe model plus a deliberately broken negative control;
- a deterministic synthetic routing benchmark;
- an executable provider benchmark harness whose parser, sampling and hidden-evaluator separation are tested.

These prove implementation properties. They do not prove superiority over commercial coding models.

## Provider-backed experiment

The provider-backed study should compare at least:

- one strongest-model static route;
- a cheapest-model route;
- random routing;
- task-class-only routing;
- Archeagent contextual routing;
- Archeagent contextual routing plus reviewer complementarity.

A useful first publication target is a balanced corpus across multiple repositories and task classes rather than repeated tasks from one codebase.

Required metrics include:

- independently verified task success;
- hidden-test pass rate;
- escaped defects;
- security regressions;
- rollback and hotfix rate;
- worker cost;
- latency;
- human reviewer minutes;
- calibration error;
- cumulative routing regret.

## Falsification criteria

The hypothesis is weakened if, on held-out repositories or task classes:

- contextual routing does not outperform strong static baselines after accounting for cost;
- complementarity-aware reviewer selection does not reduce escaped defects or reviewer effort;
- contextual trust fails to calibrate out of sample;
- production feedback adds noise rather than improving subsequent decisions;
- performance gains disappear when evaluator leakage is removed.

Archeagent should publish those failures rather than hide them.

## Claim boundary

Until real provider agents are run on pinned executable tasks with independent evaluators, the correct claim is:

> Archeagent implements and verifies an empirical engineering labor-control architecture.

The incorrect claim would be:

> Archeagent has already proven it routes GPT, Claude, Gemini, Codex, or local models better in real software development.

The provider harness exists specifically to convert that second sentence from marketing into a testable result.
