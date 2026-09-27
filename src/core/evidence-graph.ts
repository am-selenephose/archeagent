import { createHash } from 'node:crypto';
import type { EvidenceArtifact } from './types';

type EvidenceInput = Omit<EvidenceArtifact, 'id' | 'sha256' | 'createdAt'>;

export class EvidenceGraph {
  private readonly artifacts = new Map<string, EvidenceArtifact>();
  private readonly edges = new Map<string, Set<string>>();

  add(input: EvidenceInput) {
    const canonical = JSON.stringify({
      taskId: input.taskId,
      kind: input.kind,
      source: input.source,
      passed: input.passed,
      payload: input.payload,
    });

    const sha256 = createHash('sha256').update(canonical).digest('hex');
    const id = sha256.slice(0, 16);

    const artifact: EvidenceArtifact = {
      ...input,
      id,
      sha256,
      createdAt: new Date().toISOString(),
    };

    this.artifacts.set(id, artifact);
    return artifact;
  }

  link(parentId: string, childId: string) {
    if (!this.artifacts.has(parentId) || !this.artifacts.has(childId)) {
      throw new Error('cannot link missing evidence node');
    }

    const children = this.edges.get(parentId) ?? new Set<string>();
    children.add(childId);
    this.edges.set(parentId, children);
  }

  list() {
    return [...this.artifacts.values()];
  }

  forTask(taskId: string) {
    return this.list().filter((artifact) => artifact.taskId === taskId);
  }

  childrenOf(id: string) {
    return [...(this.edges.get(id) ?? new Set<string>())]
      .map((childId) => this.artifacts.get(childId))
      .filter((artifact): artifact is EvidenceArtifact => Boolean(artifact));
  }

  allPassingForTask(taskId: string) {
    const taskEvidence = this.forTask(taskId);
    return taskEvidence.length > 0 && taskEvidence.every((artifact) => artifact.passed);
  }
}
