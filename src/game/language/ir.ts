import type { CardRuleAst } from './ast.ts';

export interface CardRuleIr {
  kind: 'card_rule_ir';
  id: string;
  name: string;
  cardType?: string;
  timing: TimingIr;
  target: TargetIr;
  instructions: CardInstructionIr[];
  playCost: CardPlayCostIr;
  ast: CardRuleAst;
}

export type TimingIr =
  | { op: 'require_play_phase' }
  | { op: 'require_sha_response_window' };

export type TargetIr =
  | { op: 'require_no_target' }
  | { op: 'require_self_target' }
  | { op: 'require_single_other_alive_target' }
  | { op: 'require_current_sha_target' };

export type CardInstructionIr =
  | { op: 'open_sha_response_frame'; damageAmount: number }
  | { op: 'emit_heal_self_action'; amount: number }
  | { op: 'emit_cancel_sha_resolution_action' };

export interface CardPlayCostIr {
  discardPlayedCard: boolean;
}
