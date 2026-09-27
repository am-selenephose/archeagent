import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Mission, OrchestratorEvent } from "../../src/core/types";
import { createArcheagentStore } from "../../src/server/storage/postgres";

const databaseUrl =
  process.env.ARCHEAGENT_TEST_DATABASE_URL ??
  "postgres://archeagent:archeagent@127.0.0.1:55435/archeagent";

const store = createArcheagentStore(databaseUrl);
const admin = postgres(databaseUrl, { max: 1 });

beforeAll(async () => {
  await store.migrate();
});

beforeEach(async () => {
  await admin.unsafe(
    "truncate table orchestrator_events, executions, missions restart identity cascade",
  );
});

afterAll(async () => {
  await store.close();
  await admin.end();
});

const original: OrchestratorEvent = {
  sequence: 1,
  missionId: "mission-history",
  type: "mission.started",
  detail: "mission accepted",
  at: "2026-09-27T03:00:00.000Z",
};

describe("Postgres append-only event integrity", () => {
  it("allows an exact event replay idempotently", async () => {
    await store.appendEvents([original]);
    await expect(store.appendEvents([original])).resolves.toBeUndefined();

    const rows = await admin.unsafe(
      "select count(*)::int as count from orchestrator_events",
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it("rejects divergent history at an existing sequence", async () => {
    await store.appendEvents([original]);

    await expect(
      store.appendEvents([
        {
          ...original,
          detail: "different historical claim",
        },
      ]),
    ).rejects.toThrow(/event conflict/i);
  });
});


const missionRecord: Mission = {
  id: "mission-persistence",
  repository: "acme/repo",
  objective: "preserve one durable mission identity",
  budgetUsd: 4,
  tasks: [],
};

describe("Postgres mission identity integrity", () => {
  it("allows an exact mission replay idempotently", async () => {
    await store.saveMission(missionRecord);
    await expect(store.saveMission(missionRecord)).resolves.toBeUndefined();

    const rows = await admin.unsafe(
      "select count(*)::int as count from missions where id = $1",
      [missionRecord.id],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it("rejects a different mission payload reusing an existing mission id", async () => {
    await store.saveMission(missionRecord);

    await expect(
      store.saveMission({
        ...missionRecord,
        objective: "different mission hiding behind the same id",
      }),
    ).rejects.toThrow(/mission conflict/i);
  });
});
