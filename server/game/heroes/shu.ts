import type { GameContext, PlayerState, GameEvent, SkillHandler } from '../types.ts';
import { registerHero, registerSkill } from './index.ts';

registerHero({ id: 'liubei', name: 'Liu Bei', nameCn: '刘备', maxHp: 4, gender: 'male', kingdom: 'shu', skillIds: ['rende'] });
registerHero({ id: 'guanyu', name: 'Guan Yu', nameCn: '关羽', maxHp: 4, gender: 'male', kingdom: 'shu', skillIds: ['wusheng'] });

const wusheng: SkillHandler = {
  id: 'wusheng',
  events: ['before_play'],
  trigger(ctx, event, player, data) {
    // wusheng allows red cards to be used as sha — handled in engine's playCard validation
  }
};

const rende: SkillHandler = {
  id: 'rende',
  events: [],
  trigger() {},
  activeAction(ctx, player, cardUids) {}
};

registerSkill(wusheng);
registerSkill(rende);
