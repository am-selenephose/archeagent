"use client";

import {
  Activity,
  BadgeCheck,
  Binary,
  Bot,
  Check,
  Fingerprint,
  GitBranch,
  Loader2,
  Play,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";

type IntelligenceDemo = {
  context: {
    repository: string;
    language: string;
    framework: string;
    taskClass: string;
    risk: string;
  };
  routing: {
    agent: {
      id: string;
      name: string;
      model: string;
    } | null;
    candidates: Array<{
      agentId: string;
      contextualTrust: number;
      profileTrust: number;
      costUsd: number;
      latencyMs: number;
      score: number;
    }>;
  };
  tournament: {
    primary: string;
    shadows: string[];
    reason: string;
  };
  reviewerPairing: {
    opportunities: number;
    defects: number;
    caught: number;
    falsePositives: number;
    recall: number;
    falsePositiveRate: number;
    pairingScore: number;
  };
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
    signaturePrefix: string;
    validExactState: {
      valid: boolean;
      reasons: string[];
    };
    invalidAfterHeadMove: {
      valid: boolean;
      reasons: string[];
    };
  };
};

function percentage(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function IntelligenceConsole() {
  const [data, setData] = useState<IntelligenceDemo | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    const response = await fetch("/api/intelligence/demo", {
      cache: "no-store",
    });
    setData((await response.json()) as IntelligenceDemo);
    setLoading(false);
  }

  return (
    <section className="intelligence-shell" id="intelligence">
      <div className="intelligence-header">
        <div>
          <p className="eyebrow">Labor intelligence</p>
          <h2>The best agent is contextual, not universal.</h2>
          <p>
            Archeagent routes work from observed outcomes, forms complementary
            review teams, limits authority, and binds release permission to exact
            verified state.
          </p>
        </div>
        <button className="run-button intelligence-run" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
          {loading ? "Computing team" : data ? "Re-run simulation" : "Run workforce simulation"}
        </button>
      </div>

      {!data ? (
        <div className="intelligence-idle">
          <div className="intel-orbit">
            <Bot size={26} />
          </div>
          <div>
            <strong>One authorization task. Three plausible agents.</strong>
            <p>
              Static model reputation is not enough. Run the simulation to see
              repository-specific trust change the team.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="context-ribbon">
            <span><GitBranch size={13} />{data.context.repository}</span>
            <span>{data.context.language}</span>
            <span>{data.context.framework}</span>
            <span>{data.context.taskClass}</span>
            <span className="risk-chip">{data.context.risk} risk</span>
          </div>

          <div className="intelligence-grid">
            <article className="intel-panel routing-panel">
              <div className="panel-title">
                <div className="panel-icon periwinkle"><Activity size={16} /></div>
                <div>
                  <span>Contextual router</span>
                  <strong>{data.routing.agent?.name ?? "No eligible agent"}</strong>
                </div>
              </div>

              <div className="route-table">
                <div className="route-head">
                  <span>Agent</span>
                  <span>Context trust</span>
                  <span>Profile trust</span>
                  <span>Route score</span>
                </div>
                {data.routing.candidates.map((candidate, index) => (
                  <div className={`route-row ${index === 0 ? "route-winner" : ""}`} key={candidate.agentId}>
                    <span className="route-agent">
                      {index === 0 ? <BadgeCheck size={14} /> : <Bot size={14} />}
                      {candidate.agentId}
                    </span>
                    <span>{percentage(candidate.contextualTrust)}</span>
                    <span>{percentage(candidate.profileTrust)}</span>
                    <span>{percentage(candidate.score)}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="intel-panel team-panel">
              <div className="panel-title">
                <div className="panel-icon sulfur"><Users size={16} /></div>
                <div>
                  <span>Shadow tournament</span>
                  <strong>{data.tournament.primary} leads</strong>
                </div>
              </div>

              <div className="team-stack">
                <div className="team-role">
                  <small>PRIMARY</small>
                  <strong>{data.tournament.primary}</strong>
                </div>
                {data.tournament.shadows.map((agent) => (
                  <div className="team-role shadow" key={agent}>
                    <small>SHADOW</small>
                    <strong>{agent}</strong>
                  </div>
                ))}
              </div>

              <p className="panel-note">{data.tournament.reason}</p>
            </article>

            <article className="intel-panel reviewer-panel">
              <div className="panel-title">
                <div className="panel-icon vermilion"><ShieldAlert size={16} /></div>
                <div>
                  <span>Reviewer complement</span>
                  <strong>velocity + sentry</strong>
                </div>
              </div>

              <div className="big-metric">
                <strong>{percentage(data.reviewerPairing.pairingScore)}</strong>
                <span>pairing score</span>
              </div>

              <div className="compact-stats">
                <span>{data.reviewerPairing.caught}/{data.reviewerPairing.defects} defects caught</span>
                <span>{percentage(data.reviewerPairing.falsePositiveRate)} false positives</span>
              </div>
            </article>

            <article className="intel-panel authority-panel">
              <div className="panel-title">
                <div className="panel-icon oxide"><Fingerprint size={16} /></div>
                <div>
                  <span>Earned authority</span>
                  <strong>{data.authority?.level ?? "SHADOW"}</strong>
                </div>
              </div>

              <p className="panel-note">
                {data.authority?.reasons[0] ?? "Insufficient calibrated history."}
              </p>

              <div className="no-auto-merge">
                <X size={13} />
                high-risk auto merge disabled
              </div>
            </article>
          </div>

          <div className="release-proof-grid">
            <article className="release-proof-card">
              <div className="release-proof-heading">
                <div>
                  <p className="eyebrow">Proof-carrying release</p>
                  <h3>Exact state accepted</h3>
                </div>
                <Check className="proof-pass" size={20} />
              </div>
              <div className="lease-fields">
                <span><small>BASE</small><code>{data.release.claims.baseSha}</code></span>
                <span><small>PATCH</small><code>{data.release.claims.patchSha}</code></span>
                <span><small>POLICY</small><code>{data.release.claims.policyHash}</code></span>
                <span><small>ENV</small><code>{data.release.claims.environment}</code></span>
              </div>
              <p>
                Ed25519 signature <code>{data.release.signaturePrefix}...</code>
              </p>
            </article>

            <article className="release-proof-card drift-card">
              <div className="release-proof-heading">
                <div>
                  <p className="eyebrow danger-eyebrow">Negative control</p>
                  <h3>Base HEAD moved</h3>
                </div>
                <X className="proof-fail" size={20} />
              </div>
              <div className="drift-result">
                <span>LEASE STATUS</span>
                <strong>REJECTED</strong>
              </div>
              <p>
                {data.release.invalidAfterHeadMove.reasons.join(", ") ||
                  "Exact-state verification rejected the release."}
              </p>
            </article>
          </div>

          <div className="verification-ribbon">
            <div>
              <ShieldCheck size={16} />
              <span>Verification plan</span>
            </div>
            <div className="verification-levels">
              {data.verification.levels.map((level) => (
                <span key={level}>{level}</span>
              ))}
            </div>
            <div className="human-gate">
              <Binary size={14} />
              human gate: {data.verification.humanReviewRequired ? "required" : "not required"}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
