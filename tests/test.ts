import { Game } from '../server/game/engine.ts';
import { buildDeck, shuffleDeck } from '../server/game/cards/index.ts';
import { getHeroes } from '../server/game/heroes/index.ts';
import { createHeuristicAgent } from '../server/arena/agents/index.ts';
import assert from 'assert';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
}

function makeGame(hero1 = 'caocao', hero2 = 'liubei') {
  return new Game([
    { id: 'p1', name: 'Player1', heroId: hero1 },
    { id: 'p2', name: 'Player2', heroId: hero2 },
  ]);
}

function makeGameN(count) {
  const heroes = ['caocao', 'liubei', 'sunquan', 'guanyu', 'zhenji'];
  return new Game(Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player${i + 1}`,
    heroId: heroes[i % heroes.length],
  })));
}

console.log('\n=== Deck Tests ===');

test('buildDeck returns cards', () => {
  const deck = buildDeck();
  assert(deck.length > 50, `deck has ${deck.length} cards`);
  assert(deck[0].uid && deck[0].def);
});

test('each card has unique uid', () => {
  const deck = buildDeck();
  const uids = new Set(deck.map(c => c.uid));
  assert.strictEqual(uids.size, deck.length);
});

test('shuffleDeck changes order', () => {
  const d1 = buildDeck();
  const d2 = buildDeck();
  shuffleDeck(d2);
  const same = d1.every((c, i) => c.uid === d2[i].uid);
  assert(!same, 'deck should be shuffled');
});

test('deck contains sha, shan, tao', () => {
  const deck = buildDeck();
  const ids = new Set(deck.map(c => c.def.id));
  assert(ids.has('sha'));
  assert(ids.has('shan'));
  assert(ids.has('tao'));
});

console.log('\n=== Heroes Tests ===');

test('5 heroes defined', () => { assert.strictEqual(getHeroes().length, 5); });

test('each hero has required fields', () => {
  for (const h of getHeroes()) {
    assert(h.id && h.nameCn && h.maxHp >= 3 && h.skillIds.length > 0);
  }
});

console.log('\n=== Game Init Tests ===');

test('game initializes with 2 players', () => {
  const game = makeGame();
  assert.strictEqual(game.state.players.length, 2);
});

test('game accepts 2-N players and rejects solo games', () => {
  assert.throws(() => makeGameN(1), /at least 2 players/);
  assert.strictEqual(makeGameN(3).state.players.length, 3);
  assert.strictEqual(makeGameN(4).state.players.length, 4);
});

test('players start with 4 cards', () => {
  const game = makeGame();
  assert.strictEqual(game.state.players[0].hand.length, 4);
  assert.strictEqual(game.state.players[1].hand.length, 4);
});

test('players start at full hp', () => {
  const game = makeGame();
  assert.strictEqual(game.state.players[0].hp, 4);
  assert.strictEqual(game.state.players[0].maxHp, 4);
});

test('zhenji starts with 3 hp', () => {
  const game = makeGame('zhenji', 'caocao');
  assert.strictEqual(game.state.players[0].hp, 3);
  assert.strictEqual(game.state.players[0].maxHp, 3);
});

console.log('\n=== Turn Flow Tests ===');

test('startTurn draws 2 cards and sets play phase', () => {
  const game = makeGame();
  const p = game.currentPlayer;
  const before = p.hand.length;
  game.startTurn();
  assert.strictEqual(p.hand.length, before + 2);
  assert.strictEqual(game.state.phase, 'play');
});

test('endPlay goes to discard phase', () => {
  const game = makeGame();
  game.startTurn();
  game.endPlay(game.currentPlayer.id);
  // either in discard (waiting) or next turn started
  assert(game.state.phase === 'discard' || game.state.phase === 'play');
});

console.log('\n=== Attack/Dodge Tests ===');

test('playing sha sets waitingFor respond_attack', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  // Give p a sha
  const sha = { uid: 9000, def: { id: 'sha', name: 'Attack', nameCn: '杀', type: 'basic', suit: 'spade', number: 1 } };
  p.hand.push(sha);
  game.playCard(p.id, 9000);
  assert(game.waitingFor);
  assert.strictEqual(game.waitingFor.type, 'respond_attack');
});

test('responding with shan cancels attack', () => {
  const game = makeGame();
  game.startTurn();
  const p1 = game.state.players[0];
  const p2 = game.state.players[1];
  p1.hand.push({ uid: 9001, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 2 } });
  p2.hand.push({ uid: 9002, def: { id: 'shan', nameCn: '闪', type: 'basic', suit: 'diamond', number: 2 } });
  game.playCard(p1.id, 9001);
  const hpBefore = p2.hp;
  game.respond(p2.id, 9002);
  assert.strictEqual(p2.hp, hpBefore);
});

test('responding null takes damage', () => {
  const game = makeGame();
  game.startTurn();
  const p1 = game.state.players[0];
  const p2 = game.state.players[1];
  p1.hand.push({ uid: 9003, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'club', number: 3 } });
  game.playCard(p1.id, 9003);
  const hpBefore = p2.hp;
  game.respond(p2.id, null);
  assert.strictEqual(p2.hp, hpBefore - 1);
});

test('only 1 sha per turn without zhuge', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  const opp = game.state.players.find(x => x.id !== p.id);
  p.hand.push({ uid: 9010, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 1 } });
  p.hand.push({ uid: 9011, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 2 } });
  game.playCard(p.id, 9010);
  game.respond(opp.id, null);
  // second sha should fail
  const result = game.playCard(p.id, 9011);
  assert.strictEqual(typeof result, 'string');
});

test('sha cannot target self', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  p.hand.push({ uid: 9012, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 3 } });
  const result = game.playCard(p.id, 9012, p.id);
  assert.strictEqual(typeof result, 'string');
  assert.strictEqual(game.waitingFor, null);
});

test('+1 horse keeps opponent out of sha range in duel mode', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  const opp = game.state.players.find(x => x.id !== p.id)!;
  opp.equipment.horse_plus = { uid: 9013, def: { id: 'plus_horse', nameCn: '+1马', type: 'equipment', suit: 'heart', number: 13, equipSlot: 'horse_plus' } };
  p.hand.push({ uid: 9014, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 4 } });
  const result = game.playCard(p.id, 9014, opp.id);
  assert.strictEqual(typeof result, 'string');
  assert.strictEqual(game.waitingFor, null);
});

test('-1 horse cancels opponent +1 horse for sha range', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  const opp = game.state.players.find(x => x.id !== p.id)!;
  p.equipment.horse_minus = { uid: 9015, def: { id: 'minus_horse', nameCn: '-1马', type: 'equipment', suit: 'diamond', number: 13, equipSlot: 'horse_minus' } };
  opp.equipment.horse_plus = { uid: 9016, def: { id: 'plus_horse', nameCn: '+1马', type: 'equipment', suit: 'heart', number: 13, equipSlot: 'horse_plus' } };
  p.hand.push({ uid: 9017, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 5 } });
  const result = game.playCard(p.id, 9017, opp.id);
  assert(result !== null);
  assert.strictEqual(game.waitingFor?.type, 'respond_attack');
});

console.log('\n=== Multi-Player Engine Tests ===');

test('N-player distance uses circular seat order', () => {
  const game = makeGameN(4);
  const [p1, p2, p3, p4] = game.state.players;
  assert.strictEqual(game.getDistance(p1, p2), 1);
  assert.strictEqual(game.getDistance(p1, p3), 2);
  assert.strictEqual(game.getDistance(p1, p4), 1);
});

test('N-player distance removes dead seats from the circle', () => {
  const game = makeGameN(4);
  const [p1, p2, p3] = game.state.players;
  p2.alive = false;
  assert.strictEqual(game.getDistance(p1, p3), 1);
});

test('N-player distance still applies horses', () => {
  const game = makeGameN(4);
  const [p1, , p3] = game.state.players;
  p1.equipment.horse_minus = { uid: 9500, def: { id: 'minus_horse', nameCn: '-1马', type: 'equipment', suit: 'diamond', number: 13, equipSlot: 'horse_minus' } };
  p3.equipment.horse_plus = { uid: 9501, def: { id: 'plus_horse', nameCn: '+1马', type: 'equipment', suit: 'heart', number: 13, equipSlot: 'horse_plus' } };
  assert.strictEqual(game.getDistance(p1, p3), 2);
});

test('legalActions returns multiple sha targets in 3-player games', () => {
  const game = makeGameN(3);
  game.startTurn();
  const [p1, p2, p3] = game.state.players;
  p1.hand = [{ uid: 9502, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 1 } }];
  const targets = game.legalActions(p1.id)
    .filter(a => a.type === 'play_card' && a.cardUid === 9502)
    .map(a => a.targetId)
    .sort();
  assert.deepStrictEqual(targets, [p2.id, p3.id].sort());
});

test('legalActions excludes opposite sha target in 4-player games', () => {
  const game = makeGameN(4);
  game.startTurn();
  const [p1, p2, p3, p4] = game.state.players;
  p1.hand = [{ uid: 9503, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 2 } }];
  const targets = game.legalActions(p1.id)
    .filter(a => a.type === 'play_card' && a.cardUid === 9503)
    .map(a => a.targetId)
    .sort();
  assert.deepStrictEqual(targets, [p2.id, p4.id].sort());
  assert(!targets.includes(p3.id));
});

test('legalActions returns all living duel targets in 4-player games', () => {
  const game = makeGameN(4);
  game.startTurn();
  const [p1, p2, p3, p4] = game.state.players;
  p1.hand = [{ uid: 9504, def: { id: 'juedou', nameCn: '决斗', type: 'trick', suit: 'spade', number: 1 } }];
  const targets = game.legalActions(p1.id)
    .filter(a => a.type === 'play_card' && a.cardUid === 9504)
    .map(a => a.targetId)
    .sort();
  assert.deepStrictEqual(targets, [p2.id, p3.id, p4.id].sort());
});

test('turn order skips dead players in N-player games', () => {
  const game = makeGameN(3);
  game.startTurn();
  const [p1, p2, p3] = game.state.players;
  p2.hp = 1;
  p2.hand = [];
  p1.hand = [{ uid: 9505, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 3 } }];
  game.playCard(p1.id, 9505, p2.id);
  game.respond(p2.id, null);
  game.respond(p2.id, null);
  game.respond(p3.id, null);
  game.respond(p1.id, null);
  assert.strictEqual(p2.alive, false);
  assert.strictEqual(game.state.winner, null);
  game.state.currentPlayerIdx = 0;
  game.state.phase = 'play';
  p1.hand = [];
  game.endPlay(p1.id);
  assert.strictEqual(game.currentPlayer.id, p3.id);
});

test('last living player wins in N-player free-for-all', () => {
  const game = makeGameN(3);
  game.startTurn();
  const [p1, p2, p3] = game.state.players;
  p2.hp = 1;
  p2.hand = [];
  p1.hand = [{ uid: 9506, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 4 } }];
  game.playCard(p1.id, 9506, p2.id);
  game.respond(p2.id, null);
  game.respond(p2.id, null);
  game.respond(p3.id, null);
  game.respond(p1.id, null);

  game.state.currentPlayerIdx = 0;
  game.state.phase = 'play';
  p1.attackCount = 0;
  p3.hp = 1;
  p3.hand = [];
  p1.hand = [{ uid: 9507, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 5 } }];
  game.playCard(p1.id, 9507, p3.id);
  game.respond(p3.id, null);
  game.respond(p3.id, null);
  game.respond(p1.id, null);
  assert.strictEqual(p3.alive, false);
  assert.strictEqual(game.state.winner, p1.id);
});

console.log('\n=== Peach Tests ===');

test('peach heals 1 hp', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  p.hp = 2;
  p.hand.push({ uid: 9020, def: { id: 'tao', nameCn: '桃', type: 'basic', suit: 'heart', number: 5 } });
  game.playCard(p.id, 9020);
  assert.strictEqual(p.hp, 3);
});

test('peach does not exceed maxHp', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  p.hand.push({ uid: 9021, def: { id: 'tao', nameCn: '桃', type: 'basic', suit: 'heart', number: 6 } });
  game.playCard(p.id, 9021);
  assert.strictEqual(p.hp, p.maxHp);
});

console.log('\n=== Trick Card Tests ===');

test('duel alternates sha responses', () => {
  const game = makeGame();
  game.startTurn();
  const p1 = game.state.players[0];
  const p2 = game.state.players[1];
  p1.hand.push({ uid: 9030, def: { id: 'juedou', nameCn: '决斗', type: 'trick', suit: 'spade', number: 1 } });
  p2.hand.push({ uid: 9031, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'club', number: 4 } });
  game.playCard(p1.id, 9030);
  assert.strictEqual(game.waitingFor.playerId, p2.id);
  assert.strictEqual(game.waitingFor.type, 'respond_duel');
  // p2 plays sha, now p1 must respond
  game.respond(p2.id, 9031);
  assert.strictEqual(game.waitingFor.playerId, p1.id);
});

test('wuzhong draws 2 cards', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  const before = p.hand.length;
  p.hand.push({ uid: 9040, def: { id: 'wuzhong', nameCn: '无中生有', type: 'trick', suit: 'heart', number: 7 } });
  game.playCard(p.id, 9040);
  assert.strictEqual(p.hand.length, before + 2);
});

test('barbarian invasion requires sha from opponent', () => {
  const game = makeGame();
  game.startTurn();
  const p1 = game.state.players[0];
  const p2 = game.state.players[1];
  p1.hand.push({ uid: 9050, def: { id: 'nanman', nameCn: '南蛮入侵', type: 'trick', suit: 'spade', number: 7 } });
  game.playCard(p1.id, 9050);
  assert.strictEqual(game.waitingFor.playerId, p2.id);
  assert.strictEqual(game.waitingFor.type, 'respond_barbarian');
});

console.log('\n=== Equipment Tests ===');

test('equipping zhuge allows unlimited sha', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  const opp = game.state.players.find(x => x.id !== p.id);
  p.hand.push({ uid: 9060, def: { id: 'zhuge', nameCn: '诸葛连弩', type: 'equipment', suit: 'club', number: 1, equipSlot: 'weapon' } });
  game.playCard(p.id, 9060);
  assert(p.equipment.weapon);
  // now can play multiple sha
  p.hand.push({ uid: 9061, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 1 } });
  p.hand.push({ uid: 9062, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 2 } });
  game.playCard(p.id, 9061);
  game.respond(opp.id, null);
  const w = game.playCard(p.id, 9062);
  assert(w !== null, 'second sha should work with zhuge');
});

console.log('\n=== Hero Skill Tests ===');

test('jianxiong (caocao): takes card on damage', () => {
  const game = makeGame('caocao', 'liubei');
  game.startTurn();
  const p1 = game.state.players[0]; // caocao
  const p2 = game.state.players[1]; // liubei
  // give p2 a sha and make it p2's turn
  game.state.currentPlayerIdx = 1;
  game.state.phase = 'play';
  p2.attackCount = 0;
  p2.hand.push({ uid: 9070, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 3 } });
  const unrelated = { uid: 9071, def: { id: 'shan', nameCn: '闪', type: 'basic', suit: 'diamond', number: 4 } };
  const handBefore = p1.hand.length;
  game.playCard(p2.id, 9070);
  game.state.discard.push(unrelated);
  game.respond(p1.id, null); // take damage, jianxiong triggers
  assert.strictEqual(p1.hand.length, handBefore + 1);
  assert(p1.hand.some(card => card.uid === 9070), 'caocao should gain the actual damage card');
  assert(game.state.discard.some(card => card.uid === 9071), 'unrelated discard top should stay in discard');
  assert(!game.state.discard.some(card => card.uid === 9070), 'damage card should leave discard');
});

test('jianxiong (caocao): duel damage keeps the original duel card', () => {
  const game = makeGame('liubei', 'caocao');
  game.startTurn();
  const liubei = game.state.players[0];
  const caocao = game.state.players[1];
  liubei.hand.push({ uid: 9072, def: { id: 'juedou', nameCn: '决斗', type: 'trick', suit: 'spade', number: 1 } });
  caocao.hand.push({ uid: 9073, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'club', number: 7 } });
  liubei.hand.push({ uid: 9074, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'heart', number: 8 } });

  game.playCard(liubei.id, 9072, caocao.id);
  game.respond(caocao.id, 9073);
  game.respond(liubei.id, 9074);
  game.respond(caocao.id, null);

  assert(caocao.hand.some(card => card.uid === 9072), 'caocao should gain the original duel card');
  assert(!game.state.discard.some(card => card.uid === 9072), 'duel card should leave discard');
});

test('wusheng (guanyu): red cards as sha', () => {
  const game = makeGame('guanyu', 'caocao');
  game.startTurn();
  const p1 = game.state.players[0]; // guanyu
  const p2 = game.state.players[1];
  // give a red non-sha card
  p1.hand.push({ uid: 9080, def: { id: 'tao', nameCn: '桃', type: 'basic', suit: 'heart', number: 4 } });
  const w = game.playCard(p1.id, 9080, p2.id);
  assert(w !== null, 'should be able to use red card as sha');
  assert.strictEqual(w.type, 'respond_attack');
});

test('zhiheng (sunquan): discard and draw same count', () => {
  const game = makeGame('sunquan', 'caocao');
  game.startTurn();
  const p = game.state.players[0];
  const c1 = { uid: 9090, def: { id: 'shan', nameCn: '闪', type: 'basic', suit: 'diamond', number: 3 } };
  const c2 = { uid: 9091, def: { id: 'shan', nameCn: '闪', type: 'basic', suit: 'diamond', number: 4 } };
  p.hand.push(c1, c2);
  const before = p.hand.length;
  game.useZhiheng(p.id, [9090, 9091]);
  // discarded 2, drew 2 → net 0 change
  assert.strictEqual(p.hand.length, before - 2 + 2);
});

test('luoshen (zhenji): draws black cards at turn start', () => {
  const game = makeGame('zhenji', 'caocao');
  // Clear deck and set known cards. pop() takes from end.
  game.state.deck = [
    { uid: 8010, def: { id: 'shan', nameCn: '闪', type: 'basic', suit: 'diamond', number: 4 } },
    { uid: 8011, def: { id: 'shan', nameCn: '闪', type: 'basic', suit: 'diamond', number: 5 } },
    // ^ these two are for normal draw (popped after luoshen)
    { uid: 8003, def: { id: 'tao', nameCn: '桃', type: 'basic', suit: 'heart', number: 3 } }, // red stops luoshen
    { uid: 8002, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'club', number: 2 } },  // luoshen keeps
    { uid: 8001, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 1 } }, // luoshen keeps (popped first)
  ];
  const before = game.state.players[0].hand.length;
  game.startTurn();
  // luoshen: pop 8001(spade=black, keep), pop 8002(club=black, keep), pop 8003(heart=red, stop)
  // normal draw: pop 8011, pop 8010
  // total gained: 2 (luoshen) + 2 (draw) = 4
  assert.strictEqual(game.state.players[0].hand.length, before + 4);
});

console.log('\n=== Win Condition Tests ===');

test('player enters dying state when hp <= 0', () => {
  const game = makeGame();
  game.startTurn();
  const p2 = game.state.players[1];
  p2.hp = 1;
  const p1 = game.state.players[0];
  p1.hand.push({ uid: 9100, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 5 } });
  game.playCard(p1.id, 9100);
  game.respond(p2.id, null);
  assert.strictEqual(p2.alive, true);
  assert.strictEqual(game.waitingFor?.type, 'respond_rescue');
  assert.strictEqual(game.waitingFor?.playerId, p2.id);
  assert.strictEqual(game.waitingFor?.data.dyingPlayerId, p2.id);
});

test('player dies if rescue is passed by all players', () => {
  const game = makeGame();
  game.startTurn();
  const p1 = game.state.players[0];
  const p2 = game.state.players[1];
  p2.hp = 1;
  p1.hand.push({ uid: 9101, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 6 } });
  game.playCard(p1.id, 9101);
  game.respond(p2.id, null);
  game.respond(p2.id, null);
  game.respond(p1.id, null);
  assert.strictEqual(p2.alive, false);
  assert.strictEqual(game.state.winner, p1.id);
});

test('tao rescues a dying player before death is finalized', () => {
  const game = makeGame();
  game.startTurn();
  const p1 = game.state.players[0];
  const p2 = game.state.players[1];
  p2.hp = 1;
  p2.hand.push({ uid: 9102, def: { id: 'tao', nameCn: '桃', type: 'basic', suit: 'heart', number: 8 } });
  p1.hand.push({ uid: 9103, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 7 } });
  game.playCard(p1.id, 9103);
  game.respond(p2.id, null);
  game.respond(p2.id, 9102);
  assert.strictEqual(p2.alive, true);
  assert.strictEqual(p2.hp, 1);
  assert.strictEqual(game.state.winner, null);
  assert.strictEqual(game.waitingFor, null);
});

console.log('\n=== Discard Phase Tests ===');

test('must discard to hp when hand > hp at end of turn', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  p.hp = 2;
  // Give extra cards
  while (p.hand.length < 5) p.hand.push({ uid: 9200 + p.hand.length, def: { id: 'shan', nameCn: '闪', type: 'basic', suit: 'diamond', number: 2 } });
  game.endPlay(p.id);
  assert(game.waitingFor);
  assert.strictEqual(game.waitingFor.type, 'discard');
  assert.strictEqual(game.waitingFor.data.count, p.hand.length - p.hp);
});

test('discard phase rejects wrong discard count', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  p.hp = 2;
  while (p.hand.length < 5) p.hand.push({ uid: 9300 + p.hand.length, def: { id: 'shan', nameCn: '闪', type: 'basic', suit: 'diamond', number: 2 } });
  game.endPlay(p.id);
  const turnBefore = game.state.turnNumber;
  game.discardCards(p.id, []);
  assert.strictEqual(game.state.turnNumber, turnBefore);
  assert.strictEqual(game.waitingFor?.type, 'discard');
});

console.log('\n=== Legal Actions Tests ===');

test('legalActions exposes playable cards and end_play on current play phase', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  const opp = game.state.players.find(x => x.id !== p.id)!;
  p.hand = [{ uid: 9400, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 9 } }];
  const actions = game.legalActions(p.id);
  assert(actions.some(a => a.type === 'play_card' && a.cardUid === 9400 && a.targetId === opp.id));
  assert(actions.some(a => a.type === 'end_play'));
});

test('legalActions excludes sha target when opponent is out of range', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  const opp = game.state.players.find(x => x.id !== p.id)!;
  opp.equipment.horse_plus = { uid: 9401, def: { id: 'plus_horse', nameCn: '+1马', type: 'equipment', suit: 'heart', number: 13, equipSlot: 'horse_plus' } };
  p.hand = [{ uid: 9402, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 10 } }];
  const actions = game.legalActions(p.id);
  assert(!actions.some(a => a.type === 'play_card' && a.cardUid === 9402));
});

test('legalActions exposes rescue tao and pass while dying', () => {
  const game = makeGame();
  game.startTurn();
  const p1 = game.state.players[0];
  const p2 = game.state.players[1];
  p2.hp = 1;
  p2.hand = [{ uid: 9403, def: { id: 'tao', nameCn: '桃', type: 'basic', suit: 'heart', number: 9 } }];
  p1.hand.push({ uid: 9404, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 11 } });
  game.playCard(p1.id, 9404);
  game.respond(p2.id, null);
  const actions = game.legalActions(p2.id);
  assert(actions.some(a => a.type === 'respond' && a.cardUid === 9403));
  assert(actions.some(a => a.type === 'respond' && a.cardUid === null));
});

test('legalActions returns exact discard combinations', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  p.hp = 2;
  p.hand = [
    { uid: 9410, def: { id: 'shan', nameCn: '闪', type: 'basic', suit: 'diamond', number: 2 } },
    { uid: 9411, def: { id: 'shan', nameCn: '闪', type: 'basic', suit: 'diamond', number: 3 } },
    { uid: 9412, def: { id: 'shan', nameCn: '闪', type: 'basic', suit: 'diamond', number: 4 } },
  ];
  game.endPlay(p.id);
  const actions = game.legalActions(p.id).filter(a => a.type === 'discard_cards');
  assert.strictEqual(actions.length, 3);
  assert(actions.every(a => a.type === 'discard_cards' && a.cardUids.length === 1));
});

console.log('\n=== Agent API Tests ===');

test('observe exposes public counts, private hand, and legal actions', () => {
  const game = makeGame();
  game.startTurn();
  const p1 = game.state.players[0];
  const p2 = game.state.players[1];
  const obs = game.observe(p1.id);
  assert(obs);
  assert.strictEqual(obs.privateState.myId, p1.id);
  assert.strictEqual(obs.privateState.myHand.length, p1.hand.length);
  const publicP2 = obs.publicState.players.find(p => p.id === p2.id)!;
  assert.strictEqual(publicP2.handCount, p2.hand.length);
  assert(!('hand' in publicP2));
  assert(obs.legalActions.some(a => a.type === 'end_play'));
});

test('step rejects illegal actions without changing state', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  const before = p.hand.length;
  const result = game.step(p.id, { type: 'play_card', cardUid: 999999, cardId: 'sha', targetId: 'missing' });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'illegal_action');
  assert.strictEqual(p.hand.length, before);
});

test('step applies a legal action selected from legalActions', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  const opp = game.state.players.find(x => x.id !== p.id)!;
  p.hand = [{ uid: 9420, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 12 } }];
  const action = game.legalActions(p.id).find(a => a.type === 'play_card' && a.cardUid === 9420 && a.targetId === opp.id);
  assert(action);
  const result = game.step(p.id, action);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(game.waitingFor?.type, 'respond_attack');
  assert.strictEqual(game.waitingFor?.playerId, opp.id);
});

console.log('\n=== Agent Adapter Tests ===');

test('heuristic agent returns a legal action from observation', () => {
  const game = makeGame();
  game.startTurn();
  const p = game.currentPlayer;
  const opp = game.state.players.find(x => x.id !== p.id)!;
  p.hand = [{ uid: 9430, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 7 } }];
  const obs = game.observe(p.id)!;
  const action = createHeuristicAgent().act(obs);
  assert(action, 'agent should choose an action');
  assert(game.legalActions(p.id).some(legal => JSON.stringify(legal) === JSON.stringify(action)));
  assert.strictEqual(action.type, 'play_card');
  assert.strictEqual(action.cardUid, 9430);
  assert.strictEqual(action.targetId, opp.id);
});

test('heuristic agent passes rescue for other dying players', () => {
  const game = makeGameN(3);
  game.startTurn();
  const p1 = game.state.players[0];
  const p2 = game.state.players[1];
  const p3 = game.state.players[2];
  p1.hand.push({ uid: 9431, def: { id: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 8 } });
  p2.hp = 1;
  p3.hand.push({ uid: 9432, def: { id: 'tao', nameCn: '桃', type: 'basic', suit: 'heart', number: 9 } });
  game.playCard(p1.id, 9431, p2.id);
  game.respond(p2.id, null);
  game.respond(p2.id, null);
  const obs = game.observe(p3.id)!;
  const action = createHeuristicAgent().act(obs);
  assert.deepStrictEqual(action, { type: 'respond', cardUid: null });
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
