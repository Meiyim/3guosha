import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createGameClient } = require('../shared/game-client.cjs');
import { WsClient } from '../shared/ws-client.ts';

const args = process.argv.slice(2);
function getArg(name: string, def: string): string {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const HOST = getArg('--host', 'localhost');
const PORT = Number(getArg('--port', '3000'));
const NAME = getArg('--name', 'AI');
const JOIN_PIN = getArg('--join', '');

const client = createGameClient();
const ws = new WsClient();
let usedShaThisTurn: Record<string, boolean> = {};

ws.on('message', (msg: any) => {
  client.handleMessage(msg);
  if (msg.type === 'game_over') {
    console.log(`Game Over! Winner: ${msg.winner}`);
    process.exit(0);
  }
});

let actionTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAction() {
  if (actionTimer) return;
  actionTimer = setTimeout(() => {
    actionTimer = null;
    doAction();
  }, 50);
}

function doAction() {
  const state = client.state;
  if (state.screen !== 'game' || !state.gameState) return;

  const gs = state.gameState;
  const myId = state.myId;
  const hand = state.myHand || [];
  const me = gs.players.find((p: any) => p.id === myId);
  const opp = gs.players.find((p: any) => p.id !== myId);
  if (!opp || !me) return;

  if (gs.waitingFor && gs.waitingFor.playerId === myId) {
    const w = gs.waitingFor;
    if (w.type === 'discard') {
      const uids = hand.slice(0, w.data.count).map((c: any) => c.uid);
      ws.send({ type: 'discard_cards', cardUids: uids });
    } else if (w.type === 'respond_attack') {
      const shan = hand.find((c: any) => c.def.id === 'shan');
      ws.send({ type: 'respond', cardUid: shan ? shan.uid : null });
    } else if (w.type === 'respond_duel' || w.type === 'respond_barbarian') {
      const sha = hand.find((c: any) => c.def.id === 'sha');
      ws.send({ type: 'respond', cardUid: sha ? sha.uid : null });
    } else {
      ws.send({ type: 'respond', cardUid: null });
    }
    return;
  }

  const isMyTurn = gs.players[gs.currentPlayerIdx].id === myId;
  if (!isMyTurn || gs.phase !== 'play' || gs.waitingFor) return;

  const turnKey = String(gs.turnNumber);
  if (me.hp < me.maxHp) {
    const tao = hand.find((c: any) => c.def.id === 'tao');
    if (tao) { ws.send({ type: 'play_card', cardUid: tao.uid }); return; }
  }
  const eq = hand.find((c: any) => c.def.type === 'equipment');
  if (eq) { ws.send({ type: 'play_card', cardUid: eq.uid }); return; }
  const wz = hand.find((c: any) => c.def.id === 'wuzhong');
  if (wz) { ws.send({ type: 'play_card', cardUid: wz.uid }); return; }
  if (!usedShaThisTurn[turnKey]) {
    const sha = hand.find((c: any) => c.def.id === 'sha');
    if (sha) { ws.send({ type: 'play_card', cardUid: sha.uid, targetId: opp.id }); usedShaThisTurn[turnKey] = true; return; }
  }
  const trick = hand.find((c: any) => c.def.id === 'juedou' || c.def.id === 'nanman' || c.def.id === 'wanjian');
  if (trick) { ws.send({ type: 'play_card', cardUid: trick.uid, targetId: opp.id }); return; }
  ws.send({ type: 'end_play' });
}

client.setOnChange((state: any, msg: any) => {
  if (state.screen === 'hero_select') {
    ws.send({ type: 'select_hero', heroId: 'caocao' });
    console.log('Selected hero: 曹操');
    return;
  }
  scheduleAction();
});

async function main() {
  if (!JOIN_PIN) { console.error('Usage: ai_bot.ts --join <PIN> [--port PORT] [--name NAME]'); process.exit(1); }
  await ws.connect(HOST, PORT);
  console.log(`AI Bot connected to ${HOST}:${PORT}`);
  ws.send({ type: 'join_room', pin: JOIN_PIN, name: NAME });
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
