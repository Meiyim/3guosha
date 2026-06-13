import { spawn } from 'child_process';
import http from 'http';

const PORT = 8331;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = { host: 'localhost', port: PORT, path, method, headers: { 'Content-Type': 'application/json' } };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(data)); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const poll = (token) => request('GET', `/api/poll?token=${token}`);
const action = (body) => request('POST', '/api/action', body);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  let server;
  let passed = 0, failed = 0;

  function test(name, ok, detail) {
    if (ok) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}: ${detail}`); }
  }

  try {
    // Start server
    server = spawn('node', ['server/index.mjs'], { env: { ...process.env, PORT: String(PORT), VERBOSE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      server.stdout.on('data', d => { if (d.toString().includes('running')) resolve(); });
      setTimeout(() => reject(new Error('server timeout')), 5000);
    });

    console.log('\n=== Browser Join Flow Tests ===\n');

    // Test 1: Connect (page load)
    const connectResp = await action({ type: 'connect' });
    test('Browser connects on page load', connectResp.token && connectResp.playerId,
      JSON.stringify(connectResp));

    // Test 2: AI creates room
    const aiResp = await action({ type: 'connect' });
    test('AI connects', !!aiResp.token, JSON.stringify(aiResp));

    await action({ token: aiResp.token, type: 'create_room', name: 'AI对手' });
    await sleep(50);
    const aiPoll = await poll(aiResp.token);
    const pin = aiPoll.messages.find(m => m.type === 'room_created')?.pin;
    test('AI creates room with PIN', pin && pin.length === 4, `pin=${pin}`);

    // Test 3: Browser joins with correct PIN
    const joinResp = await action({ token: connectResp.token, type: 'join_room', pin, name: '测试玩家' });
    test('Browser joins room (correct PIN)', joinResp.ok === true, JSON.stringify(joinResp));

    // Test 4: Poll returns hero_selection
    await sleep(100);
    const browserPoll = await poll(connectResp.token);
    const hasHeroSelect = browserPoll.messages.some(m => m.type === 'hero_selection');
    test('Browser receives hero_selection after join', hasHeroSelect,
      `msgs: ${browserPoll.messages.map(m => m.type)}`);

    // Test 5: Join with WRONG PIN
    const wrongResp = await action({ type: 'connect' });
    const wrongJoin = await action({ token: wrongResp.token, type: 'join_room', pin: '0000', name: 'bad' });
    // The action returns ok:true but error is in the poll queue
    await sleep(50);
    const wrongPoll = await poll(wrongResp.token);
    const hasError = wrongPoll.messages.some(m => m.type === 'error');
    test('Wrong PIN returns error', hasError,
      `msgs: ${JSON.stringify(wrongPoll.messages)}`);

    // Test 6: Join already-started room fails
    const lateResp = await action({ type: 'connect' });
    const lateJoin = await action({ token: lateResp.token, type: 'join_room', pin, name: 'late' });
    await sleep(50);
    const latePoll = await poll(lateResp.token);
    const lateError = latePoll.messages.some(m => m.type === 'error');
    test('Join full/started room returns error', lateError,
      `msgs: ${JSON.stringify(latePoll.messages)}`);

    // Test 7: Select hero and game starts
    await action({ token: connectResp.token, type: 'select_hero', heroId: 'guanyu' });
    await action({ token: aiResp.token, type: 'select_hero', heroId: 'caocao' });
    await sleep(200);
    const gamePoll = await poll(connectResp.token);
    const hasGameUpdate = gamePoll.messages.some(m => m.type === 'game_update');
    test('Game starts after both select heroes', hasGameUpdate,
      `msgs: ${gamePoll.messages.map(m => m.type)}`);

    // Test 8: Game state is valid
    const gameState = gamePoll.messages.find(m => m.type === 'game_update')?.state;
    test('Game state has hand, players, phase',
      gameState && gameState.myHand.length > 0 && gameState.players.length === 2 && gameState.phase === 'play',
      `phase=${gameState?.phase} hand=${gameState?.myHand?.length} players=${gameState?.players?.length}`);

    // Test 9: Stale token returns error
    const stalePoll = await poll('tk_invalid_token');
    test('Stale/invalid token returns error', stalePoll.error === 'invalid token',
      JSON.stringify(stalePoll));

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
    process.exitCode = failed > 0 ? 1 : 0;

  } catch (e) {
    console.error('EXCEPTION:', e.message);
    process.exitCode = 1;
  } finally {
    if (server) server.kill();
  }
}

main();
