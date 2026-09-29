import Redis from "ioredis";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Mission, MissionResult } from "../../src/core/types";
import { MissionStream } from "../../src/server/queue/mission-stream";
import { createArcheagentStore } from "../../src/server/storage/postgres";
import { MissionWorker } from "../../src/server/workers/mission-worker";

const redisUrl =
  process.env.ARCHEAGENT_TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15";
const databaseUrl =
  process.env.ARCHEAGENT_TEST_DATABASE_URL ??
  "postgres://archeagent:archeagent@127.0.0.1:55435/archeagent";

const redis = new Redis(redisUrl);
const stream = new MissionStream(redis);
const store = createArcheagentStore(databaseUrl);
const admin = postgres(databaseUrl, { max: 1 });

const mission: Mission = {
  id: "mission-worker-exactly-once",
  repository: "demo/repo",
  objective: "execute once across duplicate queue identities",
  budgetUsd: 2,
  tasks: [],
};

beforeAll(async () => {
  await store.migrate();
});

beforeEach(async () => {
  await redis.flushdb();
  await admin.unsafe(
    "truncate table mission_leases, orchestrator_events, executions, missions restart identity cascade",
  );
});

afterAll(async () => {
  await store.close();
  await admin.end();
  await redis.quit();
});

describe("MissionWorker", () => {
  it("executes one mission once even when queued under different idempotency keys", async () => {
    let runs = 0;
    const runner = {
      async run(input: Mission): Promise<MissionResult> {
        runs += 1;
        return {
          mission: input,
          status: "completed",
          costUsd: 0,
          executions: [],
          events: [
            {
              sequence: 1,
              missionId: input.id,
              type: "mission.completed",
              detail: "completed by integration runner",
              at: "2026-09-28T00:00:00.000Z",
            },
          ],
          readyForMerge: true,
        };
      },
    };

    await stream.enqueue(mission, "request-a");
    await stream.enqueue(mission, "request-b");

    const items = await stream.read("consumer-a", 1);
    expect(items).toHaveLength(2);

    const worker = new MissionWorker(
      "worker-a",
      stream,
      store,
      runner,
      { leaseMs: 60_000, maxAttempts: 3 },
    );

    const first = await worker.process(items[0]!);
    const second = await worker.process(items[1]!);

    expect(first.status).toBe("completed");
    expect(second).toMatchObject({
      status: "skipped",
      reason: "completed",
    });
    expect(runs).toBe(1);

    const pending = (await redis.xpending(
      "archeagent:missions",
      "archeagent-workers",
    )) as [number, string | null, string | null, unknown[]];
    expect(Number(pending[0])).toBe(0);

    const events = await admin.unsafe(
      "select count(*)::int as count from orchestrator_events where mission_id = $1",
      [mission.id],
    );
    expect(Number(events[0]?.count)).toBe(1);
  });

  it("requeues an ordinary runner failure and succeeds on the next attempt", async () => {
    let runs = 0;
    const runner = {
      async run(input: Mission): Promise<MissionResult> {
        runs += 1;
        if (runs === 1) throw new Error("transient runner failure");
        return {
          mission: input,
          status: "completed",
          costUsd: 0,
          executions: [],
          events: [
            {
              sequence: 1,
              missionId: input.id,
              type: "mission.completed",
              detail: "completed after retry",
              at: "2026-09-28T00:00:01.000Z",
            },
          ],
          readyForMerge: true,
        };
      },
    };

    await stream.enqueue(mission, "retry-request");
    const [firstItem] = await stream.read("consumer-a", 1);
    const worker = new MissionWorker(
      "worker-a",
      stream,
      store,
      runner,
      { leaseMs: 60_000, maxAttempts: 3 },
    );

    const first = await worker.process(firstItem!);
    expect(first).toMatchObject({ status: "retrying" });

    const [retryItem] = await stream.read("consumer-a", 1);
    expect(retryItem?.envelope.attempt).toBe(1);

    const second = await worker.process(retryItem!);
    expect(second.status).toBe("completed");
    expect(runs).toBe(2);
  });
});

it("dead-letters a conflicting payload that reuses an existing mission id", async () => {
  let runs = 0;
  const runner = {
    async run(input: Mission): Promise<MissionResult> {
      runs += 1;
      return {
        mission: input,
        status: "completed",
        costUsd: 0,
        executions: [],
        events: [
          {
            sequence: 1,
            missionId: input.id,
            type: "mission.completed",
            detail: "canonical mission completed",
            at: "2026-09-28T00:00:02.000Z",
          },
        ],
        readyForMerge: true,
      };
    },
  };

  const conflicting: Mission = {
    ...mission,
    objective: "different payload reusing canonical identity",
  };

  await stream.enqueue(mission, "canonical-request");
  const [canonical] = await stream.read("consumer-a", 1);

  const worker = new MissionWorker(
    "worker-a",
    stream,
    store,
    runner,
    { leaseMs: 60_000, maxAttempts: 3 },
  );

  expect((await worker.process(canonical!)).status).toBe("completed");

  await stream.enqueue(conflicting, "conflicting-request");
  const [poison] = await stream.read("consumer-a", 1);
  const result = await worker.process(poison!);

  expect(result.status).toBe("dead_lettered");
  expect(runs).toBe(1);
  expect(await redis.xlen("archeagent:missions:dead")).toBe(1);

  const pending = (await redis.xpending(
    "archeagent:missions",
    "archeagent-workers",
  )) as [number, string | null, string | null, unknown[]];
  expect(Number(pending[0])).toBe(0);
});
