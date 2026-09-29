import {
  classifyDeploymentOutcome,
  type DeploymentObservation,
} from '../../core/intelligence/production-outcome';
import type { TrustObservation } from '../../core/intelligence/contextual-trust';
import type { ArcheagentStore } from '../storage/postgres';

export class ProductionFeedbackService {
  constructor(private readonly store: ArcheagentStore) {}

  async record(observation: DeploymentObservation) {
    const classification = classifyDeploymentOutcome(observation);

    if (!classification) {
      return {
        accepted: false as const,
        reason: 'outcome attribution did not meet evidence threshold',
      };
    }

    const trustObservation: TrustObservation = {
      agentId: observation.agentId,
      context: observation.context,
      outcome: classification.outcome,
      weight: classification.weight,
      at: observation.observedUntil,
    };

    const ids = await this.store.recordProductionOutcome(
      observation,
      classification,
      trustObservation,
    );

    return {
      accepted: true as const,
      ...classification,
      ...ids,
    };
  }
}
