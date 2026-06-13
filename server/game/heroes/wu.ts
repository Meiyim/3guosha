import type { GameContext, PlayerState, GameEvent, SkillHandler } from '../types.ts';
import { registerHero, registerSkill } from './index.ts';

registerHero({ id: 'sunquan', name: 'Sun Quan', nameCn: '孙权', maxHp: 4, gender: 'male', kingdom: 'wu', skillIds: ['zhiheng'] });

const zhiheng: SkillHandler = {
  id: 'zhiheng',
  events: [],
  trigger() {},
  activeAction(ctx, player, cardUids) {
    if (cardUids.length === 0) return;
    for (const uid of cardUids) {
      const idx = player.hand.findIndex(c => c.uid === uid);
      if (idx !== -1) ctx.state.discard.push(player.hand.splice(idx, 1)[0]);
    }
    ctx.drawCards(player, cardUids.length);
    ctx.log(`${player.name} 发动制衡，弃${cardUids.length}张摸${cardUids.length}张`);
  }
};

registerSkill(zhiheng);
