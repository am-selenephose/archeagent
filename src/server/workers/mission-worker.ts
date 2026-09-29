import type { Mission, MissionResult } from '../../core/types';
import type { MissionStream, ClaimedMission } from '../queue/mission-stream';
import {
  MissionConflictError,
  StaleMissionLeaseError,
  type ArcheagentStore,
} from '../storage/postgres';

export type MissionRunner = {
  run(mission: Mission): Promise<MissionResult>;
};

export type MissionWorkerOptions = {
  leaseMs: number;
  maxAttempts: number;
};

export type MissionProcessResult =
  | { status: 'completed'; result: MissionResult }
  | { status: 'skipped'; reason: 'busy' | 'completed' }
  | { status: 'retrying' }
  | { status: 'dead_lettered' }
  | { status: 'stale' };

export class MissionWorker {
  constructor(
    private readonly workerId: string,
    private readonly stream: MissionStream,
    private readonly store: ArcheagentStore,
    private readonly runner: MissionRunner,
    private readonly options: MissionWorkerOptions = {
      leaseMs: 120_000,
      maxAttempts: 3,
    },
  ) {}

  async process(item: ClaimedMission): Promise<MissionProcessResult> {
    const mission = item.envelope.mission;
    try {
      await this.store.saveMission(mission);
    } catch (error) {
      if (error instanceof MissionConflictError) {
        await this.stream.deadLetter(item, error.message);
        return { status: 'dead_lettered' };
      }
      throw error;
    }

    const claim = await this.store.claimMission(
      mission.id,
      this.workerId,
      this.options.leaseMs,
    );

    if (!claim.acquired) {
      await this.stream.ack(item.streamId);
      return {
        status: 'skipped',
        reason: claim.reason,
      };
    }

    let heartbeatFailure: unknown = null;
    let heartbeat = Promise.resolve();
    const renew = () => {
      heartbeat = heartbeat
        .then(() =>
          this.store.renewMission(
            mission.id,
            this.workerId,
            claim.fence,
            this.options.leaseMs,
          ),
        )
        .catch((error: unknown) => {
          heartbeatFailure = error;
        });
    };

    const heartbeatMs = Math.max(
      250,
      Math.floor(this.options.leaseMs / 3),
    );
    const timer = setInterval(renew, heartbeatMs);
    timer.unref();

    try {
      const result = await this.runner.run(mission);

      clearInterval(timer);
      await heartbeat;

      if (heartbeatFailure) {
        throw heartbeatFailure;
      }

      await this.store.commitMissionResult(
        this.workerId,
        claim.fence,
        result,
      );

      await this.stream.ack(item.streamId);
      return { status: 'completed', result };
    } catch (error) {
      clearInterval(timer);
      await heartbeat;

      if (error instanceof StaleMissionLeaseError) {
        return { status: 'stale' };
      }

      try {
        await this.store.abandonMission(
          mission.id,
          this.workerId,
          claim.fence,
        );
      } catch (abandonError) {
        if (abandonError instanceof StaleMissionLeaseError) {
          return { status: 'stale' };
        }
        throw abandonError;
      }

      const reason =
        error instanceof Error ? error.message : String(error);
      const retry = await this.stream.retry(
        item,
        reason,
        this.options.maxAttempts,
      );

      return retry.deadLettered
        ? { status: 'dead_lettered' }
        : { status: 'retrying' };
    }
  }

  async readAndProcess(consumer: string, blockMs = 5000) {
    const items = await this.stream.read(consumer, blockMs);
    const results: MissionProcessResult[] = [];

    for (const item of items) {
      results.push(await this.process(item));
    }

    return results;
  }
}
