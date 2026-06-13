import * as http from 'http';
import * as crypto from 'crypto';
import * as readline from 'readline';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const GameClient = require('../shared/game-client.cjs');
const { createGameClient, formatCard, hpText, formatEquip, phaseName, suitSymbol, kingdomName } = GameClient;

const args = process.argv.slice(2);
function getArg(name: string, def: string): string {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const HOST = getArg('--host', 'localhost');
const PORT = getArg('--port', '3000');
const NAME = getArg('--name', 'Player');
const JOIN_PIN = getArg('--join', '');
const INTERACTIVE = args.includes('--interactive');

const client = createGameClient();
let sendFn: (obj: any) => void = () => {};

// WebSocket client via raw HTTP upgrade
function connectWs(): Promise<void> {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: HOST, port: Number(PORT), path: '/', method: 'GET',
      headers: { 'Upgrade': 'websocket', 'Connection': 'Upgrade', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' }
    });
    req.on('upgrade', (_res, socket) => {
      sendFn = (obj) => {
        const payload = Buffer.from(JSON.stringify(obj));
        const mask = crypto.randomBytes(4);
        let header: Buffer;
        if (payload.length < 126) {
          header = Buffer.alloc(6);
          header[0] = 0x81; header[1] = 0x80 | payload.length;
          mask.copy(header, 2);
        } else {
          header = Buffer.alloc(8);
          header[0] = 0x81; header[1] = 0x80 | 126;
          header.writeUInt16BE(payload.length, 2);
          mask.copy(header, 4);
        }
        const masked = Buffer.from(payload);
        for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
        socket.write(Buffer.concat([header, masked]));
      };

      let buffer = Buffer.alloc(0);
      socket.on('data', (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);
        while (buffer.length >= 2) {
          let payloadLen = buffer[1] & 0x7f;
          let offset = 2;
          if (payloadLen === 126) { if (buffer.length < 4) return; payloadLen = buffer.readUInt16BE(2); offset = 4; }
          if (buffer.length < offset + payloadLen) return;
          const payload = buffer.subarray(offset, offset + payloadLen).toString();
          buffer = buffer.subarray(offset + payloadLen);
          try { client.handleMessage(JSON.parse(payload)); } catch {}
        }
      });
      socket.on('close', () => { process.stderr.write('Disconnected\n'); process.exit(1); });
      resolve();
    });
    req.on('error', reject);
    req.end();
  });
}

// Interactive renderer
function renderInteractive(state: any, msg: any) {
  if (INTERACTIVE) {
    if (msg && msg.type === 'log') { console.log('  📜 ' + msg.msg); return; }
    if (state.error) { console.error(`\n❌ 错误: ${state.error}`); process.exit(1); }
    if (state.screen === 'waiting') {
      console.log('\n等待对手加入... PIN: ' + state.pin);
      return;
    }
    if (state.screen === 'hero_select') {
      if (!state.heroes) { console.log('\n>> 其他玩家正在选择武将'); return; }
      console.log('\n选择武将:');
      state.heroes.forEach((h: any, i: number) => {
        console.log(`  [${i + 1}] ${h.nameCn} (${kingdomName(h.kingdom)}) HP:${h.maxHp}`);
      });
      rl.setPrompt('选择编号> ');
      rl.prompt();
      return;
    }
    if (state.screen === 'gameover') {
      console.log('\n🏆 游戏结束! ' + state.winner + ' 获胜!');
      process.exit(0);
    }
    if (state.screen === 'game') {
      const gs = state.gameState;
      if (!gs) return;
      const me = client.getMyPlayer();
      const opp = client.getOpponent();
      if (!me || !opp) return;
      console.log('\n' + '─'.repeat(50));
      console.log(`对手: ${opp.name}(${opp.heroId}) HP:${hpText(opp.hp, opp.maxHp)} 手牌:${opp.handCount} ${formatEquip(opp.equipment)}`);
      console.log(`第${gs.turnNumber}回合 | ${phaseName(gs.phase)} | 牌堆:${gs.deckCount}`);
      console.log(`你: ${me.name}(${me.heroId}) HP:${hpText(me.hp, me.maxHp)}`);
      const hand = state.myHand || [];
      if (hand.length > 0) {
        console.log('手牌:');
        hand.forEach((c: any, i: number) => {
          const sel = state.selectedCards.includes(c.uid) ? ' ✓' : '';
          console.log(`  [${i + 1}] ${formatCard(c)}${sel}`);
        });
      }
      // Status hint
      const waiting = gs.waitingFor;
      const isMyTurn = client.isMyTurn();
      if (waiting && waiting.playerId === state.myId) {
        const types: Record<string, string> = { respond_attack: '响应杀', respond_duel: '响应决斗', respond_barbarian: '响应南蛮/万箭', discard: '弃牌' };
        console.log(`\n>> 等待你${types[waiting.type] || '响应'}`);
      } else if (waiting) {
        const who = gs.players.find((p: any) => p.id === waiting.playerId);
        const types: Record<string, string> = { respond_attack: '响应杀', respond_duel: '响应决斗', respond_barbarian: '响应南蛮/万箭', discard: '弃牌' };
        console.log(`\n>> 等待 ${who?.name || waiting.playerId} ${types[waiting.type] || '响应'}`);
      } else if (isMyTurn && gs.phase === 'play') {
        console.log('\n>> 等待你出牌');
      } else {
        console.log('\n>> 等待对手出牌');
      }

      const actions = client.getAvailableActions();
      if (actions.length > 0) {
        console.log('操作: ' + actions.map((a: any) => `(${a.id[0]})${a.label}`).join('  '));
        console.log('提示: 输入数字选牌, p=出牌, e=结束, r=响应, d=弃牌, 直接回车=放弃');
        rl.setPrompt('> ');
        rl.prompt();
      }
    }
  } else {
    // JSON pipe mode
    if (msg) console.log(JSON.stringify(msg));
  }
}

client.setOnChange(renderInteractive);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: INTERACTIVE });

rl.on('line', (line: string) => {
  const input = line.trim();
  if (!input) {
    if (INTERACTIVE && client.state.screen === 'game') {
      const gs = client.state.gameState;
      const waiting = gs?.waitingFor;
      if (waiting && waiting.playerId === client.state.myId && waiting.type !== 'discard') {
        sendFn({ type: 'respond', cardUid: null });
      }
    }
    return;
  }

  if (!INTERACTIVE) {
    // JSON pipe mode: parse and send directly
    try { sendFn(JSON.parse(input)); } catch { process.stderr.write('Invalid JSON\n'); }
    return;
  }

  const state = client.state;

  if (state.screen === 'lobby') {
    // Not used in auto-mode
    return;
  }

  if (state.screen === 'hero_select') {
    const idx = parseInt(input) - 1;
    if (state.heroes && idx >= 0 && idx < state.heroes.length) {
      sendFn({ type: 'select_hero', heroId: state.heroes[idx].id });
    }
    return;
  }

  if (state.screen === 'game') {
    // Select card by number
    if (/^\d+$/.test(input)) {
      const idx = parseInt(input) - 1;
      const hand = state.myHand || [];
      if (idx >= 0 && idx < hand.length) {
        client.toggleCard(hand[idx].uid);
      }
      return;
    }
    // Actions by first letter
    const actions = client.getAvailableActions();
    const action = actions.find((a: any) => a.id[0] === input[0]);
    if (action) {
      const cmd = client.buildCommand(action.id);
      if (cmd) { sendFn(cmd); client.clearSelection(); }
      else if (action.id === 'play') console.log('请先选择1张牌 (输入编号)');
    }
  }
});

async function main() {
  await connectWs();
  if (INTERACTIVE) console.log('已连接到 ' + HOST + ':' + PORT);
  if (JOIN_PIN) { sendFn({ type: 'join_room', pin: JOIN_PIN, name: NAME }); }
  else if (INTERACTIVE) { rl.setPrompt('输入PIN加入> '); rl.prompt(); }
}

main().catch(e => { process.stderr.write('Error: ' + e.message + '\n'); process.exit(1); });
