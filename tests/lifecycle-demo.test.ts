import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifecycleConsole } from "../src/components/lifecycle-console";
import { demoRequest } from "../src/lib/demo";
import { evaluateRun } from "../src/lib/evaluator";
import { runLifecycleDemo, selectLifecycleWinner, type LifecycleState } from "../src/lib/lifecycle-demo";

const intelligence = {
  context: { repository: "fixture/repo", language: "typescript", framework: "next", taskClass: "testing", risk: "low" },
  routing: { agent: null, candidates: [] },
  tournament: { primary: "fixture-agent", shadows: [], reason: "Fixture" },
  reviewerPairing: null, reviewerCandidates: [], authority: null,
  verification: { levels: ["tests"], humanReviewRequired: true, maxReviewerMinutes: 10, rationale: [] },
  release: {
    claims: { baseSha: "fixture-base", patchSha: "fixture-patch", policyHash: "fixture-policy", environment: "fixture", leaseId: "fixture-lease" },
    validExactState: { valid: true, reasons: [] },
    invalidAfterHeadMove: { valid: false, reasons: ["base changed"] },
  },
  productionAttribution: { confidence: 0, supportingSignals: [], contradictingSignals: [] },
  productionOutcome: null,
};
const evaluation = evaluateRun(demoRequest);

function stateRecorder() {
  const states: LifecycleState[] = [];
  return { states, update: (state: LifecycleState) => { states.push(state); } };
}

function successfulFetch(): typeof fetch {
  return async (input) => Response.json(String(input).includes("/intelligence/") ? intelligence : evaluation);
}

describe("Lifecycle fixture demo recovery", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["request", "body"])("ends a hanging %s within the shared request deadline", async (hang) => {
    vi.useFakeTimers();
    const recorder = stateRecorder();
    const fetcher: typeof fetch = async () => hang === "request"
      ? new Promise<Response>(() => {})
      : { ok: true, json: () => new Promise(() => {}) } as Response;
    const operation = runLifecycleDemo(recorder.update, fetcher, { timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    expect(recorder.states.at(-1)?.loading).toBe(false);
    expect(recorder.states.at(-1)?.error).toMatch(/retry/i);
    await operation;
  });

  it("does not publish a late response after the owning component cancels", async () => {
    const recorder = stateRecorder();
    const controller = new AbortController();
    let release: (() => void) | undefined;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const fetcher: typeof fetch = async (input) => {
      await paused;
      return successfulFetch()(input);
    };
    const operation = runLifecycleDemo(recorder.update, fetcher, { signal: controller.signal });
    controller.abort();
    release?.();
    await operation;
    expect(recorder.states).toHaveLength(1);
    expect(recorder.states[0].loading).toBe(true);
  });

  it("publishes only the replacement request after supersession", async () => {
    const recorder = stateRecorder();
    const controller = new AbortController();
    let release: (() => void) | undefined;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const previous = runLifecycleDemo(recorder.update, async (input) => {
      await paused;
      return successfulFetch()(input);
    }, { signal: controller.signal });
    controller.abort();
    await runLifecycleDemo(recorder.update, successfulFetch());
    const countAfterReplacement = recorder.states.length;
    release?.();
    await previous;
    expect(recorder.states).toHaveLength(countAfterReplacement);
    expect(recorder.states.at(-1)).toMatchObject({ evaluation, loading: false, error: null });
  });

  it("labels the rendered console as a fixture with no live execution or release", () => {
    const html = renderToStaticMarkup(createElement(LifecycleConsole));
    expect(html).toContain("Fixture demo");
    expect(html).toContain("No live Concord session, model or provider execution, deployment, or release authorization");
    expect(html).toContain("Run fixture demo");
    expect(html).toContain('aria-labelledby="fixture-heading"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Ready to load reported fixture signals");
  });

  it("loads both valid fixture responses and clears the running state", async () => {
    const recorder = stateRecorder();
    await runLifecycleDemo(recorder.update, successfulFetch());
    expect(recorder.states[0]).toEqual({ intelligence: null, evaluation: null, loading: true, error: null });
    expect(recorder.states.at(-1)).toMatchObject({ intelligence, evaluation, loading: false, error: null });
  });

  it("clears running and exposes a retry message after a network failure", async () => {
    const recorder = stateRecorder();
    const failedFetch: typeof fetch = async () => { throw new Error("PRIVATE_SENTINEL network failure"); };
    await expect(runLifecycleDemo(recorder.update, failedFetch)).resolves.toBeUndefined();
    expect(recorder.states.at(-1)).toMatchObject({ intelligence: null, evaluation: null, loading: false });
    expect(recorder.states.at(-1)?.error).toMatch(/retry/i);
    expect(recorder.states.at(-1)?.error).not.toContain("PRIVATE_SENTINEL");
  });

  it.each(["/api/intelligence/demo", "/api/demo"])("rejects a non-OK response from %s without partial results", async (failedPath) => {
    const recorder = stateRecorder();
    const fetcher: typeof fetch = async (input) => String(input) === failedPath
      ? Response.json({ error: "PRIVATE_SENTINEL" }, { status: 503 })
      : successfulFetch()(input);
    await expect(runLifecycleDemo(recorder.update, fetcher)).resolves.toBeUndefined();
    expect(recorder.states.at(-1)).toMatchObject({ intelligence: null, evaluation: null, loading: false });
    expect(recorder.states.at(-1)?.error).toMatch(/retry/i);
    expect(recorder.states.at(-1)?.error).not.toContain("PRIVATE_SENTINEL");
  });

  it("clears running when an OK response contains malformed JSON", async () => {
    const recorder = stateRecorder();
    const fetcher: typeof fetch = async () => new Response("{invalid PRIVATE_SENTINEL");
    await expect(runLifecycleDemo(recorder.update, fetcher)).resolves.toBeUndefined();
    expect(recorder.states.at(-1)).toMatchObject({ intelligence: null, evaluation: null, loading: false });
    expect(recorder.states.at(-1)?.error).toMatch(/retry/i);
  });

  it.each(["intelligence", "evaluation"])("rejects an incomplete %s response before rendering", async (broken) => {
    const recorder = stateRecorder();
    const fetcher: typeof fetch = async (input) => {
      const kind = String(input).includes("/intelligence/") ? "intelligence" : "evaluation";
      return Response.json(kind === broken ? {} : kind === "intelligence" ? intelligence : evaluation);
    };
    await expect(runLifecycleDemo(recorder.update, fetcher)).resolves.toBeUndefined();
    expect(recorder.states.at(-1)).toMatchObject({ intelligence: null, evaluation: null, loading: false });
    expect(recorder.states.at(-1)?.error).toMatch(/retry/i);
  });

  it("rejects a malformed nested gate used by the stage renderer", async () => {
    const recorder = stateRecorder();
    const fetcher: typeof fetch = async (input) => Response.json(String(input).includes("/intelligence/")
      ? intelligence : { ...evaluation, evaluations: [{ ...evaluation.evaluations[0], gates: [null] }] });
    await runLifecycleDemo(recorder.update, fetcher);
    expect(recorder.states.at(-1)).toMatchObject({ intelligence: null, evaluation: null, loading: false });
    expect(recorder.states.at(-1)?.error).toMatch(/retry/i);
  });

  it("clears an earlier failure and publishes results on retry", async () => {
    const recorder = stateRecorder();
    const failure: typeof fetch = async () => { throw new Error("offline"); };
    await runLifecycleDemo(recorder.update, failure);
    expect(recorder.states.at(-1)?.error).toMatch(/retry/i);
    await runLifecycleDemo(recorder.update, successfulFetch());
    expect(recorder.states.at(-2)).toEqual({ intelligence: null, evaluation: null, loading: true, error: null });
    expect(recorder.states.at(-1)).toMatchObject({ intelligence, evaluation, loading: false, error: null });
  });

  it("keeps a legitimate no-winner run distinct from its top ranked rejected candidate", async () => {
    const noWinner = evaluateRun({ ...demoRequest, candidates: [demoRequest.candidates[0]] });
    expect(noWinner.winnerId).toBeNull();
    expect(noWinner.decision).toBe("REJECT");
    const recorder = stateRecorder();
    const fetcher: typeof fetch = async (input) => Response.json(String(input).includes("/intelligence/") ? intelligence : noWinner);
    await runLifecycleDemo(recorder.update, fetcher);
    expect(recorder.states.at(-1)?.error).toBeNull();
    expect(recorder.states.at(-1)?.evaluation?.winnerId).toBeNull();
    expect(selectLifecycleWinner(recorder.states.at(-1)?.evaluation ?? null)).toBeNull();
  });

  it("selects the explicitly accepted fixture winner", () => {
    expect(selectLifecycleWinner(evaluation)?.candidate.id).toBe("verified-patch");
    expect(selectLifecycleWinner(evaluation)?.verdict).toBe("MERGE");
  });

  it.each([null, "unknown-candidate", "fast-fix"])("never substitutes a ranked candidate for invalid winner id %s", (winnerId) => {
    expect(selectLifecycleWinner({ ...evaluation, winnerId })).toBeNull();
  });

  it.each([null, "unknown-candidate", "fast-fix"])("rejects a claimed MERGE response with invalid winner id %s", async (winnerId) => {
    const recorder = stateRecorder();
    const fetcher: typeof fetch = async (input) => Response.json(String(input).includes("/intelligence/")
      ? intelligence : { ...evaluation, winnerId });
    await runLifecycleDemo(recorder.update, fetcher);
    expect(recorder.states.at(-1)?.intelligence).toBeNull();
    expect(recorder.states.at(-1)?.evaluation).toBeNull();
    expect(recorder.states.at(-1)?.loading).toBe(false);
    expect(recorder.states.at(-1)?.error).toMatch(/retry/i);
  });

  it("rejects duplicate identities for an explicitly selected winner", async () => {
    const recorder = stateRecorder();
    const duplicateWinner = { ...evaluation, evaluations: [evaluation.evaluations[0], evaluation.evaluations[0]] };
    const fetcher: typeof fetch = async (input) => Response.json(String(input).includes("/intelligence/") ? intelligence : duplicateWinner);
    await runLifecycleDemo(recorder.update, fetcher);
    expect(recorder.states.at(-1)?.evaluation).toBeNull();
    expect(recorder.states.at(-1)?.error).toMatch(/retry/i);
  });
});
