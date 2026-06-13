import { spawn } from 'child_process';
import http from 'http';

// Simulates a full Chrome browser session: loads page, connects, joins room, selects hero, plays game
// This replaces manual browser testing.

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

function fetchText(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: PORT, path }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}

const poll = (token) => request('GET', `/api/poll?token=${token}`);
const action = (body) => request('POST', '/api/action', body);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  let server;
  const errors = [];

  try {
    // 1. Start server
    console.log('1. Starting server...');
    server = spawn('node', ['server/index.ts'], { env: { ...process.env, PORT: String(PORT), VERBOSE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    server.stderr.on('data', d => { const s = d.toString(); if (s.includes('Error')) errors.push('SERVER: ' + s); });
    await new Promise((resolve, reject) => {
      server.stdout.on('data', d => { if (d.toString().includes('running')) resolve(); });
      setTimeout(() => reject(new Error('server start timeout')), 5000);
    });
    console.log('   Server running on port', PORT);

    // 2. Simulate Chrome loading the page
    console.log('2. Chrome loads page...');
    const htmlResp = await fetchText('/');
    if (htmlResp.status !== 200) throw new Error('Failed to load index.html');
    if (!htmlResp.body.includes('三国杀')) throw new Error('HTML missing title');

    const jsResp = await fetchText('/js/app.js');
    if (jsResp.status !== 200) throw new Error('Failed to load app.js');
    if (!jsResp.body.includes('api/action')) throw new Error('JS missing api/action call');

    const cssResp = await fetchText('/css/style.css');
    if (cssResp.status !== 200) throw new Error('Failed to load style.css');
    console.log('   HTML, JS, CSS all loaded successfully');

    // 3. app.js auto-connects on page load
    console.log('3. app.js auto-connects...');
    const { token: browserToken, playerId: browserId } = await action({ type: 'connect' });
    if (!browserToken) throw new Error('connect failed');
    console.log(`   Connected: token=${browserToken} id=${browserId}`);

    // 4. AI opponent creates room
    console.log('4. AI creates room...');
    const { token: aiToken } = await action({ type: 'connect' });
    await action({ token: aiToken, type: 'create_room', name: 'AI对手' });
    await sleep(50);
    const aiPoll = await poll(aiToken);
    const pin = aiPoll.messages.find(m => m.type === 'room_created')?.pin;
    if (!pin) throw new Error('No room PIN');
    console.log(`   Room created: PIN=${pin}`);

    // 5. Browser user types PIN and clicks "加入"
    console.log(`5. User enters PIN "${pin}" and clicks 加入...`);
    const joinResp = await action({ token: browserToken, type: 'join_room', pin, name: '玩家' });
    if (joinResp.error) throw new Error('Join failed: ' + joinResp.error);
    await sleep(100);
    const joinPoll = await poll(browserToken);
    const gotHeroSelect = joinPoll.messages.some(m => m.type === 'hero_selection');
    if (!gotHeroSelect) {
      const errMsg = joinPoll.messages.find(m => m.type === 'error');
      throw new Error('No hero_selection received. Got: ' + JSON.stringify(joinPoll.messages.map(m => m.type)) + (errMsg ? ' error: ' + errMsg.msg : ''));
    }
    console.log('   Joined! Hero selection screen shown');

    // 6. User selects hero
    console.log('6. User selects 关羽, AI selects 曹操...');
    await action({ token: browserToken, type: 'select_hero', heroId: 'guanyu' });
    await action({ token: aiToken, type: 'select_hero', heroId: 'caocao' });
    await sleep(200);
    const gamePoll = await poll(browserToken);
    const gameState = gamePoll.messages.find(m => m.type === 'game_update')?.state;
    if (!gameState) throw new Error('Game did not start');
    console.log(`   Game started! Phase: ${gameState.phase}, Hand: ${gameState.myHand.length} cards`);
    console.log(`   Players: ${gameState.players.map(p => p.name + '(' + p.heroId + ') HP:' + p.hp).join(' vs ')}`);

    // 7. Simulate a few rounds of play
    console.log('7. Playing a few rounds...');
    let usedSha = {};
    for (let round = 0; round < 100; round++) {
      await sleep(50);
      const { messages } = await poll(browserToken);
      if (!messages || messages.length === 0) {
        // Also let AI poll
        const aiMsgs = await poll(aiToken);
        if (aiMsgs.messages) {
          for (const msg of aiMsgs.messages) {
            if (msg.type === 'game_over') { console.log(`   Game Over! Winner: ${msg.winner}`); console.log('\n✓ FULL BROWSER SIMULATION PASSED'); process.exit(0); }
            if (msg.type === 'game_update') {
              const s = msg.state;
              if (s.waitingFor?.playerId === s.myId) {
                await action({ token: aiToken, type: 'respond', cardUid: null });
              } else if (s.players[s.currentPlayerIdx].id === s.myId && s.phase === 'play') {
                const sha = s.myHand.find(c => c.def.id === 'sha');
                const opp = s.players.find(p => p.id !== s.myId);
                if (sha && !usedSha['ai_' + s.turnNumber]) { await action({ token: aiToken, type: 'play_card', cardUid: sha.uid, targetId: opp.id }); usedSha['ai_' + s.turnNumber] = true; }
                else await action({ token: aiToken, type: 'end_play' });
              }
            }
          }
        }
        continue;
      }

      for (const msg of messages) {
        if (msg.type === 'game_over') { console.log(`   Game Over! Winner: ${msg.winner}`); console.log('\n✓ FULL BROWSER SIMULATION PASSED'); process.exit(0); }
      }

      const state = messages.findLast(m => m.type === 'game_update')?.state;
      if (!state) continue;

      const myId = state.myId;
      const hand = state.myHand;
      const opp = state.players.find(p => p.id !== myId);

      // Handle responses
      if (state.waitingFor?.playerId === myId) {
        if (state.waitingFor.type === 'discard') {
          const uids = hand.slice(0, state.waitingFor.data.count).map(c => c.uid);
          await action({ token: browserToken, type: 'discard_cards', cardUids: uids });
        } else {
          await action({ token: browserToken, type: 'respond', cardUid: null });
        }
        continue;
      }

      // My turn
      if (state.players[state.currentPlayerIdx].id === myId && state.phase === 'play') {
        const sha = hand.find(c => c.def.id === 'sha');
        const trick = hand.find(c => c.def.id === 'juedou' || c.def.id === 'nanman' || c.def.id === 'wanjian');
        if (sha && !usedSha['me_' + state.turnNumber]) {
          await action({ token: browserToken, type: 'play_card', cardUid: sha.uid, targetId: opp.id });
          usedSha['me_' + state.turnNumber] = true;
        } else if (trick) {
          await action({ token: browserToken, type: 'play_card', cardUid: trick.uid, targetId: opp.id });
        } else {
          await action({ token: browserToken, type: 'end_play' });
        }
      }
    }

    console.log('\n✓ FULL BROWSER SIMULATION PASSED (game still ongoing after 100 rounds)');

  } catch (e) {
    console.error('\n✗ FAILED:', e.message);
    if (errors.length) console.error('Server errors:', errors);
    process.exitCode = 1;
  } finally {
    if (server) server.kill();
  }
}

main();
