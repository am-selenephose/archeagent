import type { AgentRegistry } from '../agent-registry';
import type { AgentProfile, Mission, MissionTask } from '../types';
import {
  ContextualTrustGraph,
  type TrustContext,
} from './contextual-trust';

export type RoutingDecision = {
  agent: AgentProfile | null;
  context: TrustContext;
  candidates: Array<{
    agentId: string;
    contextualTrust: number;
    profileTrust: number;
    costUsd: number;
    latencyMs: number;
    score: number;
  }>;
};

function taskContext(mission: Mission, task: MissionTask): TrustContext {
  return {
    repository: mission.repository,
    language: task.language ?? 'unknown',
    framework: task.framework ?? 'unknown',
    taskClass:
      task.taskClass ??
      task.requires[0] ??
      'general',
    risk: task.risk,
  };
}

export class AdaptiveAgentRouter {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly trust: ContextualTrustGraph,
  ) {}

  choose(
    mission: Mission,
    task: MissionTask,
    remainingBudgetUsd: number,
  ): RoutingDecision {
    const context = taskContext(mission, task);

    const candidates = this.registry
      .list()
      .filter((agent) => agent.costPerTaskUsd <= remainingBudgetUsd)
      .filter((agent) =>
        task.requires.every((capability) =>
          agent.capabilities.includes(capability),
        ),
      )
      .map((agent) => {
        const contextualTrust = this.trust.score(
          agent.id,
          context,
        ).posterior.conservativeScore;

        const normalizedCost = Math.min(agent.costPerTaskUsd / 5, 1);
        const normalizedLatency = Math.min(
          agent.expectedLatencyMs / 120000,
          1,
        );

        const score =
          contextualTrust * 0.5 +
          agent.trustScore * 0.25 +
          (1 - normalizedCost) * 0.12 +
          (1 - normalizedLatency) * 0.13;

        return {
          agent,
          contextualTrust,
          profileTrust: agent.trustScore,
          costUsd: agent.costPerTaskUsd,
          latencyMs: agent.expectedLatencyMs,
          score,
        };
      })
      .sort((a, b) => b.score - a.score);

    return {
      agent: candidates[0]?.agent ?? null,
      context,
      candidates: candidates.map(({ agent, ...rest }) => ({
        agentId: agent.id,
        ...rest,
      })),
    };
  }
}
