export interface CardRuleAst {
  kind: 'card_rule';
  id: string;
  name: string;
  cardType?: string;
  timing: TimingAst;
  target: TargetAst;
  effects: EffectAst[];
  notes: string[];
  source: string;
}

export type TimingAst =
  | { kind: 'play_phase'; text: string }
  | { kind: 'sha_resolution_started'; text: string }
  | { kind: 'unknown'; text: string };

export type TargetAst =
  | { kind: 'self'; text: string }
  | { kind: 'single_other_in_attack_range'; text: string }
  | { kind: 'current_sha'; text: string }
  | { kind: 'none'; text: string }
  | { kind: 'unknown'; text: string };

export type EffectAst =
  | { kind: 'damage_target'; amount: number; text: string }
  | { kind: 'heal_self'; amount: number; text: string }
  | { kind: 'cancel_sha_resolution'; text: string }
  | { kind: 'unknown'; text: string };
