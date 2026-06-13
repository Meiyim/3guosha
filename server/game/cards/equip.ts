import { TargetType, type GameContext, type PlayerState, type CardInstance, type CardHandler } from '../types.ts';
import { registerCard } from './index.ts';

const equipHandler: CardHandler = {
  targetType: TargetType.SELF,
  onPlay(ctx, player, card, cardIdx) {
    const slot = card.def.equipSlot!;
    if (player.equipment[slot]) ctx.state.discard.push(player.equipment[slot]!);
    player.hand.splice(cardIdx, 1);
    player.equipment[slot] = card;
    ctx.log(`${player.name} 装备了${card.def.nameCn}`);
    return null;
  }
};

registerCard('zhuge', equipHandler);
registerCard('plus_horse', equipHandler);
registerCard('minus_horse', equipHandler);
