"use client";

import { BadgeCheck, Check, GitBranch, ShieldAlert, X } from "lucide-react";
import type { EvaluationRun, GateKey } from "../lib/evaluator";
import { selectLifecycleWinner } from "../lib/lifecycle-demo";
import { formatOperationalNumber as number } from "../lib/ui-format";

type Props = {
  evaluation: EvaluationRun;
  selectedCandidateId: string | null;
  onSelectCandidate: (id: string) => void;
};

function verdictClass(verdict: EvaluationRun["decision"]) {
  return verdict === "MERGE" ? "verdict-merge" : verdict === "REJECT" ? "verdict-reject" : "verdict-work";
}

export function EvaluationWorkspace({ evaluation, selectedCandidateId, onSelectCandidate }: Props) {
  const winner = selectLifecycleWinner(evaluation);
  const selected = evaluation.evaluations.find((item) => item.candidate.id === selectedCandidateId)
    ?? winner ?? evaluation.evaluations[0] ?? null;

  return (
    <div className="evaluation-workspace">
      {selected && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Inspecting {selected.candidate.agent}. Reported verdict: {selected.verdict}.</p>}
      <div className="evaluation-run-summary">
        <div>
          <span className="workbench-label">Fixture policy result</span>
          <strong className={"verdict " + verdictClass(evaluation.decision)}>{evaluation.decision}</strong>
          <span>Scoring verdict only · release not authorized</span>
        </div>
        <div className="fixture-winner">
          <span className="workbench-label">{winner ? "Fixture winner" : "No fixture winner"}</span>
          <strong>{winner?.candidate.agent ?? "No candidate passed the reported policy"}</strong>
          {winner && <code>{winner.candidate.id}</code>}
        </div>
      </div>

      <div className="evaluation-target">
        <GitBranch size={16} aria-hidden="true" />
        <div><span>{evaluation.repository}</span><h3>{evaluation.target}</h3></div>
        <span className="reported-badge">Caller-reported signals</span>
      </div>

      {!selected ? (
        <div className="workspace-empty"><h3>No fixture candidates returned</h3><p>Run the fixture again to load candidates for inspection.</p></div>
      ) : (
        <div className="inspection-layout">
          <section className="candidate-roster" aria-label="Ranked fixture candidates">
            <div className="roster-heading"><h3>Candidates</h3><span className="tabular-nums">{number(evaluation.evaluations.length, "count")} returned</span></div>
            <p className="inspector-hint">Select a patch to inspect its reported evidence.</p>
            <ol className="candidate-ranking">
              {evaluation.evaluations.map((item, index) => (
                <li key={item.candidate.id}>
                  <button type="button" className={"candidate-option" + (selected.candidate.id === item.candidate.id ? " selected" : "")}
                    aria-label={"Inspect " + item.candidate.agent} aria-pressed={selected.candidate.id === item.candidate.id}
                    aria-controls="candidate-inspector" onClick={() => onSelectCandidate(item.candidate.id)}>
                    <span className="candidate-rank tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                    <span className="candidate-identity"><strong>{item.candidate.agent}</strong><small>{item.candidate.model}</small></span>
                    <span className="candidate-score tabular-nums">{number(item.score, "count")}<small>/ 100</small></span>
                    <span className={"verdict " + verdictClass(item.verdict)}>{item.verdict}</span>
                    {winner?.candidate.id === item.candidate.id && <span className="candidate-winner-mark"><BadgeCheck size={14} aria-hidden="true" /> Fixture winner</span>}
                  </button>
                </li>
              ))}
            </ol>
            <div className="fixture-policy-note"><ShieldAlert size={17} aria-hidden="true" /><p>{evaluation.policy.principle}</p></div>
          </section>

          <section className="candidate-inspector" id="candidate-inspector" aria-labelledby="selected-candidate-heading">
            <div className="inspector-heading">
              <div><span className="workbench-label">Selected candidate</span><h3 id="selected-candidate-heading">{selected.candidate.agent}</h3><code>{selected.candidate.id}</code></div>
              <span className={"verdict " + verdictClass(selected.verdict)}>{selected.verdict}</span>
            </div>
            <p className="selected-summary">{selected.candidate.summary}</p>
            <div className="selected-branch"><GitBranch size={14} aria-hidden="true" /><span>{selected.candidate.branch}</span></div>
            <dl className="candidate-facts">
              <div><dt>Reported score</dt><dd className="tabular-nums">{number(selected.score, "count")} / 100</dd></div>
              <div><dt>Files changed</dt><dd className="tabular-nums">{number(selected.candidate.filesChanged, "count")}</dd></div>
              <div><dt>Line changes</dt><dd className="tabular-nums">+{number(selected.candidate.additions, "count")} / −{number(selected.candidate.deletions, "count")}</dd></div>
              <div><dt>Reported latency</dt><dd className="tabular-nums">{number(selected.candidate.latencyMs / 1000, "seconds")}</dd></div>
              <div><dt>Reported cost</dt><dd className="tabular-nums">{number(selected.candidate.costUsd, "currency")}</dd></div>
              <div><dt>Evidence coverage</dt><dd className="tabular-nums">{number(selected.candidate.signals.evidence.coverage, "probability")}</dd></div>
            </dl>

            <div className="inspector-reasons"><h4>Policy reasons</h4><ul>{selected.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div>

            <div className="inspector-gates">
              <div className="gate-inspector-heading"><h4>Reported gates</h4><span>Critical failures block a passing verdict</span></div>
              {selected.gates.map((gate) => {
                const signal = selected.candidate.signals[gate.key as GateKey];
                return (
                  <details className={"inspector-gate gate-" + gate.status} key={gate.key}>
                    <summary>
                      <span className="gate-result-icon" aria-hidden="true">{gate.status === "pass" ? <Check size={16} /> : gate.status === "fail" ? <X size={16} /> : <ShieldAlert size={16} />}</span>
                      <span className="gate-name">{gate.label}<small>{gate.critical ? "Critical" : "Supporting"} · {gate.status}</small></span>
                      <span className="gate-points tabular-nums">{number(gate.earned, "count")} / {number(gate.weight, "count")}</span>
                    </summary>
                    <div className="gate-evidence"><p>{gate.note}</p><dl><div><dt>Reported result</dt><dd>{signal.passed ? "passed" : "failed"}</dd></div>{gate.key === "tests" && <><div><dt>Reported tests</dt><dd className="tabular-nums">{number(selected.candidate.signals.tests.total, "count")}</dd></div><div><dt>Reported failures</dt><dd className="tabular-nums">{number(selected.candidate.signals.tests.failed, "count")}</dd></div></>}{gate.key === "evidence" && <div><dt>Reported coverage</dt><dd className="tabular-nums">{number(selected.candidate.signals.evidence.coverage, "probability")}</dd></div>}</dl></div>
                  </details>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
