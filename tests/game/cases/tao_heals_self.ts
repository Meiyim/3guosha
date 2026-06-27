import assert from 'assert';
import {
  ScriptedAiBot,
  card,
  createTwoPlayerTestState,
  playCard,
  type GameScenario,
} from '../harness.ts';

export const taoHealsSelfScenario: GameScenario = {
  id: 'tao-heals-self',
  name: '桃在出牌阶段回复自己 1 点体力并进入弃牌堆',
  state: createDamagedPlayerState(),
  bots: [
    new ScriptedAiBot('p1', [playCard('c_tao', 'tao')]),
    new ScriptedAiBot('p2', []),
  ],
  expect(controller) {
    const state = controller.getState();

    assert.equal(state.resolutionStack.length, 0);
    assert.equal(state.players[0].hp, 4);
    assert.equal(state.players[1].hp, 4);
    assert.deepEqual(state.players[0].hand, []);
    assert.equal(state.cards.c_tao.zone, 'discard');
    assert.deepEqual(state.discardPile, ['c_tao']);
  },
};

function createDamagedPlayerState() {
  const state = createTwoPlayerTestState({
    cards: [card('c_tao', 'tao')],
    p1Hand: ['c_tao'],
    p2Hand: [],
  });
  state.players[0].hp = 3;
  return state;
}
