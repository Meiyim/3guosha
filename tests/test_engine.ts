import assert from 'assert';
import {
  DualGameController,
  createBasicRuleInterpreter,
  createDualGameState,
  renderRuleModuleMermaid,
  reprGameState,
  type CardInstance,
} from '../src/game/index.ts';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error: any) {
    failed++;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

function card(id: string, cardId: string): CardInstance {
  return { id, cardId, zone: 'void' };
}

function makeController(cards: CardInstance[], p1Hand: string[], p2Hand: string[]) {
  return new DualGameController(createDualGameState({
    players: [
      { id: 'p1', name: 'Player 1', hand: p1Hand },
      { id: 'p2', name: 'Player 2', hand: p2Hand },
    ],
    cards,
  }), { shuffleSeed: 'test-seed' }, createBasicRuleInterpreter());
}

console.log('\n=== New Game Engine Tests ===\n');

test('3gs card source compiles into inspectable AST and IR', () => {
  const interpreter = createBasicRuleInterpreter();
  const compiled = interpreter.getCompiledModule('sha');

  assert.equal(compiled?.ast?.kind, 'card_rule');
  assert.equal(compiled.ast.name, '杀');
  assert.equal(compiled.ast.timing.kind, 'play_phase');
  assert.equal(compiled.ast.target.kind, 'single_other_in_attack_range');
  assert.deepEqual(compiled.ast.effects.map(effect => effect.kind), ['damage_target']);

  assert.equal(compiled.ir?.kind, 'card_rule_ir');
  assert.equal(compiled.ir.timing.op, 'require_play_phase');
  assert.equal(compiled.ir.target.op, 'require_single_other_alive_target');
  assert.deepEqual(compiled.ir.instructions, [{ op: 'open_sha_response_frame', damageAmount: 1 }]);
  assert.equal(typeof compiled.cardRule?.canPlay, 'function');
  assert.equal(typeof compiled.cardRule?.onPlay, 'function');
});

test('compiled 3gs module can render AST and IR mermaid graphs', () => {
  const interpreter = createBasicRuleInterpreter();
  const compiled = interpreter.getCompiledModule('sha');
  assert.ok(compiled);

  const graph = renderRuleModuleMermaid(compiled);
  assert.ok(graph.includes('graph TD'));
  assert.ok(graph.includes('CardRuleAst: 杀'));
  assert.ok(graph.includes('TimingAst: play_phase'));
  assert.ok(graph.includes('CardRuleIr: sha'));
  assert.ok(graph.includes('open_sha_response_frame damageAmount=1'));
});

test('game state has an indented human-readable repr', () => {
  const controller = makeController([card('c_sha', 'sha')], ['c_sha'], []);
  const repr = reprGameState(controller.getState(), { includeCards: true });

  assert.ok(repr.includes('GameState(game_1)'));
  assert.ok(repr.includes('  turn:\n    currentPlayerId: p1'));
  assert.ok(repr.includes('  Player(p1)\n    name: Player 1'));
  assert.ok(repr.includes('  Card(c_sha)\n    cardId: sha'));
});

test('tao heals and moves card to discard pile', () => {
  const controller = makeController([card('c_tao', 'tao')], ['c_tao'], []);
  const state = controller.getState();
  state.players[0].hp = 3;

  const result = controller.dispatch({
    type: 'card_play',
    playerId: 'p1',
    cardInstanceId: 'c_tao',
    cardId: 'tao',
    targets: [],
  });

  assert.equal(result.ok, true);
  assert.equal(state.players[0].hp, 4);
  assert.deepEqual(state.players[0].hand, []);
  assert.deepEqual(state.discardPile, ['c_tao']);
});

test('sha opens a resolution frame waiting for shan', () => {
  const controller = makeController([card('c_sha', 'sha')], ['c_sha'], []);
  const state = controller.getState();

  const result = controller.dispatch({
    type: 'card_play',
    playerId: 'p1',
    cardInstanceId: 'c_sha',
    cardId: 'sha',
    targets: ['p2'],
  });

  assert.equal(result.ok, true);
  assert.equal(state.resolutionStack.length, 1);
  assert.equal(state.resolutionStack[0].criterion.type, 'action_response');
  assert.equal(state.players[1].hp, 4);
});

test('passing sha resolution deals damage and discards sha', () => {
  const controller = makeController([card('c_sha', 'sha')], ['c_sha'], []);
  const state = controller.getState();
  controller.dispatch({
    type: 'card_play',
    playerId: 'p1',
    cardInstanceId: 'c_sha',
    cardId: 'sha',
    targets: ['p2'],
  });

  const frameId = state.resolutionStack[0].id;
  const result = controller.dispatch({ type: 'pass', playerId: 'p2', resolutionFrameId: frameId });

  assert.equal(result.ok, true);
  assert.equal(state.resolutionStack.length, 0);
  assert.equal(state.players[1].hp, 3);
  assert.deepEqual(state.discardPile, ['c_sha']);
});

test('shan cancels sha and discards both cards', () => {
  const controller = makeController(
    [card('c_sha', 'sha'), card('c_shan', 'shan')],
    ['c_sha'],
    ['c_shan'],
  );
  const state = controller.getState();
  controller.dispatch({
    type: 'card_play',
    playerId: 'p1',
    cardInstanceId: 'c_sha',
    cardId: 'sha',
    targets: ['p2'],
  });

  const result = controller.dispatch({
    type: 'card_play',
    playerId: 'p2',
    cardInstanceId: 'c_shan',
    cardId: 'shan',
    targets: [],
  });

  assert.equal(result.ok, true);
  assert.equal(state.resolutionStack.length, 0);
  assert.equal(state.players[1].hp, 4);
  assert.deepEqual(new Set(state.discardPile), new Set(['c_sha', 'c_shan']));
});

console.log(`\n=== New Game Engine Results: ${passed} passed, ${failed} failed ===\n`);
process.exitCode = failed > 0 ? 1 : 0;
