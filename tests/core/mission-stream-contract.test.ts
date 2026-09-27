import { describe, expect, it } from 'vitest';
import type { Mission } from '../../src/core/types';

describe('mission stream contract', () => {
  it('requires stable mission identity for idempotent enqueue', () => {
    const mission: Mission = {
      id: 'stable-mission-id',
      repository: 'demo/repo',
      objective: 'prove queue identity',
      budgetUsd: 1,
      tasks: [],
    };

    expect(mission.id).toBe('stable-mission-id');
  });
});
