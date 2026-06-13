import { WaitingType, TargetType, type GameContext, type PlayerState, type CardInstance, type WaitingAction, type CardHandler } from '../types.ts';
import { registerCard } from './index.ts';

const juedouHandler: CardHandler = {
  targetType: TargetType.SINGLE,
  onPlay(ctx, player, card, cardIdx, targetId) {
    const target = targetId ? ctx.getPlayer(targetId) : ctx.getOpponent(player);
    if (!target || !target.alive || target.id === player.id) return null;
    ctx.useCard(player, cardIdx);
    ctx.log(`${player.name} 对 ${target.name} 使用了决斗`);
    ctx.setWaiting({ playerId: target.id, type: WaitingType.RESPOND_DUEL, data: { opponent: player.id, source: player.id } });
    return ctx.waitingFor;
  }
};

const nanmanHandler: CardHandler = {
  targetType: TargetType.ALL_OTHERS,
  onPlay(ctx, player, card, cardIdx) {
    ctx.useCard(player, cardIdx);
    ctx.log(`${player.name} 使用了南蛮入侵`);
    const targets = ctx.state.players.filter(p => p.id !== player.id && p.alive).map(p => p.id);
    if (targets.length === 0) return null;
    ctx.setWaiting({ playerId: targets[0], type: WaitingType.RESPOND_BARBARIAN, data: { source: player.id, remaining: targets.slice(1) } });
    return ctx.waitingFor;
  }
};

const wanjianHandler: CardHandler = {
  targetType: TargetType.ALL_OTHERS,
  onPlay(ctx, player, card, cardIdx) {
    ctx.useCard(player, cardIdx);
    ctx.log(`${player.name} 使用了万箭齐发`);
    const targets = ctx.state.players.filter(p => p.id !== player.id && p.alive).map(p => p.id);
    if (targets.length === 0) return null;
    ctx.setWaiting({ playerId: targets[0], type: WaitingType.RESPOND_BARBARIAN, data: { source: player.id, remaining: targets.slice(1), needShan: true } });
    return ctx.waitingFor;
  }
};

const wuzhongHandler: CardHandler = {
  targetType: TargetType.SELF,
  onPlay(ctx, player, card, cardIdx) {
    ctx.useCard(player, cardIdx);
    ctx.drawCards(player, 2);
    ctx.log(`${player.name} 使用无中生有，摸2张牌`);
    return null;
  }
};

registerCard('juedou', juedouHandler);
registerCard('nanman', nanmanHandler);
registerCard('wanjian', wanjianHandler);
registerCard('wuzhong', wuzhongHandler);
