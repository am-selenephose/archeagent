import type {
  AgentExecution,
  AgentProfile,
  Mission,
  MissionTask,
} from '../types';

export type AgentExecutionContext = {
  mission: Mission;
  task: MissionTask;
  agent: AgentProfile;
  attempt: number;
};

export interface AgentAdapter {
  execute(context: AgentExecutionContext): Promise<AgentExecution>;
}
