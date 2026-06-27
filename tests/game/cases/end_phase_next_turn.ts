import assert from 'assert';
import {
  ScriptedAiBot,
  createTwoPlayerTestState,
  endPhase,
  type GameScenario,
} from '../harness.ts';

export const endPhaseNextTurnScenario: GameScenario = {
  id: 'end-phase-next-turn',
  name: '结束阶段会切换到下一个玩家并输出 turn change 日志',
  state: createTwoPlayerTestState({
    cards: [],
    p1Hand: [],
    p2Hand: [],
  }),
  bots: [
    new ScriptedAiBot('p1', [endPhase()]),
    new ScriptedAiBot('p2', []),
  ],
  expect(controller) {
    const state = controller.getState();

    assert.equal(state.turn.currentPlayerId, 'p2');
    assert.equal(state.turn.turnNumber, 2);

    const renderedTrace = controller.formatTraceLog();
    assert.ok(renderedTrace.includes('\x1b[33mTurn player'));
    assert.ok(renderedTrace.includes('\x1b[1mp1\x1b[22m'));
    assert.ok(renderedTrace.includes('\x1b[1mp2\x1b[22m'));
  },
};
