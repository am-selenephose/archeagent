import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Mission, MissionResult, OrchestratorEvent } from "../../src/core/types";
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
    "truncate table mission_leases, orchestrator_events, executions, missions restart identity cascade",
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


describe("Postgres mission lease fencing", () => {
  it("rejects a stale worker after an expired lease is reclaimed", async () => {
    await store.saveMission(missionRecord);

    const first = await store.claimMission(missionRecord.id, "worker-a", 60_000);
    expect(first).toMatchObject({ acquired: true, fence: 1 });

    const busy = await store.claimMission(missionRecord.id, "worker-b", 60_000);
    expect(busy).toMatchObject({ acquired: false, reason: "busy" });

    await admin.unsafe(
      "update mission_leases set lease_expires_at = now() - interval '1 second' where mission_id = $1",
      [missionRecord.id],
    );

    const second = await store.claimMission(missionRecord.id, "worker-b", 60_000);
    expect(second).toMatchObject({ acquired: true, fence: 2 });

    await expect(
      store.completeMission(missionRecord.id, "worker-a", 1),
    ).rejects.toThrow(/stale mission lease/i);

    await expect(
      store.completeMission(missionRecord.id, "worker-b", 2),
    ).resolves.toBeUndefined();

    const afterCompletion = await store.claimMission(
      missionRecord.id,
      "worker-c",
      60_000,
    );
    expect(afterCompletion).toMatchObject({
      acquired: false,
      reason: "completed",
    });
  });

  it("renews only the current live fence", async () => {
    await store.saveMission(missionRecord);
    const claim = await store.claimMission(
      missionRecord.id,
      "worker-a",
      60_000,
    );
    expect(claim.acquired).toBe(true);

    await expect(
      store.renewMission(missionRecord.id, "worker-a", 1, 120_000),
    ).resolves.toBeUndefined();

    await expect(
      store.renewMission(missionRecord.id, "worker-a", 999, 120_000),
    ).rejects.toThrow(/stale mission lease/i);
  });
});


describe("Postgres fenced result commit", () => {
  it("writes no result data when a stale worker tries to commit", async () => {
    await store.saveMission(missionRecord);
    await store.claimMission(missionRecord.id, "worker-a", 60_000);

    await admin.unsafe(
      "update mission_leases set lease_expires_at = now() - interval '1 second' where mission_id = $1",
      [missionRecord.id],
    );
    const active = await store.claimMission(
      missionRecord.id,
      "worker-b",
      60_000,
    );
    expect(active).toMatchObject({ acquired: true, fence: 2 });

    const result: MissionResult = {
      mission: missionRecord,
      status: "completed",
      costUsd: 0,
      executions: [],
      events: [{ ...original, missionId: missionRecord.id }],
      readyForMerge: true,
    };

    await expect(
      store.commitMissionResult("worker-a", 1, result),
    ).rejects.toThrow(/stale mission lease/i);

    const events = await admin.unsafe(
      "select count(*)::int as count from orchestrator_events where mission_id = $1",
      [missionRecord.id],
    );
    expect(Number(events[0]?.count)).toBe(0);

    const lease = await admin.unsafe(
      "select worker_id, fence, status from mission_leases where mission_id = $1",
      [missionRecord.id],
    );
    expect(lease[0]).toMatchObject({
      worker_id: "worker-b",
      fence: "2",
      status: "running",
    });
  });

  it("atomically persists result and completes the current fence", async () => {
    await store.saveMission(missionRecord);
    const claim = await store.claimMission(
      missionRecord.id,
      "worker-a",
      60_000,
    );
    expect(claim).toMatchObject({ acquired: true, fence: 1 });

    const result: MissionResult = {
      mission: missionRecord,
      status: "completed",
      costUsd: 0,
      executions: [],
      events: [{ ...original, missionId: missionRecord.id }],
      readyForMerge: true,
    };

    await store.commitMissionResult("worker-a", 1, result);

    const events = await admin.unsafe(
      "select count(*)::int as count from orchestrator_events where mission_id = $1",
      [missionRecord.id],
    );
    expect(Number(events[0]?.count)).toBe(1);

    const lease = await admin.unsafe(
      "select status from mission_leases where mission_id = $1",
      [missionRecord.id],
    );
    expect(lease[0]?.status).toBe("completed");
  });
});


it("rejects a result containing an event from another mission", async () => {
  await store.saveMission(missionRecord);
  const claim = await store.claimMission(
    missionRecord.id,
    "worker-a",
    60_000,
  );
  expect(claim).toMatchObject({ acquired: true, fence: 1 });

  const result: MissionResult = {
    mission: missionRecord,
    status: "completed",
    costUsd: 0,
    executions: [],
    events: [original],
    readyForMerge: true,
  };

  await expect(
    store.commitMissionResult("worker-a", 1, result),
  ).rejects.toThrow(/event mission mismatch/i);

  const lease = await admin.unsafe(
    "select status from mission_leases where mission_id = $1",
    [missionRecord.id],
  );
  expect(lease[0]?.status).toBe("running");
});

it("reconstructs mission replay from durable ordered history", async () => {
  await store.saveMission(missionRecord);
  const claim = await store.claimMission(
    missionRecord.id,
    "worker-replay",
    60_000,
  );
  expect(claim).toMatchObject({ acquired: true, fence: 1 });

  const result: MissionResult = {
    mission: missionRecord,
    status: "completed",
    costUsd: 0,
    executions: [],
    events: [
      {
        ...original,
        missionId: missionRecord.id,
        sequence: 1,
        detail: "first durable event",
      },
      {
        ...original,
        missionId: missionRecord.id,
        sequence: 2,
        type: "mission.completed",
        detail: "second durable event",
        at: "2026-09-27T03:00:01.000Z",
      },
    ],
    readyForMerge: true,
  };

  await store.commitMissionResult("worker-replay", 1, result);

  const replay = await store.loadMissionReplay(missionRecord.id);

  expect(replay?.mission).toEqual(missionRecord);
  expect(replay?.events.map((event) => event.sequence)).toEqual([1, 2]);
  expect(replay?.events.map((event) => event.detail)).toEqual([
    "first durable event",
    "second durable event",
  ]);
  expect(replay?.executions).toEqual([]);
});


describe("Postgres release lease replay fencing", () => {
  it("atomically consumes a release lease id only once", async () => {
    const leaseId = `lease-${randomUUID()}`;

    expect(await store.hasConsumedReleaseLease(leaseId)).toBe(false);

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.consumeReleaseLeaseIfUnused(leaseId),
      ),
    );

    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect(await store.hasConsumedReleaseLease(leaseId)).toBe(true);
  });
});
