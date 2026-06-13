import { Game } from './engine.ts';
import { HEROES } from './heroes.ts';
import { log } from './logger.ts';

const rooms = new Map();
const playerToRoom = new Map();
let playerIdCounter = 1;

const pollingPlayers = new Map(); // playerId -> { ws (polling adapter), token }

function generatePin() {
  let pin;
  do { pin = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(pin));
  return pin;
}

// Adapter: wraps either a real WS or a message queue for HTTP polling
function makePollingWs(playerId) {
  const queue = [];
  return {
    get readyState() { return 1; },
    send(data) { queue.push(data); },
    queue,
    _isPolling: true,
    playerId,
  };
}

export function handleHttpAction(body) {
  // body: { token?, type, ...params }
  // For initial connect, no token needed; returns { token, playerId }
  if (body.type === 'connect') {
    const playerId = body.requestedPlayerId || `p${playerIdCounter++}`;
    const ws = makePollingWs(playerId);
    const token = body.requestedToken || `tk_${playerId}_${Date.now().toString(36)}`;
    pollingPlayers.set(token, { ws, playerId });
    // If pin requested, auto-create room
    if (body.pin) {
      const room = { pin: body.pin, players: [{ id: playerId, name: body.name || 'Player', ws }], game: null, state: 'waiting' };
      rooms.set(body.pin, room);
      playerToRoom.set(playerId, body.pin);
    }
    return { token, playerId };
  }

  const entry = pollingPlayers.get(body.token);
  if (!entry) return { error: 'invalid token' };

  handleMessage(entry.ws, entry.playerId, body);
  return { ok: true };
}

export function handleHttpPoll(token) {
  const entry = pollingPlayers.get(token);
  if (!entry) return { error: 'invalid token' };
  const msgs = entry.ws.queue.splice(0).map(s => JSON.parse(s));
  return { messages: msgs };
}

export function handleConnection(ws) {
  let playerId = `p${playerIdCounter++}`;
  ws.on('message', (raw) => {
    try { handleMessage(ws, playerId, JSON.parse(raw)); } catch {}
  });
  ws.on('close', () => {
    const pin = playerToRoom.get(playerId);
    if (pin) {
      const room = rooms.get(pin);
      if (room) { room.players = room.players.filter(p => p.id !== playerId); if (room.players.length === 0) rooms.delete(pin); }
      playerToRoom.delete(playerId);
    }
  });
}

function handleMessage(ws, playerId, msg) {
  log.debug(`<- ${playerId} ${msg.type}`, msg.type === 'play_card' ? `card:${msg.cardUid} target:${msg.targetId}` : msg.type === 'respond' ? `card:${msg.cardUid}` : '');
  switch (msg.type) {
    case 'create_room': {
      const pin = generatePin();
      const room = { pin, players: [{ id: playerId, name: msg.name || 'Player', ws }], game: null, state: 'waiting' };
      rooms.set(pin, room);
      playerToRoom.set(playerId, pin);
      send(ws, { type: 'room_created', pin });
      send(ws, { type: 'room_joined', players: [{ id: playerId, name: room.players[0].name }] });
      break;
    }
    case 'join_room': {
      const room = rooms.get(msg.pin);
      if (!room || room.state !== 'waiting') { send(ws, { type: 'error', msg: '房间不存在或已开始' }); return; }
      if (room.players.length >= 2) { send(ws, { type: 'error', msg: '房间已满' }); return; }
      room.players.push({ id: playerId, name: msg.name || 'Player', ws });
      playerToRoom.set(playerId, msg.pin);
      const playerList = room.players.map(p => ({ id: p.id, name: p.name }));
      for (const p of room.players) send(p.ws, { type: 'room_joined', players: playerList });
      if (room.players.length === 2) {
        room.state = 'hero_select';
        for (const p of room.players) send(p.ws, { type: 'hero_selection', heroes: HEROES });
      }
      break;
    }
    case 'select_hero': {
      const room = getPlayerRoom(playerId);
      if (!room || room.state !== 'hero_select') return;
      const player = room.players.find(p => p.id === playerId);
      if (!player) return;
      player.heroId = msg.heroId;
      if (room.players.every(p => p.heroId)) {
        room.state = 'playing';
        room.game = new Game(room.players.map(p => ({ id: p.id, name: p.name, heroId: p.heroId })));
        room.game.startTurn();
        broadcastState(room);
      }
      break;
    }
    case 'play_card': { const room = getPlayerRoom(playerId); if (room?.game) { room.game.playCard(playerId, msg.cardUid, msg.targetId); broadcastState(room); } break; }
    case 'respond': { const room = getPlayerRoom(playerId); if (room?.game) { room.game.respond(playerId, msg.cardUid); broadcastState(room); } break; }
    case 'end_play': { const room = getPlayerRoom(playerId); if (room?.game) { room.game.endPlay(playerId); broadcastState(room); } break; }
    case 'discard_cards': { const room = getPlayerRoom(playerId); if (room?.game) { room.game.discardCards(playerId, msg.cardUids); broadcastState(room); } break; }
    case 'zhiheng': { const room = getPlayerRoom(playerId); if (room?.game) { room.game.useZhiheng(playerId, msg.cardUids); broadcastState(room); } break; }
  }
}

function broadcastState(room) {
  if (!room.game) return;
  const logs = room.game.popLogs();
  for (const l of logs) log.debug('  LOG:', l);
  const s = room.game.state;
  log.debug(`  state: turn=${s.turnNumber} phase=${s.phase} current=${s.players[s.currentPlayerIdx]?.name} waiting=${s.waitingFor?.type||'none'}(${s.waitingFor?.playerId||''})`);
  log.debug(`  HP: ${s.players.map(p => p.name + ':' + p.hp).join(' | ')}`);
  for (const p of room.players) {
    send(p.ws, { type: 'game_update', state: buildPublicState(room.game, p.id) });
    for (const l of logs) send(p.ws, { type: 'log', msg: l });
    if (room.game.state.winner) {
      const winner = room.game.state.players.find(pl => pl.id === room.game.state.winner);
      send(p.ws, { type: 'game_over', winner: winner?.name || '' });
    }
  }
}

function buildPublicState(game, forPlayerId) {
  const s = game.state;
  const me = s.players.find(p => p.id === forPlayerId);
  return {
    players: s.players.map(p => ({
      id: p.id, name: p.name, heroId: p.heroId,
      hp: p.hp, maxHp: p.maxHp, handCount: p.hand.length,
      equipment: Object.fromEntries(Object.entries(p.equipment).map(([slot, card]) => [slot, (card as any).def])),
      alive: p.alive,
    })),
    currentPlayerIdx: s.currentPlayerIdx, phase: s.phase, deckCount: s.deck.length,
    turnNumber: s.turnNumber, myHand: me.hand, myId: forPlayerId, waitingFor: s.waitingFor,
  };
}

function getPlayerRoom(playerId) { const pin = playerToRoom.get(playerId); return pin ? rooms.get(pin) : undefined; }
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
