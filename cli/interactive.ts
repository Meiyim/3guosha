// Arrow-key based interactive TUI for 三国杀 CLI
// Uses raw stdin mode for keypress handling, no external deps

import * as http from 'http';
import * as crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createGameClient, formatCard, hpText, formatEquip, phaseName, suitSymbol, kingdomName } = require('../shared/game-client.cjs');

const args = process.argv.slice(2);
function getArg(name: string, def: string): string {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const HOST = getArg('--host', 'localhost');
const PORT = getArg('--port', '3000');
const NAME = getArg('--name', 'Player');
const JOIN_PIN = getArg('--join', '');

const client = createGameClient();
let sendFn: (obj: any) => void = () => {};
let cursor = 0;  // current selection index

// Connect WebSocket
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
          header = Buffer.alloc(6); header[0] = 0x81; header[1] = 0x80 | payload.length; mask.copy(header, 2);
        } else {
          header = Buffer.alloc(8); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); mask.copy(header, 4);
        }
        const masked = Buffer.from(payload);
        for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
        socket.write(Buffer.concat([header, masked]));
      };
      let buffer = Buffer.alloc(0);
      socket.on('data', (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);
        while (buffer.length >= 2) {
          let payloadLen = buffer[1] & 0x7f; let offset = 2;
          if (payloadLen === 126) { if (buffer.length < 4) return; payloadLen = buffer.readUInt16BE(2); offset = 4; }
          if (buffer.length < offset + payloadLen) return;
          const payload = buffer.subarray(offset, offset + payloadLen).toString();
          buffer = buffer.subarray(offset + payloadLen);
          try { client.handleMessage(JSON.parse(payload)); } catch {}
        }
      });
      socket.on('close', () => { write('\n断开连接\n'); process.exit(1); });
      resolve();
    });
    req.on('error', reject);
    req.end();
  });
}

// Terminal helpers
function write(s: string) { process.stdout.write(s); }
function clear() { write('\x1b[2J\x1b[H'); }
function moveTo(row: number, col: number) { write(`\x1b[${row};${col}H`); }
function bold(s: string) { return `\x1b[1m${s}\x1b[0m`; }
function red(s: string) { return `\x1b[31m${s}\x1b[0m`; }
function green(s: string) { return `\x1b[32m${s}\x1b[0m`; }
function yellow(s: string) { return `\x1b[33m${s}\x1b[0m`; }
function dim(s: string) { return `\x1b[2m${s}\x1b[0m`; }
function invert(s: string) { return `\x1b[7m${s}\x1b[0m`; }

function render() {
  const state = client.state;
  clear();

  if (state.error) {
    write(red(`❌ 错误: ${state.error}\n`));
    process.exit(1);
  }

  if (state.screen === 'lobby') {
    write(bold('三国杀 Online\n\n'));
    write('正在连接...\n');
    return;
  }

  if (state.screen === 'waiting') {
    write(bold('三国杀 Online\n\n'));
    write(`等待对手加入... PIN: ${bold(state.pin || '')}\n`);
    return;
  }

  if (state.screen === 'hero_select') {
    if (!state.heroes) { write('等待其他玩家...\n'); return; }
    write(bold('选择武将') + '  (↑↓移动, Enter确认)\n\n');
    state.heroes.forEach((h: any, i: number) => {
      const line = `${h.nameCn} (${kingdomName(h.kingdom)}) HP:${'❤'.repeat(h.maxHp)}`;
      write(i === cursor ? invert(` → ${line} `) + '\n' : `   ${line}\n`);
    });
    return;
  }

  if (state.screen === 'gameover') {
    write(bold(`\n🏆 游戏结束! ${state.winner} 获胜!\n\n`));
    write('按任意键退出...\n');
    return;
  }

  if (state.screen === 'game') {
    const gs = state.gameState;
    if (!gs) return;
    const me = client.getMyPlayer();
    const opp = client.getOpponent();
    if (!me || !opp) return;

    // Opponent
    write(dim('─'.repeat(50)) + '\n');
    write(`  ${opp.name}(${opp.heroId}) HP:${hpText(opp.hp, opp.maxHp)} 手牌:${opp.handCount} ${formatEquip(opp.equipment)}\n`);
    write(dim('─'.repeat(50)) + '\n');
    write(`  第${gs.turnNumber}回合 | ${phaseName(gs.phase)} | 牌堆:${gs.deckCount}\n`);
    write(dim('─'.repeat(50)) + '\n');
    write(`  ${bold(me.name)}(${me.heroId}) HP:${hpText(me.hp, me.maxHp)}\n\n`);

    const hand = state.myHand || [];
    const actions = client.getAvailableActions();

    // Build menu items: cards + actions
    const items: { label: string; type: 'card' | 'action'; idx?: number; id?: string }[] = [];
    hand.forEach((c: any, i: number) => {
      const sel = state.selectedCards.includes(c.uid) ? green(' ✓') : '';
      items.push({ label: `${formatCard(c)}${sel}`, type: 'card', idx: i });
    });
    if (items.length > 0 && actions.length > 0) items.push({ label: '──────', type: 'action', id: 'sep' });
    actions.forEach(a => items.push({ label: a.label, type: 'action', id: a.id }));

    if (cursor >= items.length) cursor = Math.max(0, items.length - 1);

    items.forEach((item, i) => {
      if (item.id === 'sep') { write(`  ${dim('──────────')}\n`); return; }
      const prefix = item.type === 'card' ? '  ' : '  ';
      write(i === cursor ? invert(` → ${item.label} `) + '\n' : `${prefix}  ${item.label}\n`);
    });

    // Status hint + contextual controls
    write('\n');
    const waiting = gs.waitingFor;
    const isMyTurn = client.isMyTurn();
    if (waiting && waiting.playerId === state.myId) {
      const types: Record<string, string> = { respond_attack: '响应杀 (选闪+Enter响应, Esc放弃受伤)', respond_duel: '响应决斗 (选杀+Enter响应, Esc放弃受伤)', respond_barbarian: '响应南蛮/万箭 (选牌+Enter, Esc放弃受伤)', discard: '弃牌 (Space选牌, Enter确认弃牌)' };
      write(yellow(`>> ${types[waiting.type] || '等待你响应'}`) + '\n');
    } else if (waiting) {
      const who = gs.players.find((p: any) => p.id === waiting.playerId);
      write(dim(`>> 等待 ${who?.name} 响应...`) + '\n');
    } else if (isMyTurn && gs.phase === 'play') {
      write(yellow('>> 你的出牌阶段 (Space选牌→Enter出牌, ↓到底选结束出牌)') + '\n');
    } else {
      write(dim('>> 等待对手操作...') + '\n');
    }

    // Show recent logs
    const recent = logLines.slice(-3);
    if (recent.length > 0) {
      write('\n');
      recent.forEach(l => write(dim(`  📜 ${l}`) + '\n'));
    }

    write(dim('\n[↑↓]选牌  [Enter]出牌/响应  [Space]多选(弃牌用)  [Esc/q]放弃') + '\n');
  }
}

// Logs buffer
const logLines: string[] = [];

client.setOnChange((state: any, msg: any) => {
  if (msg?.type === 'log') logLines.push(msg.msg);
  render();
});

// Raw keypress handling
function handleKey(key: Buffer) {
  const s = key.toString();
  const state = client.state;

  // Escape sequences
  if (s === '\x1b[A') { cursor = Math.max(0, cursor - 1); render(); return; } // Up
  if (s === '\x1b[B') { cursor++; render(); return; } // Down
  if (s === '\x1b' || s === 'q') { // Esc or q = pass
    if (state.screen === 'game') {
      const gs = state.gameState;
      const waiting = gs?.waitingFor;
      if (waiting && waiting.playerId === state.myId && waiting.type !== 'discard') {
        sendFn({ type: 'respond', cardUid: null });
      }
    }
    return;
  }
  if (s === '\r' || s === '\n') { // Enter
    if (state.screen === 'hero_select' && state.heroes) {
      if (cursor >= 0 && cursor < state.heroes.length) {
        const hero = state.heroes[cursor];
        sendFn({ type: 'select_hero', heroId: hero.id });
        clear();
        write(bold(`已选择: ${hero.nameCn}\n\n`));
        write('等待对手选择武将...\n');
        cursor = 0;
      }
      return;
    }
    if (state.screen === 'gameover') { process.exit(0); }
    if (state.screen === 'game') {
      const hand = state.myHand || [];
      const actions = client.getAvailableActions();
      const gs = state.gameState;
      const waiting = gs?.waitingFor;
      const isMyTurn = client.isMyTurn();

      if (cursor < hand.length) {
        const card = hand[cursor];
        // Enter on a card: context-dependent action
        if (waiting && waiting.playerId === state.myId) {
          if (waiting.type === 'discard') {
            // Toggle for discard selection
            client.toggleCard(card.uid);
            render();
          } else {
            // Respond with this card
            sendFn({ type: 'respond', cardUid: card.uid });
          }
        } else if (isMyTurn && gs.phase === 'play') {
          // Play this card directly
          const opp = client.getOpponent();
          sendFn({ type: 'play_card', cardUid: card.uid, targetId: opp?.id });
        }
      } else {
        // On an action button
        const sepOffset = hand.length > 0 && actions.length > 0 ? 1 : 0;
        const actionIdx = cursor - hand.length - sepOffset;
        if (actionIdx >= 0 && actionIdx < actions.length) {
          const action = actions[actionIdx];
          if (action.id === 'discard') {
            // Submit discard selection
            const cmd = client.buildCommand('discard');
            if (cmd) { sendFn(cmd); client.clearSelection(); }
          } else {
            const cmd = client.buildCommand(action.id);
            if (cmd) { sendFn(cmd); client.clearSelection(); }
          }
        }
      }
    }
    return;
  }
  if (s === ' ') { // Space = toggle card for multi-select (discard)
    if (state.screen === 'game') {
      const hand = state.myHand || [];
      if (cursor < hand.length) {
        client.toggleCard(hand[cursor].uid);
        render();
      }
    }
    return;
  }
  if (s === '\x03') { process.exit(0); } // Ctrl+C
}

async function main() {
  if (!JOIN_PIN) { console.error('Usage: cli/interactive.ts --join <PIN> [--port PORT] [--name NAME]'); process.exit(1); }
  await connectWs();
  sendFn({ type: 'join_room', pin: JOIN_PIN, name: NAME });

  // Enable raw mode
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', handleKey);
  render();
}

main().catch(e => { write(red(`Error: ${e.message}\n`)); process.exit(1); });
