import { createHash } from 'node:crypto';
import postgres from 'postgres';
import type {
  AgentExecution,
  Mission,
  MissionResult,
  OrchestratorEvent,
} from '../../core/types';
import type {
  OutcomeKind,
  TrustObservation,
} from '../../core/intelligence/contextual-trust';
import { contextKey } from '../../core/intelligence/contextual-trust';
import type { DeploymentObservation } from '../../core/intelligence/production-outcome';
import type { ReplayStore } from '../../core/release/release-lease';

export class MissionConflictError extends Error {
  constructor(missionId: string) {
    super('Mission conflict for ' + missionId);
    this.name = 'MissionConflictError';
  }
}

export class StaleMissionLeaseError extends Error {
  constructor(missionId: string) {
    super('Stale mission lease for ' + missionId);
    this.name = 'StaleMissionLeaseError';
  }
}

function contentId(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function decodeJsonPayload<T>(payload: unknown): T {
  if (typeof payload === 'string') {
    return JSON.parse(payload) as T;
  }
  return payload as T;
}

export function createArcheagentStore(databaseUrl: string) {
  const sql = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return {
    async migrate() {
      await sql.unsafe(
        'create table if not exists production_outcomes (' +
          'id text primary key,' +
          'agent_id text not null,' +
          'patch_sha text not null,' +
          'context_key text not null,' +
          'outcome text not null,' +
          'weight numeric not null,' +
          'reason text not null,' +
          'observed_until timestamptz not null,' +
          'payload jsonb not null,' +
          'created_at timestamptz not null default now()' +
        ')',
      );

      await sql.unsafe(
        'create table if not exists trust_observations (' +
          'id text primary key,' +
          'agent_id text not null,' +
          'context_key text not null,' +
          'repository text not null,' +
          'language text not null,' +
          'framework text not null,' +
          'task_class text not null,' +
          'risk_class text not null,' +
          'outcome text not null,' +
          'weight numeric not null,' +
          'at timestamptz not null,' +
          'payload jsonb not null,' +
          'created_at timestamptz not null default now()' +
        ')',
      );

      await sql.unsafe(
        'create table if not exists missions (' +
          'id text primary key,' +
          'repository text not null,' +
          'objective text not null,' +
          'budget_usd numeric not null,' +
          'payload jsonb not null,' +
          'created_at timestamptz not null default now()' +
        ')',
      );

      await sql.unsafe(
        'create table if not exists mission_leases (' +
          'mission_id text primary key references missions(id) on delete cascade,' +
          'worker_id text not null,' +
          'fence bigint not null,' +
          'status text not null,' +
          'lease_expires_at timestamptz not null,' +
          'completed_at timestamptz,' +
          'updated_at timestamptz not null default now(),' +
          "check (status in ('running','completed'))" +
        ')',
      );

      await sql.unsafe(
        'create table if not exists release_lease_consumptions (' +
          'lease_id text primary key,' +
          'consumed_at timestamptz not null default now()' +
        ')',
      );

      await sql.unsafe(
        'create table if not exists orchestrator_events (' +
          'mission_id text not null,' +
          'sequence bigint not null,' +
          'type text not null,' +
          'task_id text,' +
          'agent_id text,' +
          'detail text not null,' +
          'at timestamptz not null,' +
          'primary key (mission_id, sequence)' +
        ')',
      );

      await sql.unsafe(
        'create table if not exists executions (' +
          'mission_id text not null,' +
          'task_id text not null,' +
          'agent_id text not null,' +
          'attempt integer not null,' +
          'status text not null,' +
          'cost_usd numeric not null,' +
          'payload jsonb not null,' +
          'primary key (mission_id, task_id, agent_id, attempt)' +
        ')',
      );
    },

    async hasConsumedReleaseLease(leaseId: string) {
      const rows = await sql.unsafe(
        'select 1 from release_lease_consumptions where lease_id = $1',
        [leaseId],
      );
      return rows.length > 0;
    },

    async consumeReleaseLeaseIfUnused(leaseId: string) {
      const rows = await sql.unsafe(
        'insert into release_lease_consumptions (lease_id) values ($1) ' +
          'on conflict (lease_id) do nothing returning lease_id',
        [leaseId],
      );
      return rows.length === 1;
    },

    async saveMission(mission: Mission) {
      const payload = JSON.stringify(mission);
      const inserted = await sql.unsafe(
        'insert into missions (id, repository, objective, budget_usd, payload) ' +
        'values ($1, $2, $3, $4, $5::jsonb) ' +
        'on conflict (id) do nothing returning id',
        [
          mission.id,
          mission.repository,
          mission.objective,
          mission.budgetUsd,
          payload,
        ],
      );

      if (inserted.length > 0) return;

      const existingRows = await sql.unsafe(
        'select (' +
          'repository = $2 and objective = $3 and budget_usd = $4 and payload = $5::jsonb' +
        ') as exact ' +
        'from missions where id = $1',
        [
          mission.id,
          mission.repository,
          mission.objective,
          mission.budgetUsd,
          payload,
        ],
      );

      if (existingRows[0]?.exact !== true) {
        throw new MissionConflictError(mission.id);
      }
    },

    async claimMission(
      missionId: string,
      workerId: string,
      leaseMs: number,
    ) {
      if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
        throw new Error('Mission lease duration must be positive');
      }

      const rows = await sql.unsafe(
        'insert into mission_leases ' +
          '(mission_id, worker_id, fence, status, lease_expires_at) ' +
          "values ($1, $2, 1, 'running', now() + ($3::bigint * interval '1 millisecond')) " +
          'on conflict (mission_id) do update set ' +
          'worker_id = excluded.worker_id, ' +
          'fence = mission_leases.fence + 1, ' +
          "status = 'running', " +
          'lease_expires_at = excluded.lease_expires_at, ' +
          'completed_at = null, updated_at = now() ' +
          "where mission_leases.status <> 'completed' " +
          'and mission_leases.lease_expires_at <= now() ' +
          'returning worker_id, fence, status, lease_expires_at',
        [missionId, workerId, leaseMs],
      );

      if (rows.length > 0) {
        const row = rows[0] as unknown as {
          worker_id: string;
          fence: string | number;
          status: string;
          lease_expires_at: Date | string;
        };
        return {
          acquired: true as const,
          workerId: row.worker_id,
          fence: Number(row.fence),
          status: row.status,
          leaseExpiresAt: new Date(row.lease_expires_at).toISOString(),
        };
      }

      const existingRows = await sql.unsafe(
        'select worker_id, fence, status, lease_expires_at ' +
          'from mission_leases where mission_id = $1',
        [missionId],
      );

      const existing = existingRows[0] as unknown as
        | {
            worker_id: string;
            fence: string | number;
            status: string;
            lease_expires_at: Date | string;
          }
        | undefined;

      if (!existing) {
        throw new Error('Mission does not exist: ' + missionId);
      }

      return {
        acquired: false as const,
        reason:
          existing.status === 'completed'
            ? ('completed' as const)
            : ('busy' as const),
        workerId: existing.worker_id,
        fence: Number(existing.fence),
        status: existing.status,
        leaseExpiresAt: new Date(existing.lease_expires_at).toISOString(),
      };
    },

    async renewMission(
      missionId: string,
      workerId: string,
      fence: number,
      leaseMs: number,
    ) {
      if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
        throw new Error('Mission lease duration must be positive');
      }

      const rows = await sql.unsafe(
        'update mission_leases set ' +
          "lease_expires_at = now() + ($4::bigint * interval '1 millisecond'), " +
          'updated_at = now() ' +
          'where mission_id = $1 and worker_id = $2 and fence = $3 ' +
          "and status = 'running' and lease_expires_at > now() " +
          'returning mission_id',
        [missionId, workerId, fence, leaseMs],
      );

      if (rows.length === 0) {
        throw new StaleMissionLeaseError(missionId);
      }
    },

    async completeMission(
      missionId: string,
      workerId: string,
      fence: number,
    ) {
      const rows = await sql.unsafe(
        'update mission_leases set ' +
          "status = 'completed', completed_at = now(), updated_at = now() " +
          'where mission_id = $1 and worker_id = $2 and fence = $3 ' +
          "and status = 'running' and lease_expires_at > now() " +
          'returning mission_id',
        [missionId, workerId, fence],
      );

      if (rows.length === 0) {
        throw new StaleMissionLeaseError(missionId);
      }
    },

    async abandonMission(
      missionId: string,
      workerId: string,
      fence: number,
    ) {
      const rows = await sql.unsafe(
        'update mission_leases set lease_expires_at = now(), updated_at = now() ' +
          'where mission_id = $1 and worker_id = $2 and fence = $3 ' +
          "and status = 'running' returning mission_id",
        [missionId, workerId, fence],
      );

      if (rows.length === 0) {
        throw new StaleMissionLeaseError(missionId);
      }
    },

    async commitMissionResult(
      workerId: string,
      fence: number,
      result: MissionResult,
    ) {
      const missionId = result.mission.id;
      const foreignEvent = result.events.find(
        (event) => event.missionId !== missionId,
      );
      if (foreignEvent) {
        throw new Error(
          'Event mission mismatch: expected ' +
            missionId +
            ', received ' +
            foreignEvent.missionId,
        );
      }

      await sql.begin(async (tx) => {
        const leaseRows = await tx.unsafe(
          'update mission_leases set ' +
            "status = 'completed', completed_at = now(), updated_at = now() " +
            'where mission_id = $1 and worker_id = $2 and fence = $3 ' +
            "and status = 'running' and lease_expires_at > now() " +
            'returning mission_id',
          [missionId, workerId, fence],
        );

        if (leaseRows.length === 0) {
          throw new StaleMissionLeaseError(missionId);
        }

        for (const event of result.events) {
          const inserted = await tx.unsafe(
            'insert into orchestrator_events ' +
              '(mission_id, sequence, type, task_id, agent_id, detail, at) ' +
              'values ($1, $2, $3, $4, $5, $6, $7) ' +
              'on conflict (mission_id, sequence) do nothing ' +
              'returning mission_id',
            [
              event.missionId,
              event.sequence,
              event.type,
              event.taskId ?? null,
              event.agentId ?? null,
              event.detail,
              event.at,
            ],
          );

          if (inserted.length > 0) continue;

          const existingRows = await tx.unsafe(
            'select (' +
              'type = $3 and task_id is not distinct from $4 and ' +
              'agent_id is not distinct from $5 and detail = $6 and at = $7' +
              ') as exact from orchestrator_events ' +
              'where mission_id = $1 and sequence = $2',
            [
              event.missionId,
              event.sequence,
              event.type,
              event.taskId ?? null,
              event.agentId ?? null,
              event.detail,
              event.at,
            ],
          );

          if (existingRows[0]?.exact !== true) {
            throw new Error(
              'Orchestrator event conflict for ' +
                event.missionId +
                '#' +
                event.sequence,
            );
          }
        }

        for (const execution of result.executions) {
          const payload = JSON.stringify(execution);
          const inserted = await tx.unsafe(
            'insert into executions ' +
              '(mission_id, task_id, agent_id, attempt, status, cost_usd, payload) ' +
              'values ($1, $2, $3, $4, $5, $6, $7::jsonb) ' +
              'on conflict (mission_id, task_id, agent_id, attempt) do nothing ' +
              'returning mission_id',
            [
              missionId,
              execution.taskId,
              execution.agentId,
              execution.attempt,
              execution.status,
              execution.costUsd,
              payload,
            ],
          );

          if (inserted.length > 0) continue;

          const existingRows = await tx.unsafe(
            'select (' +
              'status = $5 and cost_usd = $6 and payload = $7::jsonb' +
              ') as exact from executions ' +
              'where mission_id = $1 and task_id = $2 and agent_id = $3 and attempt = $4',
            [
              missionId,
              execution.taskId,
              execution.agentId,
              execution.attempt,
              execution.status,
              execution.costUsd,
              payload,
            ],
          );

          if (existingRows[0]?.exact !== true) {
            throw new Error(
              'Execution conflict for ' +
                missionId +
                '#' +
                execution.taskId +
                '#' +
                execution.agentId +
                '#' +
                execution.attempt,
            );
          }
        }
      });
    },

    async appendEvents(events: OrchestratorEvent[]) {
      for (const event of events) {
        const inserted = await sql.unsafe(
          'insert into orchestrator_events ' +
          '(mission_id, sequence, type, task_id, agent_id, detail, at) ' +
          'values ($1, $2, $3, $4, $5, $6, $7) ' +
          'on conflict (mission_id, sequence) do nothing ' +
          'returning mission_id',
          [
            event.missionId,
            event.sequence,
            event.type,
            event.taskId ?? null,
            event.agentId ?? null,
            event.detail,
            event.at,
          ],
        );

        if (inserted.length > 0) continue;

        const existingRows = await sql.unsafe(
          'select type, task_id, agent_id, detail, at ' +
          'from orchestrator_events where mission_id = $1 and sequence = $2',
          [event.missionId, event.sequence],
        );

        const existing = existingRows[0] as unknown as
          | {
              type: string;
              task_id: string | null;
              agent_id: string | null;
              detail: string;
              at: Date | string;
            }
          | undefined;

        const existingAt = existing
          ? new Date(existing.at).toISOString()
          : null;
        const incomingAt = new Date(event.at).toISOString();

        const exactReplay =
          existing?.type === event.type &&
          existing.task_id === (event.taskId ?? null) &&
          existing.agent_id === (event.agentId ?? null) &&
          existing.detail === event.detail &&
          existingAt === incomingAt;

        if (!exactReplay) {
          throw new Error(
            'Orchestrator event conflict for ' +
              event.missionId +
              '#' +
              event.sequence,
          );
        }
      }
    },

    async saveExecutions(missionId: string, executions: AgentExecution[]) {
      for (const execution of executions) {
        await sql.unsafe(
          'insert into executions ' +
          '(mission_id, task_id, agent_id, attempt, status, cost_usd, payload) ' +
          'values ($1, $2, $3, $4, $5, $6, $7::jsonb) ' +
          'on conflict (mission_id, task_id, agent_id, attempt) do nothing',
          [
            missionId,
            execution.taskId,
            execution.agentId,
            execution.attempt,
            execution.status,
            execution.costUsd,
            JSON.stringify(execution),
          ],
        );
      }
    },

    async recordProductionOutcome(
      observation: DeploymentObservation,
      classification: {
        outcome: OutcomeKind;
        weight: number;
        reason: string;
      },
      trustObservation: TrustObservation,
    ) {
      const outcomePayload = {
        observation,
        classification,
      };
      const outcomeId = contentId(outcomePayload);
      const trustId = contentId(trustObservation);
      const key = contextKey(observation.context);

      await sql.begin(async (tx) => {
        await tx.unsafe(
          'insert into production_outcomes ' +
            '(id, agent_id, patch_sha, context_key, outcome, weight, reason, observed_until, payload) ' +
            'values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) ' +
            'on conflict (id) do nothing',
          [
            outcomeId,
            observation.agentId,
            observation.patchSha,
            key,
            classification.outcome,
            classification.weight,
            classification.reason,
            observation.observedUntil,
            JSON.stringify(outcomePayload),
          ],
        );

        await tx.unsafe(
          'insert into trust_observations ' +
            '(id, agent_id, context_key, repository, language, framework, task_class, risk_class, outcome, weight, at, payload) ' +
            'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb) ' +
            'on conflict (id) do nothing',
          [
            trustId,
            trustObservation.agentId,
            contextKey(trustObservation.context),
            trustObservation.context.repository,
            trustObservation.context.language,
            trustObservation.context.framework,
            trustObservation.context.taskClass,
            trustObservation.context.risk,
            trustObservation.outcome,
            trustObservation.weight ?? 1,
            trustObservation.at,
            JSON.stringify(trustObservation),
          ],
        );
      });

      return { outcomeId, trustObservationId: trustId };
    },

    async loadTrustObservations(): Promise<TrustObservation[]> {
      const rows = await sql.unsafe(
        'select payload from trust_observations order by at asc, id asc',
      );

      return rows.map((row) =>
        decodeJsonPayload<TrustObservation>(
          (row as unknown as { payload: unknown }).payload,
        ),
      );
    },

    async loadMissionReplay(missionId: string) {
      const missionRows = await sql.unsafe(
        'select payload from missions where id = $1',
        [missionId],
      );
      const missionRow = missionRows[0] as unknown as
        | { payload: Mission }
        | undefined;
      if (!missionRow) return null;

      const eventRows = await sql.unsafe(
        'select sequence, type, task_id, agent_id, detail, at ' +
          'from orchestrator_events where mission_id = $1 order by sequence asc',
        [missionId],
      );
      const executionRows = await sql.unsafe(
        'select payload from executions where mission_id = $1 ' +
          'order by task_id asc, agent_id asc, attempt asc',
        [missionId],
      );

      const events: OrchestratorEvent[] = eventRows.map((row) => {
        const value = row as unknown as {
          sequence: string | number;
          type: OrchestratorEvent['type'];
          task_id: string | null;
          agent_id: string | null;
          detail: string;
          at: Date | string;
        };
        return {
          sequence: Number(value.sequence),
          missionId,
          type: value.type,
          taskId: value.task_id ?? undefined,
          agentId: value.agent_id ?? undefined,
          detail: value.detail,
          at: new Date(value.at).toISOString(),
        };
      });

      const executions = executionRows.map((row) =>
        decodeJsonPayload<AgentExecution>(
          (row as unknown as { payload: unknown }).payload,
        ),
      );

      return {
        mission: decodeJsonPayload<Mission>(missionRow.payload),
        events,
        executions,
      };
    },

    async close() {
      await sql.end();
    },
  };
}

export type ArcheagentStore = ReturnType<typeof createArcheagentStore>;

export function createPostgresReplayStore(
  store: ArcheagentStore,
): ReplayStore {
  return {
    has: (leaseId) => store.hasConsumedReleaseLease(leaseId),
    consumeIfUnused: (leaseId) =>
      store.consumeReleaseLeaseIfUnused(leaseId),
  };
}
