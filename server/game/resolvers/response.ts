import { ResolverType, WaitingType, type PlayerState, type ResolutionItem, type WaitingAction } from '../types.ts';
import type { ResolverContext, ResponseResolver } from './types.ts';

export const responseResolvers: Partial<Record<WaitingType, ResponseResolver>> = {
  [WaitingType.RESPOND_ATTACK]: resolveAttackResponse,
  [WaitingType.RESPOND_DUEL]: resolveDuelResponse,
  [WaitingType.RESPOND_BARBARIAN]: resolveBarbarianResponse,
  [WaitingType.RESPOND_RESCUE]: resolveRescueResponse,
};

function resolveAttackResponse(ctx: ResolverContext, item: ResolutionItem, player: PlayerState, cardUid: number | null): WaitingAction | null {
  if (cardUid !== null) {
    const idx = player.hand.findIndex(c => c.uid === cardUid);
    if (idx !== -1 && player.hand[idx].def.id === 'shan') {
      ctx.useCard(player, idx);
      ctx.log(`${player.name} 使用了闪`);
      return ctx.waitingFor;
    }
  }
  ctx.dealDamage(player, 1, item.data?.source, { card: item.data?.card });
  return ctx.waitingFor;
}

function resolveDuelResponse(ctx: ResolverContext, item: ResolutionItem, player: PlayerState, cardUid: number | null): WaitingAction | null {
  if (cardUid !== null) {
    const idx = player.hand.findIndex(c => c.uid === cardUid);
    if (idx !== -1 && ctx.isValidAttackResponse(player, player.hand[idx])) {
      ctx.useCard(player, idx);
      ctx.log(`${player.name} 出杀`);
      const opponent = ctx.getPlayer(item.data.opponent)!;
      ctx.pushResolution(WaitingType.RESPOND_DUEL, opponent.id, ResolverType.DUEL, { opponent: player.id, source: item.data.source, card: item.data.card });
      return ctx.waitingFor;
    }
  }
  ctx.dealDamage(player, 1, item.data?.source, { card: item.data?.card });
  return ctx.waitingFor;
}

function resolveBarbarianResponse(ctx: ResolverContext, item: ResolutionItem, player: PlayerState, cardUid: number | null): WaitingAction | null {
  const nextTarget = item.data.remaining.find((id: string) => ctx.getPlayer(id)?.alive);
  const afterRescue = nextTarget
    ? { playerId: nextTarget, type: WaitingType.RESPOND_BARBARIAN, data: { ...item.data, remaining: item.data.remaining.filter((id: string) => id !== nextTarget) } }
    : undefined;
  let damageTaken = false;
  if (cardUid !== null) {
    const idx = player.hand.findIndex(c => c.uid === cardUid);
    const needShan = item.data?.needShan;
    if (idx !== -1) {
      const card = player.hand[idx];
      const valid = needShan ? card.def.id === 'shan' : ctx.isValidAttackResponse(player, card);
      if (valid) { ctx.useCard(player, idx); ctx.log(`${player.name} 响应成功`); }
      else { damageTaken = true; ctx.dealDamage(player, 1, item.data?.source, { card: item.data?.card, afterRescue }); }
    } else { damageTaken = true; ctx.dealDamage(player, 1, item.data?.source, { card: item.data?.card, afterRescue }); }
  } else { damageTaken = true; ctx.dealDamage(player, 1, item.data?.source, { card: item.data?.card, afterRescue }); }

  if (!damageTaken && afterRescue) ctx.pushResolution(afterRescue.type, afterRescue.playerId, ResolverType.BARBARIAN, afterRescue.data);
  return ctx.waitingFor;
}

function resolveRescueResponse(ctx: ResolverContext, item: ResolutionItem, player: PlayerState, cardUid: number | null): WaitingAction | null {
  const dying = ctx.getPlayer(item.data.dyingPlayerId);
  if (!dying || !dying.alive || dying.hp > 0) {
    ctx.continueAfterRescue(item.data.afterRescue);
    return ctx.waitingFor;
  }

  if (cardUid !== null) {
    const idx = player.hand.findIndex(c => c.uid === cardUid);
    if (idx !== -1 && player.hand[idx].def.id === 'tao') {
      ctx.useCard(player, idx);
      dying.hp = Math.min(dying.hp + 1, dying.maxHp);
      ctx.log(`${player.name} 使用桃救援 ${dying.name}，${dying.name} 当前${dying.hp}点体力`);
      if (dying.hp > 0) {
        ctx.log(`${dying.name} 脱离濒死`);
        ctx.continueAfterRescue(item.data.afterRescue);
      } else {
        ctx.beginRescue(dying, item.data.source, item.data.afterRescue);
      }
      return ctx.waitingFor;
    }
  }

  const remaining = item.data.remaining.filter((id: string) => ctx.getPlayer(id)?.alive);
  if (remaining.length > 0) {
    const next = remaining[0];
    ctx.pushResolution(WaitingType.RESPOND_RESCUE, next, ResolverType.RESCUE, {
      ...item.data,
      remaining: remaining.slice(1),
    });
  } else {
    ctx.finalizeDeath(dying);
    ctx.continueAfterRescue(item.data.afterRescue);
  }
  return ctx.waitingFor;
}
