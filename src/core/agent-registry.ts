import type { AgentProfile, MissionTask } from './types';

export class AgentRegistry {
  private readonly agents = new Map<string, AgentProfile>();

  register(agent: AgentProfile) {
    if (agent.trustScore < 0 || agent.trustScore > 1) {
      throw new Error('trustScore must be between 0 and 1');
    }
    this.agents.set(agent.id, agent);
  }

  list() {
    return [...this.agents.values()];
  }

  rankForTask(task: MissionTask, remainingBudgetUsd: number) {
    const required = new Set(task.requires);

    return this.list()
      .filter((agent) => agent.costPerTaskUsd <= remainingBudgetUsd)
      .filter((agent) =>
        [...required].every((capability) => agent.capabilities.includes(capability)),
      )
      .map((agent) => {
        const capabilityCoverage =
          task.requires.length === 0
            ? 1
            : task.requires.filter((capability) =>
                agent.capabilities.includes(capability),
              ).length / task.requires.length;

        const normalizedCost = Math.min(agent.costPerTaskUsd / 5, 1);
        const normalizedLatency = Math.min(agent.expectedLatencyMs / 120000, 1);

        const score =
          agent.trustScore * 0.5 +
          capabilityCoverage * 0.3 +
          (1 - normalizedCost) * 0.1 +
          (1 - normalizedLatency) * 0.1;

        return { agent, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  choose(task: MissionTask, remainingBudgetUsd: number) {
    return this.rankForTask(task, remainingBudgetUsd)[0]?.agent ?? null;
  }
}
