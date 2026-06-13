import * as http from 'http';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { MinimalWebSocketServer, MinimalWebSocket } from '../server/ws.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv.find((a, i) => process.argv[i-1] === '--port') || '9999');

const CARDS = [
  { id: 'sha', nameCn: '杀', type: 'basic', suits: ['spade','club','heart','diamond'] },
  { id: 'shan', nameCn: '闪', type: 'basic', suits: ['diamond','heart','club'] },
  { id: 'tao', nameCn: '桃', type: 'basic', suits: ['heart'] },
  { id: 'juedou', nameCn: '决斗', type: 'trick', suits: ['spade','club','diamond'] },
  { id: 'nanman', nameCn: '南蛮入侵', type: 'trick', suits: ['spade','club'] },
  { id: 'wanjian', nameCn: '万箭齐发', type: 'trick', suits: ['heart'] },
  { id: 'wuzhong', nameCn: '无中生有', type: 'trick', suits: ['heart'] },
  { id: 'zhuge', nameCn: '诸葛连弩', type: 'equipment', suits: ['club','diamond'], equipSlot: 'weapon' },
];

const HEROES = [
  { id: 'caocao', name: 'Cao Cao', nameCn: '曹操', maxHp: 4, gender: 'male', kingdom: 'wei', skillIds: ['jianxiong'] },
  { id: 'guanyu', name: 'Guan Yu', nameCn: '关羽', maxHp: 4, gender: 'male', kingdom: 'shu', skillIds: ['wusheng'] },
  { id: 'sunquan', name: 'Sun Quan', nameCn: '孙权', maxHp: 4, gender: 'male', kingdom: 'wu', skillIds: ['zhiheng'] },
];

let uidCounter = 1;
function randomCard() {
  const c = CARDS[Math.floor(Math.random() * CARDS.length)];
  const suit = c.suits[Math.floor(Math.random() * c.suits.length)];
  const number = Math.floor(Math.random() * 13) + 1;
  return { uid: uidCounter++, def: { id: c.id, name: c.id, nameCn: c.nameCn, type: c.type, suit, number, equipSlot: (c as any).equipSlot } };
}

// Game state
let hand: any[] = [];
let myId = 'p1';
let heroId = '';
let hp = 4;
let maxHp = 4;
let turnNumber = 1;
let ws: MinimalWebSocket | null = null;

function send(msg: any) { if (ws) ws.send(JSON.stringify(msg)); }

function sendState(phase: string, waitingFor: any = null) {
  send({
    type: 'game_update',
    state: {
      players: [
        { id: myId, name: 'You', heroId, hp, maxHp, handCount: hand.length, equipment: {}, alive: true },
        { id: 'opp', name: '假想敌', heroId: 'caocao', hp: 4, maxHp: 4, handCount: 5, equipment: {}, alive: true },
      ],
      currentPlayerIdx: 0,
      phase,
      deckCount: 60,
      turnNumber,
      waitingFor,
    }
  });
  send({ type: 'private_update', state: { myId, myHand: hand, playableUids: hand.filter(c => c.def.id !== 'shan').map(c => c.uid) } });
}

function startTurn() {
  hand.push(randomCard(), randomCard());
  send({ type: 'log', msg: `--- 第${turnNumber}回合开始，摸2张牌 ---` });
  sendState('play');
}

const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
const wss = new MinimalWebSocketServer(server);

wss.on('connection', (socket: MinimalWebSocket) => {
  ws = socket;
  console.log('Client connected');

  socket.on('message', (raw: string) => {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    console.log('<-', msg.type, msg);

    switch (msg.type) {
      case 'join_room':
        send({ type: 'room_joined', players: [{ id: myId, name: msg.name || 'Player' }] });
        send({ type: 'hero_selection', heroes: HEROES });
        break;

      case 'select_hero':
        heroId = msg.heroId;
        hand = [randomCard(), randomCard(), randomCard(), randomCard()];
        send({ type: 'log', msg: `选择了 ${heroId}，游戏开始!` });
        startTurn();
        break;

      case 'play_card': {
        const idx = hand.findIndex(c => c.uid === msg.cardUid);
        if (idx !== -1) {
          const card = hand.splice(idx, 1)[0];
          send({ type: 'log', msg: `使用了 ${card.def.nameCn} → 假想敌` });
        }
        sendState('play');
        break;
      }

      case 'respond':
        send({ type: 'log', msg: msg.cardUid ? '响应成功' : '放弃响应' });
        sendState('play');
        break;

      case 'end_play': {
        const excess = hand.length - hp;
        if (excess > 0) {
          send({ type: 'log', msg: `需要弃${excess}张牌` });
          sendState('discard', { playerId: myId, type: 'discard', data: { count: excess } });
        } else {
          turnNumber++;
          startTurn();
        }
        break;
      }

      case 'discard_cards': {
        for (const uid of (msg.cardUids || [])) {
          const idx = hand.findIndex(c => c.uid === uid);
          if (idx !== -1) hand.splice(idx, 1);
        }
        send({ type: 'log', msg: `弃牌完成` });
        turnNumber++;
        startTurn();
        break;
      }

      case 'zhiheng': {
        const count = (msg.cardUids || []).length;
        for (const uid of (msg.cardUids || [])) {
          const idx = hand.findIndex(c => c.uid === uid);
          if (idx !== -1) hand.splice(idx, 1);
        }
        for (let i = 0; i < count; i++) hand.push(randomCard());
        send({ type: 'log', msg: `制衡: 弃${count}张摸${count}张` });
        sendState('play');
        break;
      }
    }
  });

  socket.on('close', () => { console.log('Client disconnected'); ws = null; });
});

server.listen(PORT, () => {
  console.log(`Mock server running on port ${PORT}`);
  console.log(`Connect with: node --experimental-transform-types cli/interactive.ts --port ${PORT} --join any --name "Test"`);
});
