import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { demoRequest } from "../src/lib/demo";
import { evaluateRun, type EvaluationRun } from "../src/lib/evaluator";
import { EvaluationWorkspace } from "../src/components/evaluation-workspace";

async function renderWorkspace(evaluation: EvaluationRun, selectedCandidateId: string | null = null) {
  return renderToStaticMarkup(createElement(EvaluationWorkspace, {
    evaluation, selectedCandidateId, onSelectCandidate: () => {},
  }));
}

describe("Reported fixture candidate inspection", () => {
  it("exposes the ranked candidates as selectable buttons and identifies the explicit winner", async () => {
    const html = await renderWorkspace(evaluateRun(demoRequest));
    expect(html).toContain('aria-label="Ranked fixture candidates"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("VerifiedPatch");
    expect(html).toContain("Fixture winner");
    expect(html).toContain('id="candidate-inspector"');
  });

  it("shows the rejected candidate's reasons and gates while preserving the accepted winner", async () => {
    const html = await renderWorkspace(evaluateRun(demoRequest), "fast-fix");
    expect(html).toContain('aria-label="Inspect FastFix" aria-pressed="true"');
    expect(html).toContain("Duplicate protection is process-local and bypassed after restart.");
    expect(html).toContain("Reported regression suite failed a critical reported-signal gate.");
    expect(html).toMatch(/Fixture winner[\s\S]*VerifiedPatch/);
    expect(html).toContain("Selected candidate");
    expect(html).toContain("REJECT");
    expect(html).toContain("Caller-reported signals");
  });

  it("makes a no-winner result explicit even while a rejected candidate is inspected", async () => {
    const html = await renderWorkspace(evaluateRun({ ...demoRequest, candidates: [demoRequest.candidates[0]] }), "fast-fix");
    expect(html).toContain("No fixture winner");
    expect(html).not.toContain("Fixture winner</span>");
    expect(html).toContain("FastFix");
    expect(html).toContain("REJECT");
  });

  it("recovers selection after a candidate disappears from the returned run", async () => {
    const html = await renderWorkspace(evaluateRun(demoRequest), "removed-candidate");
    expect(html).toContain('aria-label="Inspect VerifiedPatch" aria-pressed="true"');
    expect(html).not.toContain('aria-label="Inspect FastFix" aria-pressed="true"');
  });

  it("keeps an empty successful response distinct from an evaluation in progress", async () => {
    const html = await renderWorkspace({ ...evaluateRun(demoRequest), evaluations: [], winnerId: null, decision: "REJECT" });
    expect(html).toContain("No fixture candidates returned");
    expect(html).toContain("Run the fixture again");
    expect(html).not.toContain('aria-label="Inspect');
  });
});
