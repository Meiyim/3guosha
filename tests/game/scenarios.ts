import type { GameScenario } from './harness.ts';
import { endPhaseNextTurnScenario } from './cases/end_phase_next_turn.ts';
import { shaBlockedByShanScenario } from './cases/sha_blocked_by_shan.ts';
import { shaPassDamageScenario } from './cases/sha_pass_damage.ts';
import { taoHealsSelfScenario } from './cases/tao_heals_self.ts';

export const scenarios: GameScenario[] = [
  shaBlockedByShanScenario,
  shaPassDamageScenario,
  taoHealsSelfScenario,
  endPhaseNextTurnScenario,
];

export function findScenario(id: string): GameScenario | undefined {
  return scenarios.find(scenario => scenario.id === id);
}
