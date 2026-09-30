import type { AgentRegistry } from '../agent-registry';
import type { AgentProfile, Mission, MissionTask, RiskTier } from '../types';
import {
  ContextualTrustGraph,
  type TrustContext,
} from './contextual-trust';

export type RoutingCandidate = {
  agentId: string;
  contextualTrust: number;
  profileTrust: number;
  costUsd: number;
  latencyMs: number;
  successProbability: number;
  conservativeSuccessProbability: number;
  expectedFailureCostUsd: number;
  latencyCostUsd: number;
  expectedUtility: number;
  /**
   * Backwards-compatible display score. Routing is ordered by expectedUtility,
   * not by this field.
   */
  score: number;
};

export type RoutingDecision = {
  agent: AgentProfile | null;
  context: TrustContext;
  candidates: RoutingCandidate[];
};

type UtilityPolicy = {
  successValueUsd: number;
  failureCostUsd: number;
  latencyCostPerMinuteUsd: number;
};

const UTILITY_BY_RISK: Record<RiskTier, UtilityPolicy> = {
  low: {
    successValueUsd: 1,
    failureCostUsd: 0.5,
    latencyCostPerMinuteUsd: 0.01,
  },
  medium: {
    successValueUsd: 2,
    failureCostUsd: 2,
    latencyCostPerMinuteUsd: 0.02,
  },
  high: {
    successValueUsd: 5,
    failureCostUsd: 8,
    latencyCostPerMinuteUsd: 0.04,
  },
  critical: {
    successValueUsd: 12,
    failureCostUsd: 24,
    latencyCostPerMinuteUsd: 0.08,
  },
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

function empiricalProbability(
  agent: AgentProfile,
  graph: ContextualTrustGraph,
  context: TrustContext,
) {
  const estimate = graph.score(agent.id, context);

  if (estimate.source === 'prior') {
    return {
      source: 'profile-prior' as const,
      mean: agent.trustScore,
      conservative: agent.trustScore,
    };
  }

  return {
    source: estimate.source,
    mean: estimate.posterior.mean,
    conservative: estimate.posterior.conservativeScore,
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
    const utilityPolicy = UTILITY_BY_RISK[task.risk];

    const candidates = this.registry
      .list()
      .filter((agent) => agent.costPerTaskUsd <= remainingBudgetUsd)
      .filter((agent) =>
        task.requires.every((capability) =>
          agent.capabilities.includes(capability),
        ),
      )
      .map((agent) => {
        const posterior = this.trust.score(agent.id, context).posterior;
        const learned = empiricalProbability(agent, this.trust, context);
        const successProbability = learned.mean;
        const conservativeSuccessProbability = learned.conservative;

        const expectedFailureCostUsd =
          (1 - conservativeSuccessProbability) *
          utilityPolicy.failureCostUsd;
        const expectedSuccessValueUsd =
          conservativeSuccessProbability *
          utilityPolicy.successValueUsd;
        const latencyCostUsd =
          (agent.expectedLatencyMs / 60000) *
          utilityPolicy.latencyCostPerMinuteUsd;

        const expectedUtility =
          expectedSuccessValueUsd -
          expectedFailureCostUsd -
          agent.costPerTaskUsd -
          latencyCostUsd;

        return {
          agent,
          contextualTrust: posterior.conservativeScore,
          profileTrust: agent.trustScore,
          costUsd: agent.costPerTaskUsd,
          latencyMs: agent.expectedLatencyMs,
          successProbability,
          conservativeSuccessProbability,
          expectedFailureCostUsd,
          latencyCostUsd,
          expectedUtility,
          score: conservativeSuccessProbability,
        };
      })
      .sort((a, b) => {
        const utilityDelta = b.expectedUtility - a.expectedUtility;
        if (Math.abs(utilityDelta) > Number.EPSILON) return utilityDelta;

        const probabilityDelta =
          b.conservativeSuccessProbability -
          a.conservativeSuccessProbability;
        if (Math.abs(probabilityDelta) > Number.EPSILON) {
          return probabilityDelta;
        }

        return a.costUsd - b.costUsd;
      });

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
