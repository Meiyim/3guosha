import { spawn } from 'child_process';
import { createWsPlayer } from '../shared/ws-client.ts';

const PORT = 8331;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let server: any;
let passed = 0, failed = 0;
let serverPin = '';

function test(name: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}: ${detail}`); }
}

async function startServer(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    server = spawn('tsx', ['server/index.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['pipe', 'pipe', 'pipe'] });
    server.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      const match = s.match(/PIN=(\d{4})/);
      if (match) resolve(match[1]);
    });
    setTimeout(() => reject(new Error('server start timeout')), 5000);
  });
}

async function main() {
  try {
    serverPin = await startServer();
    console.log(`\n=== Join Flow Tests (WebSocket) PIN=${serverPin} ===\n`);

    // Test 1: Connect
    const p1 = await createWsPlayer('localhost', PORT);
    test('Player connects via WebSocket', true);

    // Test 2: Join with correct PIN
    p1.send({ type: 'join_room', pin: serverPin, name: 'Player A' });
    const joined = await p1.waitFor('room_joined');
    test('Player A joins room', joined.players.length === 1);

    // Test 3: Second player joins → hero selection
    const p2 = await createWsPlayer('localhost', PORT);
    p2.send({ type: 'join_room', pin: serverPin, name: 'Player B' });
    const heroMsg = await p2.waitFor('hero_selection');
    test('Player B joins, hero_selection received', heroMsg.heroes && heroMsg.heroes.length > 0);

    // Test 4: Player A also gets hero_selection
    const heroMsgA = await p1.waitFor('hero_selection');
    test('Player A receives hero_selection', heroMsgA.heroes && heroMsgA.heroes.length > 0);

    // Test 5: Wrong PIN
    const p3 = await createWsPlayer('localhost', PORT);
    p3.send({ type: 'join_room', pin: '0000', name: 'bad' });
    const errMsg = await p3.waitFor('error');
    test('Wrong PIN returns error', errMsg.msg === '房间不存在或已开始', errMsg.msg);

    // Test 6: Select heroes → placeholder game starts
    p1.send({ type: 'select_hero', heroId: 'caocao' });
    p2.send({ type: 'select_hero', heroId: 'guanyu' });
    const gameMsg = await p1.waitFor('game_update');
    const privateMsg = await p1.waitFor('private_update');
    test('Game service broadcasts state after hero selection', gameMsg.state && typeof gameMsg.state.phase === 'string',
      `phase=${gameMsg.state?.phase}`);

    // Test 7: Game state valid
    test('Game state has players and private hand array',
      Array.isArray(privateMsg.state.myHand) && gameMsg.state.players.length === 2,
      `hand=${privateMsg.state.myHand.length} players=${gameMsg.state.players.length}`);

    // Test 8: Join started room
    const p4 = await createWsPlayer('localhost', PORT);
    p4.send({ type: 'join_room', pin: serverPin, name: 'late' });
    const errFull = await p4.waitFor('error');
    test('Join started room returns error', !!errFull.msg, errFull.msg);

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
    process.exitCode = failed > 0 ? 1 : 0;

    p1.ws.close(); p2.ws.close(); p3.ws.close(); p4.ws.close();
  } catch (e: any) {
    console.error('EXCEPTION:', e.message);
    process.exitCode = 1;
  } finally {
    if (server) server.kill();
  }
}

main();
