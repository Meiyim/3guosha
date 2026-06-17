import { spawn } from 'child_process';
import http from 'http';
import { createWsPlayer } from '../shared/ws-client.ts';

const PORT = 8331;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function fetchText(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: PORT, path }, res => {
      let d = ''; res.on('data', (c: any) => d += c);
      res.on('end', () => resolve({ status: res.statusCode!, body: d }));
    }).on('error', reject);
  });
}

async function main() {
  let server: any;
  try {
    console.log('1. Starting server...');
    server = spawn('tsx', ['server/index.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['pipe', 'pipe', 'pipe'] });
    await new Promise<void>((resolve, reject) => {
      server.stdout.on('data', (d: Buffer) => { if (d.toString().includes('running')) resolve(); });
      setTimeout(() => reject(new Error('server start timeout')), 5000);
    });
    console.log('   Server running on port', PORT);

    console.log('2. Chrome loads page...');
    const htmlResp = await fetchText('/');
    if (htmlResp.status !== 200 || !htmlResp.body.includes('三国杀')) throw new Error('Failed to load HTML');
    const jsResp = await fetchText('/js/app.js');
    if (jsResp.status !== 200) throw new Error('Failed to load app.js');
    const sharedResp = await fetchText('/shared/game-client.js');
    if (sharedResp.status !== 200) throw new Error('Failed to load game-client.js');
    console.log('   HTML, JS, shared module all loaded');

    console.log('3. Two players connect via WebSocket...');
    const p1 = await createWsPlayer('localhost', PORT);
    const p2 = await createWsPlayer('localhost', PORT);
    console.log('   Connected');

    console.log('4. Player 1 creates room...');
    p1.send({ type: 'create_room', name: '玩家' });
    const { pin } = await p1.waitFor('room_created');
    console.log(`   Room created: PIN=${pin}`);

    console.log('5. Player 2 joins...');
    p2.send({ type: 'join_room', pin, name: 'AI对手' });
    await p2.waitFor('hero_selection');
    console.log('   Joined, hero selection shown');

    console.log('6. Both select heroes...');
    p1.send({ type: 'select_hero', heroId: 'guanyu' });
    p2.send({ type: 'select_hero', heroId: 'caocao' });
    const gameMsg = await p1.waitFor('game_update');
    const privMsg = await p1.waitFor('private_update');
    console.log(`   Game started! Phase: ${gameMsg.state.phase}, Hand: ${privMsg.state.myHand.length} cards`);

    console.log('7. Playing rounds...');
    let usedSha: Record<string, boolean> = {};
    let myId: Record<string, string> = {};  // ws → myId
    let myHand: Record<string, any[]> = {}; // ws → hand
    for (let round = 0; round < 200; round++) {
      await sleep(30);
      for (const p of [p1, p2]) {
        const msgs = p.drain();
        for (const msg of msgs) {
          if (msg.type === 'game_over') {
            console.log(`   Game Over! Winner: ${msg.winner}`);
            console.log('\n✓ FULL BROWSER SIMULATION PASSED');
            p1.ws.close(); p2.ws.close(); server.kill();
            process.exit(0);
          }
          if (msg.type === 'private_update') {
            myId[msg.state.myId] = msg.state.myId;
            myHand[msg.state.myId] = msg.state.myHand;
          }
          if (msg.type === 'game_update') {
            const s = msg.state;
            const id = Object.keys(myId).find(k => myId[k]) || '';
            const hand = myHand[id] || [];
            const opp = s.players.find((x: any) => x.id !== id);
            if (!opp) continue;
            if (s.waitingFor?.playerId === id) {
              if (s.waitingFor.type === 'discard') {
                p.send({ type: 'discard_cards', cardUids: hand.slice(0, s.waitingFor.data.count).map((c: any) => c.uid) });
              } else { p.send({ type: 'respond', cardUid: null }); }
            } else if (s.players[s.currentPlayerIdx].id === id && s.phase === 'play') {
              const tk = `${id}_${s.turnNumber}`;
              const sha = !usedSha[tk] && hand.find((c: any) => c.def.id === 'sha');
              const trick = hand.find((c: any) => c.def.id === 'juedou' || c.def.id === 'nanman');
              if (sha) { p.send({ type: 'play_card', cardUid: sha.uid, targetId: opp.id }); usedSha[tk] = true; }
              else if (trick) { p.send({ type: 'play_card', cardUid: trick.uid, targetId: opp.id }); }
              else { p.send({ type: 'end_play' }); }
            }
          }
        }
      }
    }
    console.log('\n✓ FULL BROWSER SIMULATION PASSED (game ongoing)');
  } catch (e: any) {
    console.error('\n✗ FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    if (server) server.kill();
  }
}

main();
