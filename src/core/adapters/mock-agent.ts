import { createHash } from 'node:crypto';
import type { AgentExecution, EvidenceArtifact } from '../types';
import type { AgentAdapter, AgentExecutionContext } from './agent';

function evidence(
  context: AgentExecutionContext,
  kind: EvidenceArtifact['kind'],
  passed: boolean,
  payload: unknown,
): EvidenceArtifact {
  const canonical = JSON.stringify({
    taskId: context.task.id,
    agentId: context.agent.id,
    attempt: context.attempt,
    kind,
    passed,
    payload,
  });

  const sha256 = createHash('sha256').update(canonical).digest('hex');

  return {
    id: sha256.slice(0, 16),
    taskId: context.task.id,
    kind,
    source: context.agent.id,
    passed,
    payload,
    sha256,
    createdAt: new Date().toISOString(),
  };
}

export class MockAgentAdapter implements AgentAdapter {
  async execute(context: AgentExecutionContext): Promise<AgentExecution> {
    const startedAt = new Date().toISOString();
    const riskPenalty =
      context.task.risk === 'critical'
        ? 0.22
        : context.task.risk === 'high'
          ? 0.12
          : 0;

    const effectiveTrust = context.agent.trustScore - riskPenalty;
    const passed = effectiveTrust >= 0.7;

    const artifacts = [
      evidence(context, 'test', passed, {
        suite: 'core-regression',
        passed: passed ? 38 : 35,
        failed: passed ? 0 : 3,
      }),
      evidence(context, 'review', passed, {
        capabilityMatch: context.task.requires,
        effectiveTrust,
      }),
    ];

    return {
      taskId: context.task.id,
      agentId: context.agent.id,
      attempt: context.attempt,
      startedAt,
      completedAt: new Date().toISOString(),
      status: passed ? 'passed' : 'failed',
      costUsd: context.agent.costPerTaskUsd,
      summary: passed
        ? 'task completed with reproducible evidence'
        : 'task failed the deterministic trust and evidence simulation',
      evidence: artifacts,
    };
  }
}
