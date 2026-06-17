import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createGameClient } = require('../shared/game-client.cjs');
import { chooseHeuristicAction } from '../server/arena/agents/index.ts';
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
  if (!myId) return;
  const action = chooseHeuristicAction({
    publicState: gs,
    privateState: {
      myId,
      myHand: state.myHand || [],
      playableUids: state.playableUids || [],
      legalActions: state.legalActions || [],
    },
    legalActions: state.legalActions || [],
  });
  if (action) ws.send(toClientCommand(action));
}

function toClientCommand(action: any) {
  if (action.type === 'play_card') return { type: 'play_card', cardUid: action.cardUid, targetId: action.targetId, targetIds: action.targetIds };
  if (action.type === 'respond') return { type: 'respond', cardUid: action.cardUid };
  if (action.type === 'discard_cards') return { type: 'discard_cards', cardUids: action.cardUids };
  if (action.type === 'zhiheng') return { type: 'zhiheng', cardUids: action.cardUids };
  return { type: action.type };
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
