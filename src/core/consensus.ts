export type JudgeVote = {
  judgeId: string;
  trustWeight: number;
  decision: 'accept' | 'reject' | 'abstain';
  reason: string;
};

export type ConsensusResult = {
  decision: 'accept' | 'reject' | 'inconclusive';
  acceptWeight: number;
  rejectWeight: number;
  quorumWeight: number;
  reasons: string[];
};

export function weightedConsensus(
  votes: JudgeVote[],
  quorumWeight = 1.5,
): ConsensusResult {
  const acceptWeight = votes
    .filter((vote) => vote.decision === 'accept')
    .reduce((sum, vote) => sum + vote.trustWeight, 0);

  const rejectWeight = votes
    .filter((vote) => vote.decision === 'reject')
    .reduce((sum, vote) => sum + vote.trustWeight, 0);

  let decision: ConsensusResult['decision'] = 'inconclusive';

  if (acceptWeight >= quorumWeight && acceptWeight > rejectWeight) {
    decision = 'accept';
  } else if (rejectWeight >= quorumWeight && rejectWeight >= acceptWeight) {
    decision = 'reject';
  }

  return {
    decision,
    acceptWeight,
    rejectWeight,
    quorumWeight,
    reasons: votes
      .filter((vote) => vote.decision !== 'abstain')
      .map((vote) => vote.judgeId + ': ' + vote.reason),
  };
}
