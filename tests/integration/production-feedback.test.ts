import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ContextualTrustGraph } from "../../src/core/intelligence/contextual-trust";
import type { DeploymentObservation } from "../../src/core/intelligence/production-outcome";
import { ProductionFeedbackService } from "../../src/server/intelligence/production-feedback";
import { createArcheagentStore } from "../../src/server/storage/postgres";

const databaseUrl = process.env.ARCHEAGENT_TEST_DATABASE_URL ??
  "postgres://archeagent:archeagent@127.0.0.1:55435/archeagent";
const store = createArcheagentStore(databaseUrl);
const admin = postgres(databaseUrl, { max: 1 });

const context = {
  repository: "acme/service",
  language: "typescript",
  framework: "postgres",
  taskClass: "backend",
  risk: "medium" as const,
};

function rollbackObservation(): DeploymentObservation {
  return {
    agentId: "generic",
    context,
    patchSha: "patch-rollback-1",
    deployedAt: "2026-09-01T00:00:00.000Z",
    observedUntil: "2026-09-02T00:00:00.000Z",
    rollback: true,
    hotfix: false,
    newSecurityFinding: false,
    regressionDetected: false,
    reviewerReversal: false,
    attributionEvidence: {
      deploymentPatchSha: "patch-rollback-1",
      rollbackPatchSha: "patch-rollback-1",
      touchedFiles: ["src/billing.ts"],
      incidentFiles: ["src/billing.ts"],
      errorIntroducedAfterDeployment: true,
      rollbackResolvedSignal: true,
      canaryAffected: true,
      featureFlagMatched: true,
    },
  };
}

beforeAll(async () => { await store.migrate(); });
beforeEach(async () => {
  await admin.unsafe("truncate table trust_observations, production_outcomes restart identity cascade");
});
afterAll(async () => { await store.close(); await admin.end(); });

describe("ProductionFeedbackService", () => {
  it("persists a production rollback as contextual trust evidence", async () => {
    const service = new ProductionFeedbackService(store);
    const result = await service.record(rollbackObservation());
    expect(result).toMatchObject({ accepted: true, outcome: "rollback" });

    const observations = await store.loadTrustObservations();
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      agentId: "generic", context, outcome: "rollback", weight: 1,
    });

    const graph = new ContextualTrustGraph();
    const before = graph.score("generic", context).posterior.mean;
    graph.observe(observations[0]!);
    const after = graph.score("generic", context).posterior.mean;
    expect(after).toBeLessThan(before);
  });

  it("does not persist low-confidence attribution", async () => {
    const service = new ProductionFeedbackService(store);
    const result = await service.record({
      ...rollbackObservation(),
      patchSha: "patch-low-confidence",
      attributionEvidence: {
        deploymentPatchSha: "different-patch",
        rollbackPatchSha: "different-patch",
        touchedFiles: ["src/billing.ts"],
        incidentFiles: ["src/unrelated.ts"],
        errorIntroducedAfterDeployment: false,
        rollbackResolvedSignal: false,
        canaryAffected: false,
        featureFlagMatched: false,
      },
    });
    expect(result).toMatchObject({ accepted: false });
    expect(await store.loadTrustObservations()).toEqual([]);
  });
});
