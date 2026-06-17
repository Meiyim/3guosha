/**
 * TUI Guided Test Server — 三国杀 TUI Manual Test Harness
 *
 * Usage:
 *   tsx tests/mock_server.ts --port 9999
 *   # Then connect TUI:
 *   tsx cli/tui.ts --port 9999 --join any --name "Tester"
 *
 * Press [x] in TUI at any time to abort and report a bug.
 *
 * ═══════════════════════════════════════════════════════════════════
 * TEST SCENES
 * ═══════════════════════════════════════════════════════════════════
 *
 * Scene 1: 闪响应杀 (Respond to attack with dodge)
 *   Setup:    Hand = [闪], waitingFor = respond_attack (opponent attacked you)
 *   Action:   Select 闪 → press Enter to respond
 *   Pass:     Server receives { type:'respond', cardUid: <shan uid> }
 *   Expect:   Attack canceled, no damage taken
 *
 * Scene 2: 桃回血 (Use peach to heal)
 *   Setup:    HP = 1, Hand = [桃], phase = play (your turn)
 *   Action:   Select 桃 → press Enter to play
 *   Pass:     Server receives { type:'play_card', cardUid: <tao uid> }
 *   Expect:   HP increases from 1 to 2
 *
 * Scene 3: 弃桃牌 (Discard excess peach cards)
 *   Setup:    HP = 4(full), Hand = [桃x6], phase = discard, must discard 2
 *   Action:   Space on card1 → Space on card2 → Enter to submit
 *   Pass:     Server receives { type:'discard_cards', cardUids: [uid1, uid2] }
 *   Expect:   Hand reduced from 6 to 4
 *
 * Scene 4: 弃闪牌 (Discard excess dodge cards)
 *   Setup:    HP = 4(full), Hand = [闪x6], phase = discard, must discard 2
 *   Action:   Space on card1 → Space on card2 → Enter to submit
 *   Pass:     Server receives { type:'discard_cards', cardUids: [uid1, uid2] }
 *   Expect:   Hand reduced from 6 to 4
 *
 * Scene 5: 杀攻击对手 (Attack opponent with sha)
 *   Setup:    Hand = [杀], phase = play (your turn)
 *   Action:   Select 杀 → Enter → select target (假想敌) → Enter
 *   Pass:     Server receives { type:'play_card', cardUid: <sha uid>, targetId:'opp' }
 *   Expect:   Opponent HP decreases by 1
 *
 * ═══════════════════════════════════════════════════════════════════
 */

import * as http from 'http';
import { MinimalWebSocketServer, MinimalWebSocket } from '../server/ws.ts';

const PORT = Number(process.argv.find((a, i) => process.argv[i-1] === '--port') || '9999');

const HEROES = [
  { id: 'caocao', name: 'Cao Cao', nameCn: '曹操', maxHp: 4, gender: 'male', kingdom: 'wei', skillIds: ['jianxiong'] },
];

let uid = 1;
function makeCard(id: string): any {
  const defs: Record<string, any> = {
    sha: { id: 'sha', name: 'sha', nameCn: '杀', type: 'basic', suit: 'spade', number: 7 },
    shan: { id: 'shan', name: 'shan', nameCn: '闪', type: 'basic', suit: 'diamond', number: 2 },
    tao: { id: 'tao', name: 'tao', nameCn: '桃', type: 'basic', suit: 'heart', number: 5 },
  };
  return { uid: uid++, def: defs[id] };
}

let ws: MinimalWebSocket | null = null;
let hand: any[] = [];
let hp = 4;
let maxHp = 4;
let oppHp = 4;
let sceneIdx = 0;
let results: { id: number; status: string; detail?: string }[] = [];
let msgLog: any[] = [];

function send(msg: any) { if (ws) { ws.send(JSON.stringify(msg)); msgLog.push({ dir: 'out', msg }); } }

function sendState(phase: string, waitingFor: any = null) {
  send({
    type: 'game_update',
    state: {
      players: [
        { id: 'p1', name: 'You', heroId: 'caocao', hp, maxHp, handCount: hand.length, equipment: {}, alive: true },
        { id: 'opp', name: '假想敌', heroId: 'guanyu', hp: oppHp, maxHp: 4, handCount: 5, equipment: {}, alive: true },
      ],
      currentPlayerIdx: 0,
      phase,
      deckCount: 60,
      turnNumber: sceneIdx + 1,
      waitingFor,
    }
  });
  const playableUids = hand.filter(c => {
    if (c.def.id === 'shan') return false;
    if (c.def.id === 'tao' && hp >= maxHp) return false;
    return true;
  }).map(c => c.uid);
  send({ type: 'private_update', state: { myId: 'p1', myHand: hand, playableUids } });
}

interface Scene {
  id: number;
  name: string;
  instruction: string;
  setup(): void;
  validate(msg: any): 'pass' | 'fail' | 'ignore';
}

const scenes: Scene[] = [
  {
    id: 1, name: '闪响应杀',
    instruction: '【场景1】你被杀了! 请用闪响应 (选闪+Enter)',
    setup() {
      hp = 4; maxHp = 4; oppHp = 4;
      hand = [makeCard('shan')];
      sendState('play', { playerId: 'p1', type: 'respond_attack', data: { source: 'opp' } });
    },
    validate(msg) {
      if (msg.type !== 'respond') return 'ignore';
      if (msg.cardUid === hand[0]?.uid) return 'pass';
      return 'fail';
    }
  },
  {
    id: 2, name: '桃回血',
    instruction: '【场景2】你HP=1! 请使用桃回血 (选桃+Enter)',
    setup() {
      hp = 1; maxHp = 4; oppHp = 4;
      hand = [makeCard('tao')];
      sendState('play');
    },
    validate(msg) {
      if (msg.type !== 'play_card') return 'ignore';
      if (msg.cardUid === hand[0]?.uid) { hp = 2; return 'pass'; }
      return 'fail';
    }
  },
  {
    id: 3, name: '弃桃牌',
    instruction: '【场景3】手牌超出上限! 请弃2张牌 (Space选2张, Enter提交)',
    setup() {
      hp = 4; maxHp = 4; oppHp = 4;
      hand = Array.from({length: 6}, () => makeCard('tao'));
      sendState('discard', { playerId: 'p1', type: 'discard', data: { count: 2 } });
    },
    validate(msg) {
      if (msg.type !== 'discard_cards') return 'ignore';
      if (msg.cardUids?.length === 2) { hand = hand.filter(c => !msg.cardUids.includes(c.uid)); return 'pass'; }
      return 'fail';
    }
  },
  {
    id: 4, name: '弃闪牌',
    instruction: '【场景4】手牌超出上限! 请弃2张闪牌 (Space选2张, Enter提交)',
    setup() {
      hp = 4; maxHp = 4; oppHp = 4;
      hand = Array.from({length: 6}, () => makeCard('shan'));
      sendState('discard', { playerId: 'p1', type: 'discard', data: { count: 2 } });
    },
    validate(msg) {
      if (msg.type !== 'discard_cards') return 'ignore';
      if (msg.cardUids?.length === 2) { hand = hand.filter(c => !msg.cardUids.includes(c.uid)); return 'pass'; }
      return 'fail';
    }
  },
  {
    id: 5, name: '杀攻击对手',
    instruction: '【场景5】请对假想敌使用杀 (选杀+Enter → 选目标+Enter)',
    setup() {
      hp = 4; maxHp = 4; oppHp = 4;
      hand = [makeCard('sha')];
      sendState('play');
    },
    validate(msg) {
      if (msg.type !== 'play_card') return 'ignore';
      if (msg.cardUid === hand[0]?.uid && msg.targetId === 'opp') { oppHp = 3; return 'pass'; }
      if (msg.cardUid === hand[0]?.uid) return 'fail';
      return 'ignore';
    }
  },
];

function startScene() {
  if (sceneIdx >= scenes.length) { finish(); return; }
  const scene = scenes[sceneIdx];
  console.log(`\n--- 场景${scene.id}: ${scene.name} ---`);
  msgLog = [];
  scene.setup();
  send({ type: 'log', msg: scene.instruction });
}

function handleMsg(msg: any) {
  msgLog.push({ dir: 'in', msg });

  if (msg.type === 'abort') {
    const scene = scenes[sceneIdx];
    results.push({ id: scene.id, status: 'ABORTED', detail: 'TUI操作异常，用户取消' });
    console.log(`  ✗ 场景${scene.id} 被用户取消 — TUI操作异常`);
    console.log('  DEBUG:', JSON.stringify({ scene: scene.name, hp, hand: hand.map(c => c.def.id), recentMsgs: msgLog.slice(-6) }, null, 2));
    finish();
    return;
  }

  if (sceneIdx >= scenes.length) return;
  const scene = scenes[sceneIdx];
  const result = scene.validate(msg);
  if (result === 'ignore') return;

  if (result === 'pass') {
    results.push({ id: scene.id, status: 'PASS' });
    console.log(`  ✓ 场景${scene.id} 通过`);
    send({ type: 'log', msg: `✓ 场景${scene.id}通过!` });
  } else {
    results.push({ id: scene.id, status: 'FAIL', detail: JSON.stringify(msg) });
    console.log(`  ✗ 场景${scene.id} 失败:`, JSON.stringify(msg));
    send({ type: 'log', msg: `✗ 场景${scene.id}失败` });
  }
  sceneIdx++;
  setTimeout(startScene, 300);
}

function finish() {
  console.log('\n========== 测试结果 ==========');
  const passed = results.filter(r => r.status === 'PASS').length;
  for (const r of results) {
    console.log(`  场景${r.id}: ${r.status}${r.detail ? ' - ' + r.detail : ''}`);
  }
  console.log(`\n  ${passed}/${results.length} 通过`);
  send({ type: 'log', msg: `\n===== 测试完成: ${passed}/${results.length} 通过 =====` });
  send({ type: 'game_over', winner: passed === scenes.length ? '全部通过!' : '存在失败' });
  setTimeout(() => process.exit(passed === scenes.length ? 0 : 1), 1000);
}

const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
const wss = new MinimalWebSocketServer(server);

wss.on('connection', (socket: MinimalWebSocket) => {
  ws = socket;
  console.log('TUI tester connected');

  socket.on('message', (raw: string) => {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join_room') {
      send({ type: 'room_joined', players: [{ id: 'p1', name: msg.name || 'Tester' }] });
      send({ type: 'hero_selection', heroes: HEROES });
      return;
    }
    if (msg.type === 'select_hero') {
      send({ type: 'log', msg: '游戏开始! 按提示操作完成5个测试场景。按x可随时取消。' });
      setTimeout(startScene, 300);
      return;
    }
    handleMsg(msg);
  });

  socket.on('close', () => { console.log('TUI tester disconnected'); ws = null; });
});

server.listen(PORT, () => {
  console.log(`TUI测试服务器 运行在 port ${PORT}`);
  console.log(`连接: tsx cli/tui.ts --port ${PORT} --join any --name "Tester"`);
  console.log(`\n测试场景:`);
  scenes.forEach(s => console.log(`  ${s.id}. ${s.name}: ${s.instruction}`));
  console.log(`\n等待TUI连接...`);
});
