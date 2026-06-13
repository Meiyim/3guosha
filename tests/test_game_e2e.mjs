import { spawn } from 'child_process';
import http from 'http';

const SERVER_PORT = 3099;
let server;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = { host: 'localhost', port: SERVER_PORT, path, method, headers: { 'Content-Type': 'application/json' } };
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

function poll(token) { return request('GET', `/api/poll?token=${token}`); }
function action(body) { return request('POST', '/api/action', body); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('node', ['server/index.mjs'], { env: { ...process.env, PORT: String(SERVER_PORT) }, stdio: ['pipe', 'pipe', 'pipe'] });
    server.stderr.on('data', d => { if (d.toString().includes('Error')) console.error('SERVER ERR:', d.toString()); });
    server.stdout.on('data', d => { if (d.toString().includes('running')) resolve(); });
    setTimeout(() => reject(new Error('server start timeout')), 5000);
  });
}

function stopServer() { if (server) { server.kill(); server = null; } }

async function getLatestState(token) {
  const { messages } = await poll(token);
  if (!messages) return { state: null, gameOver: null };
  let state = null, gameOver = null;
  for (const msg of messages) {
    if (msg.type === 'game_over') gameOver = msg.winner;
    if (msg.type === 'game_update') state = msg.state;
  }
  return { state, gameOver };
}

async function main() {
  console.log('Starting server...');
  await startServer();
  console.log('Server started on port', SERVER_PORT);

  try {
    const { token: t1 } = await action({ type: 'connect' });
    const { token: t2 } = await action({ type: 'connect' });
    console.log('Players connected');

    await action({ token: t1, type: 'create_room', name: 'Agent1' });
    await sleep(100);
    const { messages: m1 } = await poll(t1);
    const pin = m1.find(m => m.type === 'room_created')?.pin;
    console.log('Room created, PIN:', pin);

    await action({ token: t2, type: 'join_room', pin, name: 'Agent2' });
    await sleep(200);
    await poll(t1);
    await poll(t2);

    await action({ token: t1, type: 'select_hero', heroId: 'caocao' });
    await action({ token: t2, type: 'select_hero', heroId: 'liubei' });
    await sleep(200);
    console.log('Heroes selected, game starting...');

    const tokens = { p1: t1, p2: t2 };
    let usedShaThisTurn = {};

    for (let i = 0; i < 300; i++) {
      await sleep(30);

      // Poll both and act
      for (const [key, token] of Object.entries(tokens)) {
        const { state, gameOver } = await getLatestState(token);
        if (gameOver) {
          console.log(`PASS - Full duel completed! Winner: ${gameOver}`);
          stopServer();
          console.log('Server stopped.');
          process.exit(0);
        }
        if (!state) continue;

        const myId = state.myId;
        const hand = state.myHand;
        const opp = state.players.find(p => p.id !== myId);

        // Handle waiting
        if (state.waitingFor && state.waitingFor.playerId === myId) {
          if (state.waitingFor.type === 'discard') {
            const uids = hand.slice(0, state.waitingFor.data.count).map(c => c.uid);
            await action({ token, type: 'discard_cards', cardUids: uids });
          } else {
            await action({ token, type: 'respond', cardUid: null });
          }
          continue;
        }

        // My turn
        const isMyTurn = state.players[state.currentPlayerIdx].id === myId;
        if (!isMyTurn || state.phase !== 'play') continue;

        // Track turn to know if we already used sha
        const turnKey = `${myId}_${state.turnNumber}`;
        const alreadyUsedSha = usedShaThisTurn[turnKey];

        const sha = !alreadyUsedSha && hand.find(c => c.def.id === 'sha');
        const trick = hand.find(c => c.def.id === 'juedou' || c.def.id === 'nanman' || c.def.id === 'wanjian');

        if (sha) {
          await action({ token, type: 'play_card', cardUid: sha.uid, targetId: opp.id });
          usedShaThisTurn[turnKey] = true;
        } else if (trick) {
          await action({ token, type: 'play_card', cardUid: trick.uid, targetId: opp.id });
        } else {
          await action({ token, type: 'end_play' });
        }
      }
    }

    console.error('FAIL - Game did not complete in 300 iterations');
    process.exitCode = 1;
  } catch (e) {
    console.error('FAIL - Exception:', e.message, e.stack);
    process.exitCode = 1;
  } finally {
    stopServer();
    console.log('Server stopped.');
  }
}

main();
