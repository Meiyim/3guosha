import type { PlayerAction } from './action.ts';
import type { CardRule } from './cards.ts';
import type { ActionResolutionResult, ResolutionFrame } from './resolution.ts';
import { emptyResolutionResult } from './resolution.ts';
import { getPlayer, type PlayerState } from './state.ts';
import type {
  CardResourceSource,
  CompiledRuleModule,
  RuleRuntimeContext,
  TimingEvent,
} from './rule_module.ts';
import { compileCardAstToIr, compileCardIrToRule } from '../language/compiler.ts';
import { parseCardRuleSource } from '../language/parser.ts';

export class RuleInterpreter {
  private modules = new Map<string, CompiledRuleModule>();

  loadCardResource(source: CardResourceSource): void {
    this.modules.set(source.id, compileCardResource(source));
  }

  getCardRule(cardId: string): CardRule | undefined {
    return this.modules.get(cardId)?.cardRule;
  }

  getCompiledModule(id: string): CompiledRuleModule | undefined {
    return this.modules.get(id);
  }

  listCompiledModules(): CompiledRuleModule[] {
    return [...this.modules.values()];
  }

  canPlayCard(ctx: RuleRuntimeContext, player: PlayerState, action: Extract<PlayerAction, { type: 'card_play' }>): boolean {
    return this.getCardRule(action.cardId)?.canPlay(ctx, player, action) ?? false;
  }

  interpretPlayerAction(ctx: RuleRuntimeContext, action: PlayerAction): ActionResolutionResult {
    if (action.type !== 'card_play') return emptyResolutionResult();
    const player = getPlayer(ctx.state, action.playerId);
    const rule = this.getCardRule(action.cardId);
    if (!player || !rule || !rule.canPlay(ctx, player, action)) return emptyResolutionResult();
    return rule.onPlay(ctx, player, action);
  }

  interpretTimingWindow(_ctx: RuleRuntimeContext, _event: TimingEvent): ResolutionFrame[] {
    return [];
  }
}

function compileCardResource(resource: CardResourceSource): CompiledRuleModule {
  const ast = parseCardRuleSource(resource.id, resource.source);
  const ir = compileCardAstToIr(ast);
  return {
    id: resource.id,
    kind: 'card',
    ast,
    ir,
    cardRule: compileCardIrToRule(ir),
    timingFunctions: [],
    source: resource.source,
  };
}
