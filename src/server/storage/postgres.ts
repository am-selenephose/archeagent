import postgres from 'postgres';
import type {
  AgentExecution,
  Mission,
  OrchestratorEvent,
} from '../../core/types';

export function createArcheagentStore(databaseUrl: string) {
  const sql = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return {
    async migrate() {
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
        throw new Error('Mission conflict for ' + mission.id);
      }
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

    async close() {
      await sql.end();
    },
  };
}
