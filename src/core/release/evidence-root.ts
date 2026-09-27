import { createHash } from 'node:crypto';

function hash(left: string, right: string) {
  return createHash('sha256')
    .update(left + ':' + right)
    .digest('hex');
}

export function evidenceMerkleRoot(hashes: string[]) {
  if (hashes.length === 0) {
    return createHash('sha256').update('archeagent:empty').digest('hex');
  }

  let level = [...new Set(hashes)].sort();

  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      next.push(hash(left, right));
    }
    level = next;
  }

  return level[0];
}
