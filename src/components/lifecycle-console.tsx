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
import type { EvaluationRun } from "@/lib/evaluator";

type IntelligenceDemo = {
  context: {
    repository: string;
    language: string;
    framework: string;
    taskClass: string;
    risk: string;
  };
  routing: {
    agent: { id: string; name: string; model: string } | null;
    candidates: Array<{
      agentId: string;
      successProbability: number;
      conservativeSuccessProbability: number;
      expectedUtility: number;
      costUsd: number;
      latencyMs: number;
    }>;
  };
  tournament: {
    primary: string;
    shadows: string[];
    reason: string;
  };
  reviewerPairing: {
    reviewerId: string;
    source: string;
    catchProbability: number;
    conservativeCatchProbability: number;
    complementarityScore: number;
  } | null;
  reviewerCandidates: Array<{
    reviewerId: string;
    catchProbability: number;
    complementarityScore: number;
  }>;
  authority: {
    level: string;
    reasons: string[];
    autoMergeAllowed: false;
  } | null;
  verification: {
    levels: string[];
    humanReviewRequired: boolean;
    maxReviewerMinutes: number;
    rationale: string[];
  };
  release: {
    claims: {
      baseSha: string;
      patchSha: string;
      policyHash: string;
      environment: string;
      leaseId: string;
    };
    validExactState: { valid: boolean; reasons: string[] };
    invalidAfterHeadMove: { valid: boolean; reasons: string[] };
  };
  productionAttribution: {
    confidence: number;
    supportingSignals: string[];
    contradictingSignals: string[];
  };
  productionOutcome: {
    outcome: string;
    weight: number;
    reason: string;
  } | null;
};

function pct(value: number) {
  return (value * 100).toFixed(1) + "%";
}

function money(value: number) {
  const sign = value >= 0 ? "+" : "";
  return sign + "$" + value.toFixed(2);
}

export function LifecycleConsole() {
  const [intelligence, setIntelligence] = useState<IntelligenceDemo | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationRun | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setIntelligence(null);
    setEvaluation(null);

    const [intelResponse, evaluationResponse] = await Promise.all([
      fetch("/api/intelligence/demo", { cache: "no-store" }),
      fetch("/api/demo", { cache: "no-store" }),
    ]);

    const [intel, evaluated] = await Promise.all([
      intelResponse.json() as Promise<IntelligenceDemo>,
      evaluationResponse.json() as Promise<EvaluationRun>,
    ]);

    setIntelligence(intel);
    setEvaluation(evaluated);
    setLoading(false);
  }

  const winner =
    evaluation?.evaluations.find((item) => item.candidate.id === evaluation.winnerId) ??
    evaluation?.evaluations[0] ??
    null;

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
      label: "Independent execution",
      title: evaluation.evaluations.length + " candidate patches evaluated",
      detail: winner
        ? winner.candidate.agent + " produced the strongest independently verified state."
        : "No candidate survived evaluation.",
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
          " release gates passed"
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
      label: "Signed release lease",
      title: intelligence.release.validExactState.valid
        ? "Exact state authorized"
        : "Lease rejected",
      detail:
        intelligence.release.claims.baseSha +
        " → " +
        intelligence.release.claims.patchSha,
      state: intelligence.release.validExactState.valid ? "pass" : "fail",
    },
    {
      id: "10",
      icon: GitCommitHorizontal,
      label: "Deployment",
      title: intelligence.release.claims.environment,
      detail:
        "Authority is bound to exact base, patch, policy, evidence root, environment and lease identity.",
      state: "observed",
    },
    {
      id: "11",
      icon: Radar,
      label: "Production attribution",
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
      label: "Trust graph update",
      title: intelligence.productionOutcome?.outcome ?? "No trust mutation",
      detail:
        intelligence.productionOutcome?.reason ??
        "Production evidence did not meet the attribution threshold.",
      state: intelligence.productionOutcome ? "pass" : "warn",
    },
  ] : [];

  return (
    <section className="lifecycle-shell" id="console">
      <div className="lifecycle-header">
        <div>
          <p className="eyebrow">End-to-end engineering labor loop</p>
          <h2>One mission. One evidence chain. One learned workforce.</h2>
          <p>
            Archeagent now tells one continuous story from team formation through
            production survival and the next trust update.
          </p>
        </div>
        <button className="run-button" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
          {loading ? "Running lifecycle" : intelligence ? "Run again" : "Run full lifecycle"}
        </button>
      </div>

      {!intelligence || !evaluation ? (
        <div className="lifecycle-idle">
          <div className="lifecycle-orbit"><Radar size={26} /></div>
          <div>
            <strong>From mission assignment to production outcome.</strong>
            <p>
              The run exposes routing probability, reviewer complementarity,
              independent gates, release fencing and production attribution in one chain.
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
              <small>RELEASE DECISION</small>
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
