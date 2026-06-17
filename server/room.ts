import { Game, getHeroes } from './game/index.ts';
import { createHeuristicAgent, createOpenAIAgent } from './arena/agents/index.ts';
import type { AgentAdapter } from './arena/agents/index.ts';
import { log } from './logger.ts';

// Single room — created on server start, resets after game ends
let room: { pin: string; players: any[]; game: Game | null; state: string };
let openJoin = false;
const httpClients = new Map<string, { id: string; queue: any[]; ws: any }>();
let botActionTimer: ReturnType<typeof setTimeout> | null = null;
const devBotAgent = createHeuristicAgent('dev-heuristic-bot', '开发启发式对手');
const devLlmAgent = createOpenAIAgent({ timeoutMs: Number(process.env.DEV_LLM_AGENT_TIMEOUT_MS || 60000) });
type DevAgentKind = 'heuristic' | 'llm';

export function setOpenJoin(enabled: boolean) { openJoin = enabled; }
let playerIdCounter = 1;

function generatePin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function initRoom(): string {
  const pin = generatePin();
  room = { pin, players: [], game: null, state: 'waiting' };
  log.info(`Room ready: PIN=${pin}`);
  return pin;
}

export function getCurrentPin(): string {
  return room.pin;
}

export function connectHttpClient(): { token: string; playerId: string } {
  const playerId = `p${playerIdCounter++}`;
  const token = `${playerId}_${Math.random().toString(36).slice(2)}`;
  const client = {
    id: playerId,
    queue: [] as any[],
    ws: {
      readyState: 1,
      send(raw: string) {
        try { client.queue.push(JSON.parse(raw)); } catch {}
      },
    },
  };
  httpClients.set(token, client);
  return { token, playerId };
}

export function handleHttpAction(token: string, msg: any): boolean {
  const client = httpClients.get(token);
  if (!client) return false;
  handleMessage(client.ws, client.id, msg);
  return true;
}

export function pollHttpClient(token: string): any[] | null {
  const client = httpClients.get(token);
  if (!client) return null;
  return client.queue.splice(0);
}

export function addDevBot(): boolean {
  if (room.players.some(p => p.isBot)) return true;
  if (room.state !== 'waiting' || room.players.length !== 1) return false;
  const botId = `bot${playerIdCounter++}`;
  const bot = { id: botId, name: '开发对手', heroId: 'caocao', isBot: true, ws: { readyState: 1, send() {} } };
  room.players.push(bot);
  room.state = 'hero_select';
  const playerList = room.players.map(p => ({ id: p.id, name: p.name }));
  for (const p of room.players) send(p.ws, { type: 'room_joined', players: playerList, pin: room.pin });
  for (const p of room.players) send(p.ws, { type: 'hero_selection', heroes: getHeroes(), selectedHeroId: p.heroId || null });
  send(bot.ws, { type: 'hero_selected', heroId: bot.heroId });
  return true;
}

export function startDevGame(token: string, name?: string, playerCount?: number, agentKind?: string): boolean {
  const client = httpClients.get(token);
  if (!client) return false;
  clearBotActionTimer();
  const pin = generatePin();
  const count = Math.max(2, Math.min(8, Math.floor(Number(playerCount) || 2)));
  const botAgentKind: DevAgentKind = agentKind === 'llm' ? 'llm' : 'heuristic';
  const botHeroIds = getHeroes().map(h => h.id).filter(id => id !== 'sunquan');
  const bots = Array.from({ length: count - 1 }, (_, i) => ({
    id: `bot${playerIdCounter++}`,
    name: `${i === 0 ? '开发对手' : `开发对手${i + 1}`}${botAgentKind === 'llm' ? '·LLM' : ''}`,
    heroId: botHeroIds[i % botHeroIds.length],
    isBot: true,
    agentKind: botAgentKind,
    ws: { readyState: 1, send() {} },
  }));
  room = {
    pin,
    state: 'hero_select',
    game: null,
    players: [
      { id: client.id, name: name || '开发者', ws: client.ws },
      ...bots,
    ],
  };
  send(client.ws, { type: 'room_joined', players: room.players.map(p => ({ id: p.id, name: p.name })), pin });
  send(client.ws, { type: 'hero_selection', heroes: getHeroes(), selectedHeroId: null });
  log.info(`Developer game ready: players=${count} agent=${botAgentKind} PIN=${pin}`);
  return true;
}

export function leaveGame(token: string): boolean {
  const client = httpClients.get(token);
  if (!client) return false;
  return leavePlayer(client.id, client.ws);
}

function leavePlayer(playerId: string, ws: any): boolean {
  const leaving = room.players.find(p => p.id === playerId);
  if (!leaving) {
    send(ws, { type: 'room_left' });
    return true;
  }

  const others = room.players.filter(p => p.id !== playerId);
  clearBotActionTimer();
  send(ws, { type: 'room_left' });
  for (const p of others) {
    send(p.ws, { type: 'room_closed', msg: `${leaving.name || '玩家'} 已离开房间` });
  }
  resetRoom();
  return true;
}

function resetRoom(): void {
  clearBotActionTimer();
  const pin = generatePin();
  room = { pin, players: [], game: null, state: 'waiting' };
  log.info(`New room ready: PIN=${pin}`);
}

function clearBotActionTimer(): void {
  if (botActionTimer) {
    clearTimeout(botActionTimer);
    botActionTimer = null;
  }
}

export function handleConnection(ws: any) {
  const playerId = `p${playerIdCounter++}`;
  ws.on('message', (raw: string) => {
    try { handleMessage(ws, playerId, JSON.parse(raw)); } catch {}
  });
  ws.on('close', () => {
    room.players = room.players.filter(p => p.id !== playerId);
  });
}

function handleMessage(ws: any, playerId: string, msg: any) {
  log.debug(`<- ${playerId} ${msg.type}`, msg.type === 'play_card' ? `card:${msg.cardUid} target:${msg.targetId}` : msg.type === 'respond' ? `card:${msg.cardUid}` : '');
  switch (msg.type) {
    case 'join_room': {
      if (!openJoin && room.pin !== msg.pin) { send(ws, { type: 'error', msg: '房间不存在或已开始' }); return; }
      if (room.state !== 'waiting') { send(ws, { type: 'error', msg: '房间不存在或已开始' }); return; }
      if (room.players.length >= 2) { send(ws, { type: 'error', msg: '房间已满' }); return; }
      room.players.push({ id: playerId, name: msg.name || 'Player', ws });
      log.info(`${msg.name||'Player'}(${playerId}) joined room PIN=${room.pin}`);
      const playerList = room.players.map(p => ({ id: p.id, name: p.name }));
      for (const p of room.players) send(p.ws, { type: 'room_joined', players: playerList, pin: room.pin });
      if (room.players.length === 2) {
        room.state = 'hero_select';
        for (const p of room.players) send(p.ws, { type: 'hero_selection', heroes: getHeroes() });
      }
      break;
    }
    case 'select_hero': {
      if (room.state !== 'hero_select') return;
      const player = room.players.find(p => p.id === playerId);
      if (!player) return;
      player.heroId = msg.heroId;
      send(player.ws, { type: 'hero_selected', heroId: msg.heroId });
      if (room.players.every(p => p.heroId)) {
        room.state = 'playing';
        room.game = new Game(room.players.map(p => ({ id: p.id, name: p.name, heroId: p.heroId })));
        room.game.startTurn();
        broadcastState();
      } else {
        for (const p of room.players) send(p.ws, { type: 'hero_selection', heroes: getHeroes(), selectedHeroId: p.heroId || null });
      }
      break;
    }
    case 'play_card': {
      if (room.game) {
        const result = room.game.playCard(playerId, msg.cardUid, msg.targetId);
        if (typeof result === 'string') {
          const p = room.players.find(pl => pl.id === playerId);
          if (p) send(p.ws, { type: 'log', msg: result });
        }
        broadcastState();
      }
      break;
    }
    case 'respond': { if (room.game) { room.game.respond(playerId, msg.cardUid); broadcastState(); } break; }
    case 'end_play': { if (room.game) { room.game.endPlay(playerId); broadcastState(); } break; }
    case 'discard_cards': { if (room.game) { room.game.discardCards(playerId, msg.cardUids); broadcastState(); } break; }
    case 'zhiheng': { if (room.game) { room.game.useZhiheng(playerId, msg.cardUids); broadcastState(); } break; }
    case 'leave_game': {
      leavePlayer(playerId, ws);
      break;
    }
  }
}

function broadcastState() {
  if (!room.game) return;
  const logs = room.game.popLogs();
  for (const l of logs) log.debug('  LOG:', l);
  const s = room.game.state;
  log.debug(`  state: turn=${s.turnNumber} phase=${s.phase} current=${s.players[s.currentPlayerIdx]?.name} waiting=${room.game!.waitingFor?.type||'none'}(${room.game!.waitingFor?.playerId||''})`);
  log.debug(`  HP: ${s.players.map(p => p.name + ':' + p.hp).join(' | ')}`);

  const publicState = buildPublicState(room.game!);
  for (const p of room.players) {
    send(p.ws, { type: 'game_update', state: publicState });
    send(p.ws, { type: 'private_update', state: buildPrivateState(room.game!, p.id) });
    for (const l of logs) send(p.ws, { type: 'log', msg: l });
    if (room.game!.state.winner) {
      const winner = room.game!.state.players.find(pl => pl.id === room.game!.state.winner);
      send(p.ws, { type: 'game_over', winner: winner?.name || '' });
    }
  }
  if (room.game!.state.winner) {
    log.info(`Game ended. Winner: ${room.game!.state.winner}. Resetting room.`);
    resetRoom();
  } else {
    scheduleDevBotAction();
  }
}

function buildPublicState(game: Game) {
  const s = game.state;
  return {
    players: s.players.map(p => ({
      id: p.id, name: p.name, heroId: p.heroId,
      hp: p.hp, maxHp: p.maxHp, handCount: p.hand.length,
      equipment: Object.fromEntries(Object.entries(p.equipment).map(([slot, card]) => [slot, (card as any).def])),
      alive: p.alive,
    })),
    currentPlayerIdx: s.currentPlayerIdx, phase: s.phase, deckCount: s.deck.length,
    turnNumber: s.turnNumber, waitingFor: game.waitingFor,
  };
}

function buildPrivateState(game: Game, forPlayerId: string) {
  const me = game.state.players.find(p => p.id === forPlayerId)!;
  return { myId: forPlayerId, myHand: me.hand, playableUids: game.getPlayableUids(me), legalActions: game.legalActions(forPlayerId) };
}

function send(ws: any, msg: any) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function scheduleDevBotAction() {
  if (botActionTimer || !room.game) return;
  const bot = getActionableDevBot();
  if (!bot) return;
  botActionTimer = setTimeout(() => {
    botActionTimer = null;
    const nextBot = getActionableDevBot();
    if (nextBot) runDevBotAction(nextBot.id).catch(err => log.warn(`Dev bot action failed: ${err.message}`));
  }, 350);
}

function getActionableDevBot() {
  if (!room.game) return null;
  const waiting = room.game.waitingFor;
  if (waiting) {
    return room.players.find(p => p.isBot && p.id === waiting.playerId) || null;
  }
  const current = room.game.currentPlayer;
  if (room.game.state.phase === 'play') {
    return room.players.find(p => p.isBot && p.id === current.id) || null;
  }
  return null;
}

async function runDevBotAction(botId: string) {
  if (!room.game || room.game.state.winner) return;
  const game = room.game;
  const bot = game.getPlayer(botId);
  if (!bot || !bot.alive) return;
  const observation = game.observe(botId);
  if (!observation) return;
  const seat = room.players.find(p => p.id === botId);
  const agent = getDevAgent(seat?.agentKind);
  let action = await agent.act(observation);
  if (!action && agent !== devBotAgent) action = await devBotAgent.act(observation);
  if (action) game.step(botId, action);
  broadcastState();
}

function getDevAgent(kind?: DevAgentKind): AgentAdapter {
  return kind === 'llm' ? withFallback(devLlmAgent) : devBotAgent;
}

function withFallback(agent: AgentAdapter): AgentAdapter {
  return {
    ...agent,
    async act(observation) {
      try {
        const action = await agent.act(observation);
        if (!action) log.warn(`${agent.name} returned no action; falling back to heuristic`);
        return action;
      } catch (err: any) {
        log.warn(`${agent.name} failed: ${err.message}; falling back to heuristic`);
        return devBotAgent.act(observation);
      }
    },
  };
}
