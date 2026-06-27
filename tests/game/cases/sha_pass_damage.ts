import assert from 'assert';
import {
  ScriptedAiBot,
  card,
  createTwoPlayerTestState,
  passTopFrame,
  playCard,
  type GameScenario,
} from '../harness.ts';

export const shaPassDamageScenario: GameScenario = {
  id: 'sha-pass-damage',
  name: '杀未被响应时目标扣 1 点体力，杀进入弃牌堆',
  state: createTwoPlayerTestState({
    cards: [card('c_sha', 'sha')],
    p1Hand: ['c_sha'],
    p2Hand: [],
  }),
  bots: [
    new ScriptedAiBot('p1', [playCard('c_sha', 'sha', ['p2'])]),
    new ScriptedAiBot('p2', [passTopFrame()]),
  ],
  expect(controller) {
    const state = controller.getState();

    assert.equal(state.resolutionStack.length, 0);
    assert.equal(state.players[0].hp, 4);
    assert.equal(state.players[1].hp, 3);
    assert.deepEqual(state.players[0].hand, []);
    assert.deepEqual(state.players[1].hand, []);
    assert.equal(state.cards.c_sha.zone, 'discard');
    assert.deepEqual(state.discardPile, ['c_sha']);
  },
};
