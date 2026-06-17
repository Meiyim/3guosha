import { spawn } from 'child_process';
import { createWsPlayer } from '../shared/ws-client.ts';
import assert from 'assert';
import { Game } from '../server/game/engine.ts';

const PORT = 3098;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let server: any;
let passed = 0, failed = 0;

function test(name: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}: ${detail || 'failed'}`); }
}

console.log('\n=== Illegal Move Tests (Unit) ===\n');

// Unit test: playing shan returns error
{
  const game = new Game([
    { id: 'p1', name: 'A', heroId: 'caocao' },
    { id: 'p2', name: 'B', heroId: 'guanyu' },
  ]);
  game.startTurn();
  const p = game.currentPlayer;
  // Inject a shan
  p.hand.push({ uid: 8001, def: { id: 'shan', name: 'shan', nameCn: '闪', type: 'basic', suit: 'diamond', number: 2 } as any });
  const result = game.playCard(p.id, 8001);
  test('Playing 闪 returns error string', typeof result === 'string' && result.includes('不可'), `got: ${result}`);
}

// Unit test: playing sha on invalid target returns error
{
  const game = new Game([
    { id: 'p1', name: 'A', heroId: 'caocao' },
    { id: 'p2', name: 'B', heroId: 'guanyu' },
  ]);
  game.startTurn();
  const p = game.currentPlayer;
  p.hand.push({ uid: 8002, def: { id: 'sha', name: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 7 } as any });
  const result = game.playCard(p.id, 8002, 'nonexistent');
  test('Playing sha on invalid target returns error string', typeof result === 'string' && result.includes('无法'), `got: ${result}`);
}

// Unit test: playing tao at full HP returns error
{
  const game = new Game([
    { id: 'p1', name: 'A', heroId: 'caocao' },
    { id: 'p2', name: 'B', heroId: 'guanyu' },
  ]);
  game.startTurn();
  const p = game.currentPlayer;
  p.hand.push({ uid: 8003, def: { id: 'tao', name: 'tao', nameCn: '桃', type: 'basic', suit: 'heart', number: 5 } as any });
  const result = game.playCard(p.id, 8003);
  test('Playing 桃 at full HP returns error string', typeof result === 'string' && result.includes('不可'), `got: ${result}`);
}

// Unit test: canPlayCard delegate works client-side
{
  // Load card handlers
  const { getCardHandler } = await import('../server/game/cards/index.ts');
  await import('../server/game/cards/basic.ts');

  const shanHandler = getCardHandler('shan');
  const taoHandler = getCardHandler('tao');
  const shaHandler = getCardHandler('sha');

  const fullHpPlayer = { hp: 4, maxHp: 4, attackCount: 0, equipment: {} };
  const hurtPlayer = { hp: 2, maxHp: 4, attackCount: 0, equipment: {} };
  const usedShaPlayer = { hp: 4, maxHp: 4, attackCount: 1, equipment: {} };

  test('canPlay: shan always false', shanHandler.canPlay({}, fullHpPlayer, {}) === false);
  test('canPlay: tao false at full HP', taoHandler.canPlay({}, fullHpPlayer, {}) === false);
  test('canPlay: tao true when hurt', taoHandler.canPlay({}, hurtPlayer, {}) === true);
  test('canPlay: sha false after 1 attack (no zhuge)', shaHandler.canPlay({}, usedShaPlayer, {}) === false);
  test('canPlay: sha true with 0 attacks', shaHandler.canPlay({}, fullHpPlayer, {}) === true);
}

// Integration test via WebSocket
async function startServer(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    server = spawn('tsx', ['server/index.ts'], {
      env: { ...process.env, PORT: String(PORT) }, stdio: ['pipe', 'pipe', 'pipe']
    });
    server.stdout.on('data', (d: Buffer) => {
      const m = d.toString().match(/PIN=(\d{4})/);
      if (m) resolve(m[1]);
    });
    setTimeout(() => reject(new Error('server start timeout')), 5000);
  });
}

async function integrationTest() {
  const pin = await startServer();
  console.log(`\n=== Illegal Move Tests (WebSocket, PIN=${pin}) ===\n`);

  const p1 = await createWsPlayer('localhost', PORT);
  const p2 = await createWsPlayer('localhost', PORT);
  p1.send({ type: 'join_room', pin, name: 'P1' });
  await p1.waitFor('room_joined');
  p2.send({ type: 'join_room', pin, name: 'P2' });
  await p1.waitFor('hero_selection');
  await p2.waitFor('hero_selection');
  p1.send({ type: 'select_hero', heroId: 'caocao' });
  p2.send({ type: 'select_hero', heroId: 'guanyu' });
  await sleep(500);
  p1.drain();

  // Find who is current player and get their hand
  // Try to play a card with bogus target via P1
  const privMsg = await p1.waitFor('private_update').catch(() => null);
  const myHand = privMsg?.state?.myHand || [];
  const shaCard = myHand.find((c: any) => c.def.id === 'sha');

  if (shaCard) {
    p1.drain();
    p1.send({ type: 'play_card', cardUid: shaCard.uid, targetId: 'bogus_id' });
    await sleep(300);
    const msgs = p1.drain();
    const warning = msgs.find((m: any) => m.type === 'log' && m.msg.includes('无法'));
    test('WebSocket: sha on invalid target returns log warning', !!warning, `msgs: ${JSON.stringify(msgs.filter((m:any)=>m.type==='log'))}`);
  } else {
    console.log('  (no sha in hand, skipping WS test)');
  }

  server.kill();
}

integrationTest().then(() => {
  console.log(`\n=== Total: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}).catch(e => { console.error(e); server?.kill(); process.exit(1); });
