import type { GameContext, PlayerState, GameEvent, SkillHandler } from '../types.ts';
import { registerHero, registerSkill } from './index.ts';

registerHero({ id: 'caocao', name: 'Cao Cao', nameCn: '曹操', maxHp: 4, gender: 'male', kingdom: 'wei', skillIds: ['jianxiong'] });
registerHero({ id: 'zhenji', name: 'Zhen Ji', nameCn: '甄姬', maxHp: 3, gender: 'female', kingdom: 'wei', skillIds: ['luoshen'] });

const jianxiong: SkillHandler = {
  id: 'jianxiong',
  events: ['damage_taken'],
  trigger(ctx, event, player, data) {
    const damageCard = data?.card;
    if (!damageCard) return;

    const discardIdx = ctx.state.discard.findIndex(card => card.uid === damageCard.uid);
    if (discardIdx !== -1) {
      const [taken] = ctx.state.discard.splice(discardIdx, 1);
      player.hand.push(taken);
      ctx.log(`${player.name} 发动奸雄，获得造成伤害的牌`);
    }
  }
};

const luoshen: SkillHandler = {
  id: 'luoshen',
  events: ['turn_start'],
  trigger(ctx, event, player) {
    let count = 0;
    while (ctx.state.deck.length > 0) {
      const card = ctx.state.deck.pop()!;
      if (card.def.suit === 'spade' || card.def.suit === 'club') {
        player.hand.push(card);
        count++;
      } else {
        ctx.state.discard.push(card);
        break;
      }
    }
    if (count > 0) ctx.log(`${player.name} 发动洛神，获得${count}张黑色牌`);
  }
};

registerSkill(jianxiong);
registerSkill(luoshen);
