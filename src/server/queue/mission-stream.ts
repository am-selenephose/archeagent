import Redis from 'ioredis';
import type { Mission } from '../../core/types';

export type MissionEnvelope = {
  mission: Mission;
  enqueuedAt: string;
  attempt: number;
  idempotencyKey: string;
};

export type ClaimedMission = {
  streamId: string;
  envelope: MissionEnvelope;
};

type StreamFields = string[];
type StreamEntry = [string, StreamFields | null];
type StreamReadResponse = Array<[string, StreamEntry[]]>;

const STREAM = 'archeagent:missions';
const DEAD_LETTER_STREAM = 'archeagent:missions:dead';
const GROUP = 'archeagent-workers';

function parsePayload(fields: StreamFields | null) {
  if (!fields) return null;
  const index = fields.findIndex((field) => field === 'payload');
  const raw = index >= 0 ? fields[index + 1] : null;
  if (!raw) return null;

  try {
    return JSON.parse(raw) as MissionEnvelope;
  } catch {
    return null;
  }
}

export class MissionStream {
  constructor(private readonly redis: Redis) {}

  async ensureGroup() {
    try {
      await this.redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('BUSYGROUP')) throw error;
    }
  }

  async enqueue(mission: Mission, idempotencyKey: string) {
    const dedupeKey = 'archeagent:dedupe:' + idempotencyKey;
    const accepted = await this.redis.set(
      dedupeKey,
      mission.id,
      'EX',
      86400,
      'NX',
    );

    if (accepted !== 'OK') {
      return { accepted: false, streamId: null };
    }

    const envelope: MissionEnvelope = {
      mission,
      enqueuedAt: new Date().toISOString(),
      attempt: 0,
      idempotencyKey,
    };

    const streamId = await this.redis.xadd(
      STREAM,
      '*',
      'payload',
      JSON.stringify(envelope),
    );

    return { accepted: true, streamId };
  }

  async read(consumer: string, blockMs = 5000): Promise<ClaimedMission[]> {
    await this.ensureGroup();

    const rawResponse = await this.redis.xreadgroup(
      'GROUP',
      GROUP,
      consumer,
      'COUNT',
      8,
      'BLOCK',
      blockMs,
      'STREAMS',
      STREAM,
      '>',
    );

    const response = rawResponse as StreamReadResponse | null;
    if (!response) return [];

    const claimed: ClaimedMission[] = [];

    for (const [, entries] of response) {
      for (const [streamId, fields] of entries) {
        const envelope = parsePayload(fields);
        if (!envelope) continue;
        claimed.push({ streamId, envelope });
      }
    }

    return claimed;
  }

  async ack(streamId: string) {
    await this.redis.xack(STREAM, GROUP, streamId);
  }

  async retry(item: ClaimedMission, reason: string, maxAttempts = 3) {
    const nextAttempt = item.envelope.attempt + 1;

    if (nextAttempt >= maxAttempts) {
      await this.redis.xadd(
        DEAD_LETTER_STREAM,
        '*',
        'payload',
        JSON.stringify({
          ...item.envelope,
          attempt: nextAttempt,
          failedAt: new Date().toISOString(),
          reason,
        }),
      );
      await this.ack(item.streamId);
      return { deadLettered: true };
    }

    await this.redis.xadd(
      STREAM,
      '*',
      'payload',
      JSON.stringify({
        ...item.envelope,
        attempt: nextAttempt,
      }),
    );

    await this.ack(item.streamId);
    return { deadLettered: false };
  }

  async reclaimStale(
    consumer: string,
    minIdleMs = 60000,
    count = 20,
  ): Promise<ClaimedMission[]> {
    await this.ensureGroup();

    const pendingRaw = await this.redis.xpending(
      STREAM,
      GROUP,
      'IDLE',
      minIdleMs,
      '-',
      '+',
      count,
    );

    const pending = Array.isArray(pendingRaw)
      ? (pendingRaw as Array<[string, string, number, number]>)
      : [];

    if (pending.length === 0) return [];

    const ids = pending.map((entry) => entry[0]);
    const claimedRaw = await this.redis.xclaim(
      STREAM,
      GROUP,
      consumer,
      minIdleMs,
      ...ids,
    );

    const claimedEntries = Array.isArray(claimedRaw)
      ? (claimedRaw as StreamEntry[])
      : [];

    const claimed: ClaimedMission[] = [];

    for (const [streamId, fields] of claimedEntries) {
      const envelope = parsePayload(fields);
      if (!envelope) continue;
      claimed.push({ streamId, envelope });
    }

    return claimed;
  }
}

export function createRedis(url: string) {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
}
