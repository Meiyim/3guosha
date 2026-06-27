import assert from 'assert';
import {
  ScriptedAiBot,
  card,
  createTwoPlayerTestState,
  playCard,
  type GameScenario,
} from '../harness.ts';

export const shaBlockedByShanScenario: GameScenario = {
  id: 'sha-blocked-by-shan',
  name: '杀被闪抵消后双方不掉血，杀和闪进入弃牌堆',
  state: createTwoPlayerTestState({
    cards: [
      card('c_sha', 'sha'),
      card('c_shan', 'shan'),
    ],
    p1Hand: ['c_sha'],
    p2Hand: ['c_shan'],
  }),
  bots: [
    new ScriptedAiBot('p1', [playCard('c_sha', 'sha', ['p2'])]),
    new ScriptedAiBot('p2', [playCard('c_shan', 'shan')]),
  ],
  expect(controller) {
    const state = controller.getState();

    assert.equal(state.resolutionStack.length, 0);
    assert.equal(state.players[0].hp, 4);
    assert.equal(state.players[1].hp, 4);
    assert.deepEqual(state.players[0].hand, []);
    assert.deepEqual(state.players[1].hand, []);
    assert.equal(state.cards.c_sha.zone, 'discard');
    assert.equal(state.cards.c_shan.zone, 'discard');
    assert.deepEqual(new Set(state.discardPile), new Set(['c_sha', 'c_shan']));

    const trace = controller.getTraceLog();
    assert.ok(trace.some(event => event.type === 'frame_pushed'));
    assert.ok(trace.some(event => event.type === 'frame_marker_selected'
      && event.marker.type === 'cancel_sha_resolution'
      && event.marker.playerId === 'p2'));
    assert.ok(trace.some(event => event.type === 'criterion_completed'));

    const renderedTrace = controller.formatTraceLog();
    assert.ok(renderedTrace.includes('\x1b[36mRECV Action'));
    assert.ok(renderedTrace.includes('\x1b[35mAPPLY Effect'));
    assert.ok(renderedTrace.includes('\x1b[32mSTATE Change'));
    assert.ok(renderedTrace.includes('\x1b[1mp2\x1b[22m'));
    assert.ok(renderedTrace.includes('\x1b[1msha\x1b[22m'));
  },
};
