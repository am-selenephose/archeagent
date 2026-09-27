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

function rawPayload(fields: StreamFields | null) {
  if (!fields) return null;
  const index = fields.findIndex((field) => field === 'payload');
  return index >= 0 ? fields[index + 1] ?? null : null;
}

function parsePayload(fields: StreamFields | null) {
  const raw = rawPayload(fields);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as MissionEnvelope;
  } catch {
    return null;
  }
}

export class MissionStream {
  constructor(private readonly redis: Redis) {}

  private async deadLetterMalformed(
    streamId: string,
    fields: StreamFields | null,
    reason = 'INVALID_ENVELOPE',
  ) {
    await this.redis.xadd(
      DEAD_LETTER_STREAM,
      '*',
      'payload',
      JSON.stringify({
        rawPayload: rawPayload(fields),
        failedAt: new Date().toISOString(),
        reason,
        sourceStreamId: streamId,
      }),
    );
    await this.ack(streamId);
  }

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

    const envelope: MissionEnvelope = {
      mission,
      enqueuedAt: new Date().toISOString(),
      attempt: 0,
      idempotencyKey,
    };

    const raw = (await this.redis.eval(
      [
        "local existing = redis.call('GET', KEYS[1])",
        "if existing then return {0, existing} end",
        "local streamId = redis.call('XADD', KEYS[2], '*', 'payload', ARGV[1])",
        "redis.call('SET', KEYS[1], streamId, 'EX', ARGV[2])",
        "return {1, streamId}",
      ].join('\n'),
      2,
      dedupeKey,
      STREAM,
      JSON.stringify(envelope),
      '86400',
    )) as [number, string];

    if (Number(raw[0]) !== 1) {
      return { accepted: false, streamId: null };
    }

    return { accepted: true, streamId: String(raw[1]) };
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
        if (!envelope) {
          await this.deadLetterMalformed(streamId, fields);
          continue;
        }
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
      if (!envelope) {
        await this.deadLetterMalformed(streamId, fields);
        continue;
      }
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
