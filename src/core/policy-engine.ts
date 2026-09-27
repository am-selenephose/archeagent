import type {
  AgentProfile,
  Mission,
  MissionTask,
  PolicyDecision,
} from './types';

export type PolicyContext = {
  mission: Mission;
  task: MissionTask;
  agent: AgentProfile;
  spentUsd: number;
  attempts: number;
};

export function evaluatePolicy(context: PolicyContext): PolicyDecision {
  const reasons: string[] = [];
  let allowed = true;
  let requiresHumanApproval = false;

  if (context.spentUsd + context.agent.costPerTaskUsd > context.mission.budgetUsd) {
    allowed = false;
    reasons.push('mission budget would be exceeded');
  }

  if (context.attempts >= context.task.maxAttempts) {
    allowed = false;
    reasons.push('task retry budget exhausted');
  }

  if (
    context.task.risk === 'critical' &&
    context.agent.trustScore < 0.9
  ) {
    allowed = false;
    reasons.push('critical task requires agent trust score of at least 0.90');
  }

  if (
    context.task.risk === 'high' ||
    context.task.risk === 'critical' ||
    context.task.requires.includes('security')
  ) {
    requiresHumanApproval = true;
    reasons.push('risk policy requires human approval before merge');
  }

  return {
    allowed,
    requiresHumanApproval,
    reasons,
  };
}
