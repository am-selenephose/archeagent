import { AgentRegistry } from './agent-registry';
import type { AgentAdapter } from './adapters/agent';
import { EvidenceGraph } from './evidence-graph';
import { evaluatePolicy } from './policy-engine';
import { TaskGraph } from './task-graph';
import type { AdaptiveAgentRouter } from './intelligence/adaptive-router';
import type {
  Mission,
  MissionResult,
  OrchestratorEvent,
} from './types';

export class ArcheagentOrchestrator {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly adapter: AgentAdapter,
    private readonly adaptiveRouter?: AdaptiveAgentRouter,
  ) {}

  async run(mission: Mission): Promise<MissionResult> {
    let sequence = 0;
    const event = (
      type: OrchestratorEvent['type'],
      detail: string,
      extra: Pick<OrchestratorEvent, 'taskId' | 'agentId'> = {},
    ): OrchestratorEvent => ({
      sequence: ++sequence,
      missionId: mission.id,
      type,
      detail,
      taskId: extra.taskId,
      agentId: extra.agentId,
      at: new Date().toISOString(),
    });

    const graph = new TaskGraph(mission.tasks);
    const evidence = new EvidenceGraph();
    const executions = [];
    const events: OrchestratorEvent[] = [];
    const completed = new Set<string>();
    const failed = new Set<string>();
    const attempts = new Map<string, number>();
    let spentUsd = 0;
    let approvalRequired = false;

    events.push(
      event(
        'mission.started',
        'mission accepted by Archeagent control plane',
      ),
    );

    const ordered = graph.topologicalOrder();

    for (const task of ordered) {
      if (task.dependsOn.some((dependency) => failed.has(dependency))) {
        failed.add(task.id);
        events.push(
          event(
            'task.failed',
            'dependency failed, task was not scheduled',
            { taskId: task.id },
          ),
        );
        continue;
      }

      events.push(
        event('task.ready', 'task dependencies satisfied', {
          taskId: task.id,
        }),
      );

      let taskPassed = false;

      while (!taskPassed) {
        const currentAttempts = attempts.get(task.id) ?? 0;
        const remainingBudget = mission.budgetUsd - spentUsd;
        const adaptiveDecision = this.adaptiveRouter?.choose(
          mission,
          task,
          remainingBudget,
        );
        const agent =
          adaptiveDecision?.agent ??
          this.registry.choose(task, remainingBudget);

        if (!agent) {
          failed.add(task.id);
          events.push(
            event(
              'task.failed',
              'no eligible agent fits capability and budget constraints',
              { taskId: task.id },
            ),
          );
          break;
        }

        const policy = evaluatePolicy({
          mission,
          task,
          agent,
          spentUsd,
          attempts: currentAttempts,
        });

        if (!policy.allowed) {
          failed.add(task.id);
          events.push(
            event(
              spentUsd >= mission.budgetUsd
                ? 'budget.exhausted'
                : 'task.failed',
              policy.reasons.join('; ') || 'policy denied execution',
              { taskId: task.id, agentId: agent.id },
            ),
          );
          break;
        }

        if (policy.requiresHumanApproval) {
          approvalRequired = true;
          events.push(
            event(
              'approval.required',
              policy.reasons.join('; '),
              { taskId: task.id, agentId: agent.id },
            ),
          );
        }

        const attempt = currentAttempts + 1;
        attempts.set(task.id, attempt);

        events.push(
          event(
            'task.assigned',
            adaptiveDecision
              ? 'task routed by contextual production trust, capability, cost and latency'
              : 'task routed by capability, profile trust, cost and latency score',
            { taskId: task.id, agentId: agent.id },
          ),
        );

        const execution = await this.adapter.execute({
          mission,
          task,
          agent,
          attempt,
        });

        executions.push(execution);
        spentUsd += execution.costUsd;

        for (const artifact of execution.evidence) {
          evidence.add({
            taskId: artifact.taskId,
            kind: artifact.kind,
            source: artifact.source,
            passed: artifact.passed,
            payload: artifact.payload,
          });
        }

        if (execution.status === 'passed' && evidence.allPassingForTask(task.id)) {
          completed.add(task.id);
          taskPassed = true;
          events.push(
            event(
              'task.completed',
              execution.summary,
              { taskId: task.id, agentId: agent.id },
            ),
          );
          continue;
        }

        if (attempt < task.maxAttempts) {
          events.push(
            event(
              'task.retry',
              'task failed evidence checks and will be retried',
              { taskId: task.id, agentId: agent.id },
            ),
          );
          continue;
        }

        failed.add(task.id);
        events.push(
          event(
            'task.failed',
            'task exhausted retry budget',
            { taskId: task.id, agentId: agent.id },
          ),
        );
        break;
      }
    }

    const allCompleted = completed.size === mission.tasks.length;
    const status: MissionResult['status'] =
      failed.size > 0
        ? 'failed'
        : approvalRequired
          ? 'approval_required'
          : 'completed';

    events.push(
      event(
        failed.size > 0 ? 'mission.failed' : 'mission.completed',
        failed.size > 0
          ? 'one or more tasks failed release policy'
          : 'all tasks completed with evidence',
      ),
    );

    return {
      mission,
      status,
      costUsd: Number(spentUsd.toFixed(4)),
      executions,
      events,
      readyForMerge: allCompleted && !approvalRequired && failed.size === 0,
    };
  }
}
