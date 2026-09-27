import { createHash } from 'node:crypto';
import type { AgentProfile } from '../types';
import type { TrustContext } from './contextual-trust';
import { ContextualTrustGraph } from './contextual-trust';

export type TournamentAssignment = {
  primary: AgentProfile;
  shadows: AgentProfile[];
  reason: string;
};

function deterministicUnit(seed: string) {
  const digest = createHash('sha256').update(seed).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

export function assignTournament(
  agents: AgentProfile[],
  trust: ContextualTrustGraph,
  context: TrustContext,
  seed: string,
  explorationRate = 0.15,
): TournamentAssignment {
  if (agents.length === 0) {
    throw new Error('at least one agent is required');
  }

  const ranked = agents
    .map((agent) => ({
      agent,
      trust: trust.score(agent.id, context).posterior.conservativeScore,
    }))
    .sort((a, b) => b.trust - a.trust);

  const explore =
    agents.length > 1 && deterministicUnit(seed) < explorationRate;

  const primary = explore ? ranked[1].agent : ranked[0].agent;
  const shadows = ranked
    .filter((item) => item.agent.id !== primary.id)
    .slice(0, Math.min(2, agents.length - 1))
    .map((item) => item.agent);

  return {
    primary,
    shadows,
    reason: explore
      ? 'counterfactual exploration selected a non-top agent while preserving shadow comparators'
      : 'contextual conservative trust selected the primary agent',
  };
}
