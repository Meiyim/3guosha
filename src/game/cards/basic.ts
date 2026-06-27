import { RuleInterpreter } from '../core/interpreter.ts';
import type { CardResourceSource } from '../core/rule_module.ts';

export const shaResource: CardResourceSource = {
  id: 'sha',
  kind: 'card',
  source: `
卡牌：杀
卡牌类型：基本牌
使用时机：出牌阶段
目标：除你外，你攻击范围内的一名角色
效果：对目标造成 1 点伤害
备注：每个出牌阶段限使用一张【杀】
`,
};

export const shanResource: CardResourceSource = {
  id: 'shan',
  kind: 'card',
  source: `
卡牌：闪
卡牌类型：基本牌
使用时机：以你为目标的【杀】开始结算时
目标：以你为目标的那张【杀】
效果：抵消该【杀】的全部效果，你不会受到这张【杀】造成的伤害
`,
};

export const taoResource: CardResourceSource = {
  id: 'tao',
  kind: 'card',
  source: `
卡牌：桃
卡牌类型：基本牌
使用时机：出牌阶段
目标：你
效果：回复 1 点体力
`,
};

export const basicCardResources = [
  shaResource,
  shanResource,
  taoResource,
];

export function createBasicRuleInterpreter(): RuleInterpreter {
  const interpreter = new RuleInterpreter();
  registerBasicCards(interpreter);
  return interpreter;
}

export function registerBasicCards(interpreter: RuleInterpreter): RuleInterpreter {
  for (const resource of basicCardResources) {
    interpreter.loadCardResource(resource);
  }
  return interpreter;
}
