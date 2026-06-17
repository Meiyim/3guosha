import type { LegalAction, PlayerObservation } from '../../game/types.ts';

export type AgentDecision = LegalAction | null;
export type AgentDecisionResult = AgentDecision | Promise<AgentDecision>;

export interface AgentAdapter {
  id: string;
  name: string;
  act(observation: PlayerObservation): AgentDecisionResult;
}
