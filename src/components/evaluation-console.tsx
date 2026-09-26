"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CircleDollarSign,
  Clock3,
  Code2,
  GitBranch,
  Loader2,
  LockKeyhole,
  Play,
  ShieldCheck,
  Sparkles,
  TestTube2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { CandidateEvaluation, EvaluationRun, GateStatus } from "@/lib/evaluator";

const gateIcon: Record<string, typeof Check> = {
  tests: TestTube2,
  contract: Code2,
  security: LockKeyhole,
  migration: GitBranch,
  performance: Activity,
  evidence: ShieldCheck,
};

function statusIcon(status: GateStatus) {
  if (status === "pass") return Check;
  if (status === "warn") return AlertTriangle;
  return X;
}

function verdictClass(verdict: CandidateEvaluation["verdict"]) {
  if (verdict === "MERGE") return "verdict verdict-merge";
  if (verdict === "NEEDS_WORK") return "verdict verdict-work";
  return "verdict verdict-reject";
}

export function EvaluationConsole() {
  const [run, setRun] = useState<EvaluationRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  async function runEvaluation() {
    setLoading(true);
    setRun(null);
    setActiveId(null);

    const response = await fetch("/api/demo", { cache: "no-store" });
    const nextRun = (await response.json()) as EvaluationRun;

    await new Promise((resolve) => setTimeout(resolve, 650));
    setRun(nextRun);
    setActiveId(nextRun.winnerId ?? nextRun.evaluations[0]?.candidate.id ?? null);
    setLoading(false);
  }

  const active = useMemo(
    () => run?.evaluations.find((item) => item.candidate.id === activeId) ?? null,
    [run, activeId],
  );

  return (
    <section className="console-shell" id="console">
      <div className="console-topbar">
        <div>
          <p className="eyebrow">Live decision run</p>
          <h2>Three patches enter. Evidence decides.</h2>
        </div>
        <button className="run-button" onClick={runEvaluation} disabled={loading}>
          {loading ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
          {loading ? "Running gates" : run ? "Run again" : "Run evaluation"}
        </button>
      </div>

      <div className="target-card">
        <div className="target-line">
          <GitBranch size={16} />
          <span>acme/billing-api</span>
          <ArrowRight size={15} />
          <strong>Prevent duplicate settlement credits during retry</strong>
        </div>
        <div className="policy-chip">
          <ShieldCheck size={15} />
          Merge threshold 85
        </div>
      </div>

      {!run && !loading ? (
        <div className="empty-state">
          <div className="empty-orbit"><Sparkles size={27} /></div>
          <h3>Ready to judge competing patches</h3>
          <p>
            The demo includes a fast but unsafe patch, a plausible incomplete
            patch, and a fully verified patch.
          </p>
        </div>
      ) : null}

      {loading ? (
        <div className="run-progress">
          <div className="progress-row"><span>Regression suite</span><span>running</span></div>
          <div className="progress-track"><i style={{ width: "88%" }} /></div>
          <div className="progress-grid">
            {["API contract", "Security boundary", "Schema migration", "Performance", "Evidence"].map(
              (label, index) => (
                <div className="progress-cell" key={label}>
                  <span className={index < 3 ? "pulse-dot active" : "pulse-dot"} />
                  {label}
                </div>
              ),
            )}
          </div>
        </div>
      ) : null}

      {run ? (
        <>
          <div className="decision-banner">
            <div><span className="decision-label">Release decision</span><strong>{run.decision}</strong></div>
            <p>{run.policy.principle}</p>
          </div>

          <div className="candidate-grid">
            {run.evaluations.map((evaluation) => {
              const candidate = evaluation.candidate;
              const selected = candidate.id === activeId;
              return (
                <button
                  type="button"
                  className={`candidate-card ${selected ? "selected" : ""}`}
                  key={candidate.id}
                  onClick={() => setActiveId(candidate.id)}
                >
                  <div className="candidate-heading">
                    <div>
                      <span className="agent-label">{candidate.agent}</span>
                      <span className="model-label">{candidate.model}</span>
                    </div>
                    <span className={verdictClass(evaluation.verdict)}>{evaluation.verdict}</span>
                  </div>

                  <div className="score-row">
                    <strong>{evaluation.score}</strong>
                    <span>/ 100 evidence score</span>
                  </div>

                  <p>{candidate.summary}</p>

                  <div className="mini-metrics">
                    <span><Clock3 size={13} /> {(candidate.latencyMs / 1000).toFixed(1)}s</span>
                    <span><CircleDollarSign size={13} /> ${candidate.costUsd.toFixed(2)}</span>
                    <span><Code2 size={13} /> +{candidate.additions} / -{candidate.deletions}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {active ? (
            <div className="detail-panel">
              <div className="detail-copy">
                <div className="detail-heading">
                  <div><p className="eyebrow">Selected candidate</p><h3>{active.candidate.agent}</h3></div>
                  <span className={verdictClass(active.verdict)}>{active.verdict}</span>
                </div>
                <p className="detail-summary">{active.candidate.summary}</p>
                <code className="branch-chip">{active.candidate.branch}</code>

                <div className="reason-box">
                  <span>Decision rationale</span>
                  {active.reasons.map((reason) => <p key={reason}>{reason}</p>)}
                </div>
              </div>

              <div className="gate-list">
                {active.gates.map((gate) => {
                  const GateIcon = gateIcon[gate.key] ?? ShieldCheck;
                  const StatusIcon = statusIcon(gate.status);
                  return (
                    <div className="gate-row" key={gate.key}>
                      <div className="gate-icon"><GateIcon size={16} /></div>
                      <div className="gate-main">
                        <div className="gate-title"><strong>{gate.label}</strong><span>{gate.earned}/{gate.weight}</span></div>
                        <p>{gate.note}</p>
                      </div>
                      <StatusIcon className={`status-icon ${gate.status}`} size={17} />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
