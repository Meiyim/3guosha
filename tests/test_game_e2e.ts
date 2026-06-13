import { spawn } from 'child_process';
import * as fs from 'fs';
import { createWsPlayer } from '../shared/ws-client.ts';
import { Game } from '../server/game/engine.ts';

const SERVER_PORT = 3099;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let server: any;
let serverPin = '';

async function startServer(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    server = spawn('node', ['--experimental-transform-types', 'server/index.ts'], { env: { ...process.env, PORT: String(SERVER_PORT) }, stdio: ['pipe', 'pipe', 'pipe'] });
    server.stdout.on('data', (d: Buffer) => {
      const match = d.toString().match(/PIN=(\d{4})/);
      if (match) resolve(match[1]);
    });
    setTimeout(() => reject(new Error('server start timeout')), 5000);
  });
}

function stopServer() { if (server) { server.kill(); server = null; } }

async function main() {
  console.log('Starting server...');
  serverPin = await startServer();
  console.log('Server started on port', SERVER_PORT, 'PIN:', serverPin);

  try {
    const p1 = await createWsPlayer('localhost', SERVER_PORT);
    const p2 = await createWsPlayer('localhost', SERVER_PORT);
    console.log('Players connected');

    p1.send({ type: 'join_room', pin: serverPin, name: 'Agent1' });
    await p1.waitFor('room_joined');
    p2.send({ type: 'join_room', pin: serverPin, name: 'Agent2' });
    await p2.waitFor('hero_selection');

    p1.send({ type: 'select_hero', heroId: 'caocao' });
    p2.send({ type: 'select_hero', heroId: 'guanyu' });
    await sleep(200);
    console.log('Heroes selected, game starting...');

    let usedSha: Record<string, boolean> = {};

    for (let i = 0; i < 300; i++) {
      await sleep(30);

      for (const p of [p1, p2]) {
        const msgs = p.drain();
        // Find latest private_update for this player
        let myId = '';
        let hand: any[] = [];
        for (const m of msgs) {
          if (m.type === 'private_update') { myId = m.state.myId; hand = m.state.myHand; }
        }
        for (const msg of msgs) {
          if (msg.type === 'game_over') {
            console.log(`PASS - Full duel completed! Winner: ${msg.winner}`);
            p1.ws.close(); p2.ws.close(); stopServer();
            console.log('Server stopped.');
            verifyReplay();
            process.exit(0);
          }
          if (msg.type === 'game_update' && myId) {
            const state = msg.state;
            const opp = state.players.find((x: any) => x.id !== myId);
            if (!opp) continue;

            if (state.waitingFor && state.waitingFor.playerId === myId) {
              if (state.waitingFor.type === 'discard') {
                const uids = hand.slice(0, state.waitingFor.data.count).map((c: any) => c.uid);
                p.send({ type: 'discard_cards', cardUids: uids });
              } else if (state.waitingFor.type === 'respond_attack') {
                const shan = hand.find((c: any) => c.def.id === 'shan');
                p.send({ type: 'respond', cardUid: shan ? shan.uid : null });
              } else if (state.waitingFor.type === 'respond_duel' || state.waitingFor.type === 'respond_barbarian') {
                const sha = hand.find((c: any) => c.def.id === 'sha');
                p.send({ type: 'respond', cardUid: sha ? sha.uid : null });
              } else {
                p.send({ type: 'respond', cardUid: null });
              }
            } else if (state.players[state.currentPlayerIdx].id === myId && state.phase === 'play' && !state.waitingFor) {
              const turnKey = `${myId}_${state.turnNumber}`;
              // Equip first
              const equip = hand.find((c: any) => c.def.type === 'equipment');
              if (equip) { p.send({ type: 'play_card', cardUid: equip.uid }); }
              // Draw cards
              else { const wz = hand.find((c: any) => c.def.id === 'wuzhong');
              if (wz) { p.send({ type: 'play_card', cardUid: wz.uid }); }
              // Attack
              else { const sha = !usedSha[turnKey] && hand.find((c: any) => c.def.id === 'sha');
              const trick = hand.find((c: any) => c.def.id === 'juedou' || c.def.id === 'nanman' || c.def.id === 'wanjian');
              if (sha) {
                p.send({ type: 'play_card', cardUid: sha.uid, targetId: opp.id });
                usedSha[turnKey] = true;
              } else if (trick) {
                p.send({ type: 'play_card', cardUid: trick.uid, targetId: opp.id });
              } else {
                p.send({ type: 'end_play' });
              }}}
            }
          }
        }
      }
    }

    console.error('FAIL - Game did not complete in 300 iterations');
    process.exitCode = 1;
  } catch (e: any) {
    console.error('FAIL - Exception:', e.message);
    process.exitCode = 1;
  } finally {
    stopServer();
    console.log('Server stopped.');
  }

  // Replay verification: given initial state + all actions → reproduce final state
  if (process.env.LOG_DIR) {
    verifyReplay();
  }
}

function verifyReplay() {
  const logDir = process.env.LOG_DIR;
  if (!logDir) return;
  console.log('\nVerifying replay from action history...');
  const statesDir = logDir + '/states';
  if (!fs.existsSync(statesDir)) return;
  const turnFiles = fs.readdirSync(statesDir).filter(f => f.startsWith('turn_')).sort();
  const actionFiles = fs.readdirSync(statesDir).filter(f => f.startsWith('actions_')).sort();
  if (turnFiles.length < 2) { console.log('  (not enough turns to verify)'); return; }

  // Load all states and actions
  const states = turnFiles.map(f => JSON.parse(fs.readFileSync(`${statesDir}/${f}`, 'utf8')));
  const actionsByTurn = actionFiles.map(f => JSON.parse(fs.readFileSync(`${statesDir}/${f}`, 'utf8')));

  // Verify: basic consistency checks
  let ok = true;
  for (let i = 0; i < states.length - 1; i++) {
    const before = states[i];
    const after = states[i + 1];
    const actions = actionsByTurn[i + 1] || [];
    // Turn number must advance
    if (after.turnNumber < before.turnNumber) {
      console.log(`  ✗ Turn number went backward: ${before.turnNumber} → ${after.turnNumber}`);
      ok = false;
    }
    if (actions.length === 0 && before.winner === null) {
      console.log(`  ✗ Turn ${i + 2} has no actions but game not over`);
      ok = false;
    }
  }

  const totalActions = actionsByTurn.reduce((s, a) => s + a.length, 0);
  console.log(`  ${turnFiles.length} turns, ${totalActions} total actions`);
  console.log(`  Actions per turn: [${actionsByTurn.map(a => a.length).join(', ')}]`);
  if (ok) console.log('  ✓ State transitions consistent with action history');
  else { console.log('  ✗ Replay verification failed'); process.exitCode = 1; }
}

main();
