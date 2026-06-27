import { Game, getHeroes } from './game/index.ts';
import { log } from './logger.ts';

// Single room — created on server start, resets after game ends
let room: { pin: string; players: any[]; game: Game | null; state: string; targetPlayerCount: number };
let openJoin = false;
const httpClients = new Map<string, { id: string; queue: any[]; ws: any }>();

export function setOpenJoin(enabled: boolean) { openJoin = enabled; }
let playerIdCounter = 1;

function generatePin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function initRoom(): string {
  const pin = generatePin();
  room = { pin, players: [], game: null, state: 'waiting', targetPlayerCount: 2 };
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

export function startDevGame(token: string, name?: string, playerCount?: number): { ok: boolean; pin?: string; playerCount?: number } {
  const client = httpClients.get(token);
  if (!client) return { ok: false };
  const pin = generatePin();
  const count = Math.max(2, Math.min(8, Math.floor(Number(playerCount) || 2)));
  room = {
    pin,
    state: 'waiting',
    game: null,
    targetPlayerCount: count,
    players: [{ id: client.id, name: name || '开发者', ws: client.ws }],
  };
  send(client.ws, { type: 'room_joined', players: room.players.map(p => ({ id: p.id, name: p.name })), pin });
  log.info(`Developer room ready: players=${count} PIN=${pin}`);
  return { ok: true, pin, playerCount: count };
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
  send(ws, { type: 'room_left' });
  for (const p of others) {
    send(p.ws, { type: 'room_closed', msg: `${leaving.name || '玩家'} 已离开房间` });
  }
  resetRoom();
  return true;
}

function resetRoom(): void {
  const pin = generatePin();
  room = { pin, players: [], game: null, state: 'waiting', targetPlayerCount: 2 };
  log.info(`New room ready: PIN=${pin}`);
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
      if (room.players.length >= room.targetPlayerCount) { send(ws, { type: 'error', msg: '房间已满' }); return; }
      room.players.push({ id: playerId, name: msg.name || 'Player', ws });
      log.info(`${msg.name||'Player'}(${playerId}) joined room PIN=${room.pin}`);
      const playerList = room.players.map(p => ({ id: p.id, name: p.name }));
      for (const p of room.players) send(p.ws, { type: 'room_joined', players: playerList, pin: room.pin });
      if (room.players.length === room.targetPlayerCount) {
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
