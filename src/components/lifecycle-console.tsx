"use client";

import {
  Activity,
  BadgeCheck,
  Binary,
  Bot,
  Check,
  Fingerprint,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  Play,
  Radar,
  ShieldCheck,
  TestTube2,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { runLifecycleDemo, selectLifecycleWinner, type LifecycleState } from "../lib/lifecycle-demo";

function pct(value: number) {
  return (value * 100).toFixed(1) + "%";
}

function money(value: number) {
  const sign = value >= 0 ? "+" : "";
  return sign + "$" + value.toFixed(2);
}

export function LifecycleConsole() {
  const [{ intelligence, evaluation, loading, error }, setState] = useState<LifecycleState>({
    intelligence: null, evaluation: null, loading: false, error: null,
  });

  async function run() {
    await runLifecycleDemo(setState);
  }

  const winner = selectLifecycleWinner(evaluation);

  const routeWinner = intelligence?.routing.candidates[0] ?? null;

  const stages = intelligence && evaluation ? [
    {
      id: "01",
      icon: GitBranch,
      label: "Mission",
      title: evaluation.target,
      detail: intelligence.context.repository + " · " + intelligence.context.risk + " risk",
      state: "observed",
    },
    {
      id: "02",
      icon: Users,
      label: "Team formation",
      title: intelligence.routing.candidates.length + " eligible workers scored",
      detail: "Learned contextual success and explicit risk economics, not a global leaderboard.",
      state: "observed",
    },
    {
      id: "03",
      icon: Bot,
      label: "Implementer",
      title: intelligence.routing.agent?.name ?? "No eligible worker",
      detail: routeWinner
        ? pct(routeWinner.conservativeSuccessProbability) +
          " conservative success · utility " +
          money(routeWinner.expectedUtility)
        : "No route available",
      state: routeWinner ? "pass" : "fail",
    },
    {
      id: "04",
      icon: Activity,
      label: "Shadow tournament",
      title: intelligence.tournament.primary + " primary",
      detail:
        intelligence.tournament.shadows.length > 0
          ? "Counterfactual shadows: " + intelligence.tournament.shadows.join(", ")
          : intelligence.tournament.reason,
      state: "observed",
    },
    {
      id: "05",
      icon: ShieldCheck,
      label: "Reviewer complement",
      title: intelligence.reviewerPairing
        ? intelligence.reviewerPairing.reviewerId
        : "No reviewer evidence",
      detail: intelligence.reviewerPairing
        ? pct(intelligence.reviewerPairing.catchProbability) +
          " learned defect-catch probability · " +
          intelligence.reviewerPairing.source +
          " evidence"
        : "No reviewer pair selected",
      state: intelligence.reviewerPairing ? "pass" : "warn",
    },
    {
      id: "06",
      icon: TestTube2,
      label: "Fixture evaluation",
      title: evaluation.evaluations.length + " example patches scored",
      detail: winner
        ? winner.candidate.agent + " has the highest score from the supplied fixture signals."
        : "No fixture candidate passed the example policy.",
      state: winner ? "pass" : "fail",
    },
    {
      id: "07",
      icon: BadgeCheck,
      label: "Evidence",
      title: winner ? winner.score + "/100 evidence score" : "No winning evidence bundle",
      detail: winner
        ? winner.gates.filter((gate) => gate.status === "pass").length +
          "/" +
          winner.gates.length +
          " fixture gates passed"
        : evaluation.policy.principle,
      state: winner ? "pass" : "fail",
    },
    {
      id: "08",
      icon: Binary,
      label: "Policy + formal gates",
      title: intelligence.verification.levels.join(" → "),
      detail:
        "Human gate " +
        (intelligence.verification.humanReviewRequired ? "required" : "not required") +
        " · authority " +
        (intelligence.authority?.level ?? "SHADOW"),
      state: "pass",
    },
    {
      id: "09",
      icon: Fingerprint,
      label: "Fixture release lease",
      title: intelligence.release.validExactState.valid
        ? "Example lease validated"
        : "Example lease rejected",
      detail:
        intelligence.release.claims.baseSha +
        " → " +
        intelligence.release.claims.patchSha,
      state: intelligence.release.validExactState.valid ? "pass" : "fail",
    },
    {
      id: "10",
      icon: GitCommitHorizontal,
      label: "Deployment example",
      title: intelligence.release.claims.environment,
      detail:
        "Illustrates an environment-bound lease; this demo does not deploy code.",
      state: "observed",
    },
    {
      id: "11",
      icon: Radar,
      label: "Fixture attribution",
      title: pct(intelligence.productionAttribution.confidence) + " evidence-derived confidence",
      detail:
        intelligence.productionAttribution.supportingSignals.slice(0, 2).join(" · ") ||
        "Insufficient independent attribution evidence",
      state:
        intelligence.productionAttribution.confidence >= 0.65 ? "pass" : "warn",
    },
    {
      id: "12",
      icon: Activity,
      label: "Fixture trust update",
      title: intelligence.productionOutcome?.outcome ?? "No trust mutation",
      detail:
        intelligence.productionOutcome?.reason ??
        "Production evidence did not meet the attribution threshold.",
      state: intelligence.productionOutcome ? "pass" : "warn",
    },
  ] : [];

  return (
    <section className="lifecycle-shell" id="console" aria-busy={loading}>
      <div className="lifecycle-header">
        <div>
          <p className="eyebrow">Fixture demo · engineering labor loop</p>
          <h2>One mission. One evidence chain. One learned workforce.</h2>
          <p>
            Deterministic example data illustrates team formation, verification,
            release fencing and production attribution.
          </p>
        </div>
        <button type="button" className="run-button" onClick={run} disabled={loading} aria-busy={loading}>
          {loading ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
          {loading ? "Loading fixture demo" : error ? "Retry fixture demo" : intelligence ? "Run fixture again" : "Run fixture demo"}
        </button>
      </div>

      <p className="lifecycle-disclosure">
        No live Concord session, model or provider execution, deployment, or release authorization
        occurs here. All stage results are fixture-driven examples.
      </p>

      {error && (
        <div className="lifecycle-error" role="alert">
          <strong>Fixture demo unavailable</strong>
          <p>{error}</p>
        </div>
      )}

      {!intelligence || !evaluation ? (
        <div className="lifecycle-idle">
          <div className="lifecycle-orbit"><Radar size={26} /></div>
          <div>
            <strong>{loading ? "Loading example lifecycle data…" : "Explore the fixture from mission to outcome."}</strong>
            <p>
              Example signals show routing probability, reviewer complementarity,
              policy gates, release fencing and production attribution in one chain.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="lifecycle-context">
            <span><GitBranch size={13} />{intelligence.context.repository}</span>
            <span>{intelligence.context.language}</span>
            <span>{intelligence.context.framework}</span>
            <span>{intelligence.context.taskClass}</span>
            <span>{intelligence.context.risk} risk</span>
          </div>

          <div className="lifecycle-grid">
            {stages.map(({ id, icon: Icon, label, title, detail, state }) => (
              <article className={"lifecycle-stage lifecycle-" + state} key={id}>
                <div className="lifecycle-stage-top">
                  <span className="lifecycle-index">{id}</span>
                  <Icon size={16} />
                  <small>{label}</small>
                  <span className="lifecycle-state">
                    {state === "pass" ? <Check size={13} /> : state === "fail" ? <X size={13} /> : null}
                    {state}
                  </span>
                </div>
                <strong>{title}</strong>
                <p>{detail}</p>
              </article>
            ))}
          </div>

          <div className="lifecycle-proof-strip">
            <div>
              <small>FIXTURE POLICY RESULT</small>
              <strong>{evaluation.decision}</strong>
            </div>
            <div>
              <small>ROUTED WORKER</small>
              <strong>{intelligence.routing.agent?.id ?? "none"}</strong>
            </div>
            <div>
              <small>REVIEW COMPLEMENT</small>
              <strong>{intelligence.reviewerPairing?.reviewerId ?? "none"}</strong>
            </div>
            <div>
              <small>HEAD-DRIFT NEGATIVE CONTROL</small>
              <strong>
                {intelligence.release.invalidAfterHeadMove.valid ? "MISSED" : "CAUGHT"}
              </strong>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
