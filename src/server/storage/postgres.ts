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
      await sql.unsafe(
        'insert into missions (id, repository, objective, budget_usd, payload) ' +
        'values ($1, $2, $3, $4, $5::jsonb) on conflict (id) do nothing',
        [
          mission.id,
          mission.repository,
          mission.objective,
          mission.budgetUsd,
          JSON.stringify(mission),
        ],
      );
    },

    async appendEvents(events: OrchestratorEvent[]) {
      for (const event of events) {
        await sql.unsafe(
          'insert into orchestrator_events ' +
          '(mission_id, sequence, type, task_id, agent_id, detail, at) ' +
          'values ($1, $2, $3, $4, $5, $6, $7) ' +
          'on conflict (mission_id, sequence) do nothing',
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
