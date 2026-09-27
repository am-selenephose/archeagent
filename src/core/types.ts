export type Capability =
  | 'frontend'
  | 'backend'
  | 'database'
  | 'security'
  | 'testing'
  | 'performance'
  | 'migration'
  | 'architecture'
  | 'documentation';

export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export type AgentProfile = {
  id: string;
  name: string;
  provider: string;
  model: string;
  capabilities: Capability[];
  trustScore: number;
  costPerTaskUsd: number;
  expectedLatencyMs: number;
  maxConcurrency: number;
};

export type MissionTask = {
  id: string;
  title: string;
  description: string;
  requires: Capability[];
  dependsOn: string[];
  risk: RiskTier;
  maxAttempts: number;
  language?: string;
  framework?: string;
  taskClass?: string;
};

export type Mission = {
  id: string;
  repository: string;
  objective: string;
  budgetUsd: number;
  tasks: MissionTask[];
};

export type AgentExecution = {
  taskId: string;
  agentId: string;
  attempt: number;
  startedAt: string;
  completedAt: string;
  status: 'passed' | 'failed';
  costUsd: number;
  summary: string;
  evidence: EvidenceArtifact[];
};

export type EvidenceArtifact = {
  id: string;
  taskId: string;
  kind:
    | 'test'
    | 'contract'
    | 'security'
    | 'migration'
    | 'performance'
    | 'runtime'
    | 'review';
  source: string;
  passed: boolean;
  payload: unknown;
  sha256: string;
  createdAt: string;
};

export type OrchestratorEvent = {
  sequence: number;
  missionId: string;
  type:
    | 'mission.started'
    | 'task.ready'
    | 'task.assigned'
    | 'task.retry'
    | 'task.completed'
    | 'task.failed'
    | 'budget.exhausted'
    | 'approval.required'
    | 'mission.completed'
    | 'mission.failed';
  taskId?: string;
  agentId?: string;
  detail: string;
  at: string;
};

export type PolicyDecision = {
  allowed: boolean;
  requiresHumanApproval: boolean;
  reasons: string[];
};

export type MissionResult = {
  mission: Mission;
  status: 'completed' | 'failed' | 'approval_required';
  costUsd: number;
  executions: AgentExecution[];
  events: OrchestratorEvent[];
  readyForMerge: boolean;
};
