import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createGameClient } = require('../shared/game-client.cjs');
import { chooseHeuristicAction, createOpenAIAgent } from '../server/arena/agents/index.ts';
import { WsClient } from '../shared/ws-client.ts';
import type { LegalAction, PlayerObservation } from '../server/game/types.ts';

const args = process.argv.slice(2);
function getArg(name: string, def: string): string {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const HOST = getArg('--host', 'localhost');
const PORT = Number(getArg('--port', '3000'));
const NAME = getArg('--name', 'AI');
const JOIN_PIN = getArg('--join', '');
const HERO_ID = getArg('--hero', 'caocao');
const AGENT_KIND = getArg('--agent', 'heuristic');
const ACTION_DELAY_MS = Number(getArg('--delay', '50'));

const client = createGameClient();
const ws = new WsClient();
const llmAgent = createOpenAIAgent({ timeoutMs: Number(process.env.LLM_AGENT_TIMEOUT_MS || process.env.DEV_LLM_AGENT_TIMEOUT_MS || 60000) });

ws.on('message', (msg: any) => {
  client.handleMessage(msg);
  if (msg.type === 'game_over') {
    console.log(`Game Over! Winner: ${msg.winner}`);
    process.exit(0);
  }
  if (msg.type === 'room_closed') {
    console.log(`Room closed: ${msg.msg || ''}`);
    process.exit(0);
  }
  if (msg.type === 'error') {
    console.error(`Server error: ${msg.msg || ''}`);
    process.exit(1);
  }
});

let actionTimer: ReturnType<typeof setTimeout> | null = null;
let actionInFlight = false;

function scheduleAction() {
  if (actionTimer || actionInFlight) return;
  actionTimer = setTimeout(() => {
    actionTimer = null;
    doAction().catch(e => console.error('Action error:', e.message));
  }, ACTION_DELAY_MS);
}

async function doAction() {
  const state = client.state;
  if (state.screen !== 'game' || !state.gameState) return;

  const gs = state.gameState;
  const myId = state.myId;
  if (!myId) return;
  const observation: PlayerObservation = {
    publicState: gs,
    privateState: {
      myId,
      myHand: state.myHand || [],
      playableUids: state.playableUids || [],
      legalActions: state.legalActions || [],
    },
    legalActions: state.legalActions || [],
  };
  actionInFlight = true;
  let action: LegalAction | null = null;
  try {
    action = await chooseAction(observation);
  } finally {
    actionInFlight = false;
  }
  if (action) ws.send(toClientCommand(action));
}

async function chooseAction(observation: PlayerObservation): Promise<LegalAction | null> {
  if (AGENT_KIND !== 'llm') return chooseHeuristicAction(observation);
  try {
    return await llmAgent.act(observation) || chooseHeuristicAction(observation);
  } catch (e: any) {
    console.error(`LLM agent failed, falling back to heuristic: ${e.message}`);
    return chooseHeuristicAction(observation);
  }
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
    ws.send({ type: 'select_hero', heroId: HERO_ID });
    console.log(`Selected hero: ${HERO_ID}`);
    return;
  }
  if (msg?.type === 'private_update') scheduleAction();
});

async function main() {
  if (!JOIN_PIN) { console.error('Usage: ai_bot.ts --join <PIN> [--port PORT] [--name NAME]'); process.exit(1); }
  await ws.connect(HOST, PORT);
  console.log(`AI Bot connected to ${HOST}:${PORT}`);
  ws.send({ type: 'join_room', pin: JOIN_PIN, name: NAME });
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
