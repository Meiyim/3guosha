import type { CardRule } from './cards.ts';
import type { ActionResolutionResult, ResolutionFrame } from './resolution.ts';
import type { Action, PlayerAction } from './action.ts';
import type { GameState } from './state.ts';
import type { CardRuleAst } from '../language/ast.ts';
import type { CardRuleIr } from '../language/ir.ts';

export type RuleModuleKind = 'card' | 'hero';
export type TimingEventType = 'sha_resolution_started';

export interface CardResourceSource {
  id: string;
  kind: 'card';
  source: string;
}

export interface RuleRuntimeContext {
  state: GameState;
  nextFrameId(): string;
  activeFrame?: ResolutionFrame;
}

export interface TimingEvent {
  type: TimingEventType;
  playerId: string;
  sourceAction: Action;
  frameId?: string;
}

export interface RuleFunction {
  (ctx: RuleRuntimeContext, action: Action): ActionResolutionResult;
}

export interface TimingRuleFunction {
  timing: TimingEventType;
  canUse(ctx: RuleRuntimeContext, action: PlayerAction, event: TimingEvent): boolean;
  onUse(ctx: RuleRuntimeContext, action: PlayerAction, event: TimingEvent): ActionResolutionResult;
}

export interface CompiledRuleModule {
  id: string;
  kind: RuleModuleKind;
  ast?: CardRuleAst;
  ir?: CardRuleIr;
  cardRule?: CardRule;
  timingFunctions: TimingRuleFunction[];
  source: string;
}
