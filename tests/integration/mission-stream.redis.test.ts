import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Mission } from "../../src/core/types";
import { MissionStream } from "../../src/server/queue/mission-stream";

const redisUrl =
  process.env.ARCHEAGENT_TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15";

const redis = new Redis(redisUrl);
const stream = new MissionStream(redis);

const mission: Mission = {
  id: "mission-redis-integration",
  repository: "demo/repo",
  objective: "prove durable queue semantics",
  budgetUsd: 5,
  tasks: [],
};

beforeEach(async () => {
  await redis.flushdb();
});

afterAll(async () => {
  await redis.quit();
});

describe("MissionStream Redis integration", () => {
  it("does not poison the idempotency key when XADD fails", async () => {
    await redis.set("archeagent:missions", "wrong-type");

    await expect(
      stream.enqueue(mission, "atomic-enqueue-key"),
    ).rejects.toThrow();

    expect(await redis.get("archeagent:dedupe:atomic-enqueue-key")).toBeNull();

    await redis.del("archeagent:missions");

    await expect(
      stream.enqueue(mission, "atomic-enqueue-key"),
    ).resolves.toMatchObject({ accepted: true });
  });

  it("enqueues only once for the same idempotency key", async () => {
    const first = await stream.enqueue(mission, "same-key");
    const second = await stream.enqueue(mission, "same-key");

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(await redis.xlen("archeagent:missions")).toBe(1);
  });
});

describe("MissionStream recovery semantics", () => {
  it("reclaims a stale pending mission onto a new consumer", async () => {
    await stream.enqueue(mission, "stale-key");
    const first = await stream.read("worker-a", 1);
    expect(first).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const reclaimed = await stream.reclaimStale("worker-b", 1, 20);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]?.streamId).toBe(first[0]?.streamId);
  });

  it("dead-letters a mission after retry budget exhaustion and clears pending", async () => {
    await stream.enqueue(mission, "dead-letter-key");
    const [claimed] = await stream.read("worker-a", 1);
    expect(claimed).toBeDefined();

    const result = await stream.retry(claimed!, "forced failure", 1);

    expect(result.deadLettered).toBe(true);
    expect(await redis.xlen("archeagent:missions:dead")).toBe(1);

    const pending = (await redis.xpending(
      "archeagent:missions",
      "archeagent-workers",
    )) as [number, string | null, string | null, unknown[]];

    expect(Number(pending[0])).toBe(0);
  });

  it("does not leave malformed payloads pending forever", async () => {
    await stream.ensureGroup();
    await redis.xadd("archeagent:missions", "*", "payload", "{not-json");

    const claimed = await stream.read("worker-a", 1);

    expect(claimed).toEqual([]);
    const pending = (await redis.xpending(
      "archeagent:missions",
      "archeagent-workers",
    )) as [number, string | null, string | null, unknown[]];

    expect(Number(pending[0])).toBe(0);
    expect(await redis.xlen("archeagent:missions:dead")).toBe(1);
  });
});
