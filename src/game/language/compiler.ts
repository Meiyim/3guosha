import type { CardPlayAction } from '../core/action.ts';
import type { CardRule } from '../core/cards.ts';
import { emptyResolutionResult } from '../core/resolution.ts';
import type { ActionResolutionResult } from '../core/resolution.ts';
import { getCurrentPlayer, getPlayer, type PlayerState } from '../core/state.ts';
import type { RuleRuntimeContext } from '../core/rule_module.ts';
import type { CardRuleAst, EffectAst, TargetAst, TimingAst } from './ast.ts';
import type { CardInstructionIr, CardRuleIr, TargetIr, TimingIr } from './ir.ts';

export function compileCardAstToIr(ast: CardRuleAst): CardRuleIr {
  return {
    kind: 'card_rule_ir',
    id: ast.id,
    name: ast.name,
    cardType: ast.cardType,
    timing: compileTiming(ast.timing),
    target: compileTarget(ast.target),
    instructions: ast.effects.map(effect => compileEffect(ast, effect)),
    playCost: { discardPlayedCard: true },
    ast,
  };
}

export function compileCardIrToRule(ir: CardRuleIr): CardRule {
  return {
    id: ir.id,
    canPlay(ctx, player, action) {
      if (!player.hand.includes(action.cardInstanceId)) return false;
      return checkTiming(ir.timing, ctx, player)
        && checkTarget(ir.target, ctx, player, action);
    },
    onPlay(ctx, player, action) {
      return executeCardInstructions(ir, ctx, player, action);
    },
  };
}

function compileTiming(timing: TimingAst): TimingIr {
  switch (timing.kind) {
    case 'play_phase':
      return { op: 'require_play_phase' };
    case 'sha_resolution_started':
      return { op: 'require_sha_response_window' };
    case 'unknown':
      throw new Error(`unsupported 3gs timing: ${timing.text}`);
  }
}

function compileTarget(target: TargetAst): TargetIr {
  switch (target.kind) {
    case 'none':
      return { op: 'require_no_target' };
    case 'self':
      return { op: 'require_self_target' };
    case 'single_other_in_attack_range':
      return { op: 'require_single_other_alive_target' };
    case 'current_sha':
      return { op: 'require_current_sha_target' };
    case 'unknown':
      throw new Error(`unsupported 3gs target: ${target.text}`);
  }
}

function compileEffect(ast: CardRuleAst, effect: EffectAst): CardInstructionIr {
  switch (effect.kind) {
    case 'damage_target':
      if (ast.name !== '杀') {
        throw new Error(`damage target effect is only compiled for 杀 for now: ${effect.text}`);
      }
      return { op: 'open_sha_response_frame', damageAmount: effect.amount };
    case 'heal_self':
      return { op: 'emit_heal_self_action', amount: effect.amount };
    case 'cancel_sha_resolution':
      return { op: 'emit_cancel_sha_resolution_action' };
    case 'unknown':
      throw new Error(`unsupported 3gs effect: ${effect.text}`);
  }
}

function checkTiming(timing: TimingIr, ctx: RuleRuntimeContext, player: PlayerState): boolean {
  switch (timing.op) {
    case 'require_play_phase': {
      const current = getCurrentPlayer(ctx.state);
      return ctx.state.phase === 'play' && current?.id === player.id;
    }
    case 'require_sha_response_window': {
      const frame = ctx.activeFrame ?? ctx.state.resolutionStack[ctx.state.resolutionStack.length - 1];
      return frame?.criterion.type === 'action_response'
        && frame.criterion.playerId === player.id
        && frame.criterion.actionTypes.includes('cancel_sha_resolution');
    }
  }
}

function checkTarget(
  target: TargetIr,
  ctx: RuleRuntimeContext,
  player: PlayerState,
  action: CardPlayAction,
): boolean {
  switch (target.op) {
    case 'require_no_target':
    case 'require_self_target':
    case 'require_current_sha_target':
      return action.targets.length === 0;
    case 'require_single_other_alive_target': {
      const [targetId] = action.targets;
      const targetPlayer = targetId ? getPlayer(ctx.state, targetId) : undefined;
      return !!targetPlayer && targetPlayer.alive && targetPlayer.id !== player.id;
    }
  }
}

function executeCardInstructions(
  ir: CardRuleIr,
  ctx: RuleRuntimeContext,
  player: PlayerState,
  action: CardPlayAction,
): ActionResolutionResult {
  const result = emptyResolutionResult();

  for (const instruction of ir.instructions) {
    switch (instruction.op) {
      case 'open_sha_response_frame': {
        const targetId = action.targets[0];
        result.frames.push({
          id: ctx.nextFrameId(),
          sourceAction: action,
          participants: [{ playerId: targetId }],
          cursor: 0,
          criterion: {
            type: 'action_response',
            playerId: targetId,
            actionTypes: ['cancel_sha_resolution'],
            passAllowed: true,
            successWhen: 'not_responded',
          },
          result: {
            success: [{
              type: 'damage',
              sourcePlayerId: player.id,
              targetPlayerId: targetId,
              amount: instruction.damageAmount,
            }],
            failure: [],
            always: ir.playCost.discardPlayedCard
              ? [{ type: 'card_discard', playerId: player.id, cardInstanceId: action.cardInstanceId }]
              : [],
          },
          context: { cardId: ir.id, sourcePlayerId: player.id, targetPlayerId: targetId },
        });
        break;
      }
      case 'emit_heal_self_action':
        result.actions.push({ type: 'heal', playerId: player.id, amount: instruction.amount });
        break;
      case 'emit_cancel_sha_resolution_action':
        result.actions.push({ type: 'cancel_sha_resolution', playerId: player.id });
        break;
    }
  }

  if (ir.playCost.discardPlayedCard && result.frames.length === 0) {
    result.actions.push({ type: 'card_discard', playerId: player.id, cardInstanceId: action.cardInstanceId });
  }

  return result;
}
