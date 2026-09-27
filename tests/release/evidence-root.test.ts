import { describe, expect, it } from 'vitest';
import { evidenceMerkleRoot } from '../../src/core/release/evidence-root';

describe('evidence root', () => {
  it('is deterministic regardless of evidence input order', () => {
    expect(evidenceMerkleRoot(['b', 'a', 'c'])).toBe(
      evidenceMerkleRoot(['c', 'b', 'a']),
    );
  });

  it('changes when evidence changes', () => {
    expect(evidenceMerkleRoot(['a', 'b'])).not.toBe(
      evidenceMerkleRoot(['a', 'changed']),
    );
  });
});
