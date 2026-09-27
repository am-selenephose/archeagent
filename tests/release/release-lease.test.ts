import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  consumeReleaseLease,
  issueReleaseLease,
  type ReplayStore,
} from '../../src/core/release/release-lease';

class MemoryReplayStore implements ReplayStore {
  private readonly used = new Set<string>();

  async has(leaseId: string) {
    return this.used.has(leaseId);
  }

  async consume(leaseId: string) {
    this.used.add(leaseId);
  }
}

describe('proof-carrying release lease', () => {
  it('binds authorization to exact code, policy, evidence and environment', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const now = new Date('2026-09-27T00:00:00Z');

    const lease = issueReleaseLease(
      privateKey,
      {
        repository: 'acme/billing',
        baseSha: 'base-123',
        patchSha: 'patch-456',
        policyHash: 'policy-789',
        evidenceRoot: 'evidence-abc',
        environment: 'production',
        expiresAt: '2026-09-27T00:10:00Z',
      },
      now,
    );

    const store = new MemoryReplayStore();
    const context = {
      repository: 'acme/billing',
      baseSha: 'base-123',
      patchSha: 'patch-456',
      policyHash: 'policy-789',
      evidenceRoot: 'evidence-abc',
      environment: 'production',
      now: new Date('2026-09-27T00:01:00Z'),
    };

    expect(
      (await consumeReleaseLease(lease, publicKey, context, store)).valid,
    ).toBe(true);

    const replay = await consumeReleaseLease(
      lease,
      publicKey,
      context,
      store,
    );

    expect(replay.valid).toBe(false);
    expect(replay.reasons).toContain('lease replay detected');
  });

  it('fails closed when base HEAD moves', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(
      privateKey,
      {
        repository: 'acme/billing',
        baseSha: 'base-123',
        patchSha: 'patch-456',
        policyHash: 'policy-789',
        evidenceRoot: 'evidence-abc',
        environment: 'production',
        expiresAt: '2026-09-27T00:10:00Z',
      },
      new Date('2026-09-27T00:00:00Z'),
    );

    const store = new MemoryReplayStore();
    const result = await consumeReleaseLease(
      lease,
      publicKey,
      {
        repository: 'acme/billing',
        baseSha: 'base-MOVED',
        patchSha: 'patch-456',
        policyHash: 'policy-789',
        evidenceRoot: 'evidence-abc',
        environment: 'production',
        now: new Date('2026-09-27T00:01:00Z'),
      },
      store,
    );

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('base HEAD moved');
  });
});
