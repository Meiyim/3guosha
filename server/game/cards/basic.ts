import { WaitingType, TargetType, type GameContext, type PlayerState, type CardInstance, type WaitingAction, type CardHandler } from '../types.ts';
import { registerCard } from './index.ts';

const shaHandler: CardHandler = {
  targetType: TargetType.SINGLE,
  canPlay(ctx, player) {
    const maxAttacks = player.equipment.weapon?.def.id === 'zhuge' ? 999 : 1;
    return player.attackCount < maxAttacks;
  },
  onPlay(ctx, player, card, cardIdx, targetId) {
    const maxAttacks = player.equipment.weapon?.def.id === 'zhuge' ? 999 : 1;
    if (player.attackCount >= maxAttacks) return null;
    const target = targetId ? ctx.getPlayer(targetId) : ctx.getOpponent(player);
    if (!target || !ctx.canUseShaOn(player, target)) return null;
    player.attackCount++;
    ctx.useCard(player, cardIdx);
    ctx.log(`${player.name} 对 ${target.name} 使用了杀`);
    ctx.setWaiting({ playerId: target.id, type: WaitingType.RESPOND_ATTACK, data: { source: player.id, card } });
    return ctx.waitingFor;
  }
};

const shanHandler: CardHandler = {
  targetType: TargetType.SELF,
  canPlay() { return false; },
  onPlay() { return null; }
};

const taoHandler: CardHandler = {
  targetType: TargetType.SELF,
  canPlay(ctx, player) { return player.hp < player.maxHp; },
  onPlay(ctx, player, card, cardIdx) {
    if (player.hp >= player.maxHp) return null;
    ctx.useCard(player, cardIdx);
    player.hp = Math.min(player.hp + 1, player.maxHp);
    ctx.log(`${player.name} 使用桃，回复至${player.hp}点体力`);
    return null;
  }
};

registerCard('sha', shaHandler);
registerCard('shan', shanHandler);
registerCard('tao', taoHandler);
