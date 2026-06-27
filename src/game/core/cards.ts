import type { CardPlayAction } from './action.ts';
import type { GameState, PlayerState } from './state.ts';
import type { ActionResolutionResult } from './resolution.ts';
import type { RuleRuntimeContext } from './rule_module.ts';

export interface CardRuleContext extends RuleRuntimeContext {
  state: GameState;
  nextFrameId(): string;
}

export interface CardRule {
  id: string;
  canPlay(ctx: CardRuleContext, player: PlayerState, action: CardPlayAction): boolean;
  onPlay(ctx: CardRuleContext, player: PlayerState, action: CardPlayAction): ActionResolutionResult;
}
