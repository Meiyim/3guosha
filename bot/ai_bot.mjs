import http from 'http';

const TOKEN = process.env.AI_TOKEN;
const PORT = 8331;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = { host: 'localhost', port: PORT, path, method, headers: { 'Content-Type': 'application/json' } };
    const r = http.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({}); } });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

const poll = () => req('GET', `/api/poll?token=${TOKEN}`);
const act = (body) => req('POST', '/api/action', { ...body, token: TOKEN });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let heroSelected = false;
let usedShaThisTurn = {};

async function loop() {
  console.log('AI Bot started, waiting for opponent to join...');
  for (let i = 0; i < 3000; i++) {
    await sleep(1000);
    const { messages } = await poll();
    if (!messages || messages.length === 0) continue;

    for (const msg of messages) {
      if (msg.type === 'game_over') {
        console.log(`Game Over! Winner: ${msg.winner}`);
        process.exit(0);
      }
      if (msg.type === 'hero_selection' && !heroSelected) {
        console.log('Selecting hero: 曹操');
        await act({ type: 'select_hero', heroId: 'caocao' });
        heroSelected = true;
        continue;
      }
      if (msg.type === 'game_update') {
        await handleState(msg.state);
      }
    }
  }
}

async function handleState(state) {
  const myId = state.myId;
  const hand = state.myHand;
  const opp = state.players.find(p => p.id !== myId);

  // Must respond
  if (state.waitingFor && state.waitingFor.playerId === myId) {
    const w = state.waitingFor;
    if (w.type === 'discard') {
      const uids = hand.slice(0, w.data.count).map(c => c.uid);
      console.log(`Discarding ${uids.length} cards`);
      await act({ type: 'discard_cards', cardUids: uids });
    } else if (w.type === 'respond_attack') {
      const shan = hand.find(c => c.def.id === 'shan');
      if (shan) {
        console.log('Using 闪 to dodge');
        await act({ type: 'respond', cardUid: shan.uid });
      } else {
        console.log('No 闪, taking damage');
        await act({ type: 'respond', cardUid: null });
      }
    } else if (w.type === 'respond_duel' || w.type === 'respond_barbarian') {
      const sha = hand.find(c => c.def.id === 'sha');
      if (sha) {
        console.log('Responding with 杀');
        await act({ type: 'respond', cardUid: sha.uid });
      } else {
        console.log('No 杀, taking damage');
        await act({ type: 'respond', cardUid: null });
      }
    } else {
      await act({ type: 'respond', cardUid: null });
    }
    return;
  }

  // My turn
  const isMyTurn = state.players[state.currentPlayerIdx].id === myId;
  if (!isMyTurn || state.phase !== 'play') return;

  const turnKey = state.turnNumber;
  const me = state.players.find(p => p.id === myId);

  // Peach if hurt
  if (me.hp < me.maxHp) {
    const tao = hand.find(c => c.def.id === 'tao');
    if (tao) { console.log('Using 桃'); await act({ type: 'play_card', cardUid: tao.uid }); return; }
  }
  // Equip
  const eq = hand.find(c => c.def.type === 'equipment');
  if (eq) { console.log(`Equipping ${eq.def.nameCn}`); await act({ type: 'play_card', cardUid: eq.uid }); return; }
  // Wuzhong
  const wz = hand.find(c => c.def.id === 'wuzhong');
  if (wz) { console.log('Using 无中生有'); await act({ type: 'play_card', cardUid: wz.uid }); return; }
  // Sha
  if (!usedShaThisTurn[turnKey]) {
    const sha = hand.find(c => c.def.id === 'sha');
    if (sha) { console.log('Using 杀'); await act({ type: 'play_card', cardUid: sha.uid, targetId: opp.id }); usedShaThisTurn[turnKey] = true; return; }
  }
  // Tricks
  const trick = hand.find(c => c.def.id === 'juedou' || c.def.id === 'nanman' || c.def.id === 'wanjian');
  if (trick) { console.log(`Using ${trick.def.nameCn}`); await act({ type: 'play_card', cardUid: trick.uid, targetId: opp.id }); return; }

  // End turn
  console.log('Ending turn');
  await act({ type: 'end_play' });
}

loop().catch(e => { console.error('Bot error:', e); process.exit(1); });
