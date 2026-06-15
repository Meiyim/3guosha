import * as http from 'http';
import * as crypto from 'crypto';
import { createRequire } from 'module';
import { Selector } from './selector.ts';
const require = createRequire(import.meta.url);
const { createGameClient, formatCard, hpText, formatEquip, phaseName, suitSymbol, kingdomName } = require('../shared/game-client.cjs');
const { getCardHandler } = require('../server/game/cards/index.ts');
const { TargetType } = require('../server/game/types.ts');
require('../server/game/cards/basic.ts');
require('../server/game/cards/tricks.ts');
require('../server/game/cards/equip.ts');

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
let selectedCardUid: number | null = null;
let cols = process.stdout.columns || 80;
let rows = process.stdout.rows || 24;

// Cards that need a target — derived from handler's targetType
const TARGET_CARDS = new Set(['sha', 'juedou']);
function needsTarget(cardId: string): boolean {
  const handler = getCardHandler(cardId);
  if (handler) return handler.targetType === 'single';
  return TARGET_CARDS.has(cardId);
}

// Client-side playability check — delegates to card handler's canPlay
function canPlayCard(card: any): boolean {
  const handler = getCardHandler(card.def.id);
  if (!handler) return true;
  if (!handler.canPlay) return true;
  const me = client.getMyPlayer();
  if (!me) return true;
  const player = { ...me, hand: client.state.myHand || [] };
  const fakeCtx = { state: client.state.gameState };
  return handler.canPlay(fakeCtx, player, card);
}

// ANSI helpers
const ESC = '\x1b';
const RAW = (s: string) => process.stdout.write(s);

// Terminal lifecycle: enter the alternate screen so we don't trash the user's
// scrollback, hide the cursor while we paint, and guarantee both get reversed
// on every exit path — normal exit, Ctrl-C, server disconnect, crash.
let teardownDone = false;
function setupTerminal() {
  RAW(`${ESC}[?1049h${ESC}[?25l${ESC}[2J${ESC}[H`);
}
function teardownTerminal() {
  if (teardownDone) return;
  teardownDone = true;
  if (process.stdin.isTTY && (process.stdin as any).setRawMode) {
    try { process.stdin.setRawMode(false); } catch {}
  }
  RAW(`${ESC}[?25h${ESC}[?1049l`);
}
process.on('exit', teardownTerminal);
process.on('SIGINT', () => { teardownTerminal(); process.exit(130); });
process.on('SIGTERM', () => { teardownTerminal(); process.exit(143); });
process.on('uncaughtException', (e) => {
  teardownTerminal();
  console.error(e);
  process.exit(1);
});

// Diff renderer: render() collects its output into renderBuf instead of writing
// straight to the terminal. flush() then compares the new frame against the
// previous one and rewrites only the lines that changed, so we never do a
// full-screen erase — that's what eliminates the flicker.
let renderBuf: string | null = null;
let prevLines: string[] = [];
const w = (s: string) => { if (renderBuf !== null) renderBuf += s; else RAW(s); };
// Hard reset: wipe the screen and forget the previous frame so the next render
// repaints everything. Used on resize and screen transitions.
const clear = () => { prevLines = []; RAW(`${ESC}[2J${ESC}[H`); };
const bold = (s: string) => `${ESC}[1m${s}${ESC}[0m`;
const dim = (s: string) => `${ESC}[2m${s}${ESC}[0m`;
const red = (s: string) => `${ESC}[31m${s}${ESC}[0m`;
const green = (s: string) => `${ESC}[32m${s}${ESC}[0m`;
const yellow = (s: string) => `${ESC}[33m${s}${ESC}[0m`;
const blue = (s: string) => `${ESC}[34m${s}${ESC}[0m`;
const cyan = (s: string) => `${ESC}[36m${s}${ESC}[0m`;
const grey = (s: string) => `${ESC}[90m${s}${ESC}[0m`;
const invert = (s: string) => `${ESC}[7m${s}${ESC}[0m`;
const bgYellow = (s: string) => `${ESC}[43m${ESC}[30m${s}${ESC}[0m`;

// Card name shortener (max 2 chars display)
const SHORT_NAMES: Record<string, string> = {
  sha: '杀', shan: '闪', tao: '桃', juedou: '决斗', nanman: '南蛮',
  wanjian: '万箭', wuzhong: '无中', zhuge: '连弩', plus_horse: '+马', minus_horse: '-马'
};
function cardName(id: string): string { return SHORT_NAMES[id] || id.slice(0, 2); }
function suitChar(suit: string): string { return { spade: '♠', heart: '♥', club: '♣', diamond: '♦' }[suit] || '?'; }
function suitColor(suit: string, s: string): string { return (suit === 'heart' || suit === 'diamond') ? red(s) : s; }

// Box drawing
function hline(len: number): string { return '─'.repeat(len); }
function box(lines: string[], width: number): string[] {
  const out: string[] = [];
  out.push('┌' + hline(width - 2) + '┐');
  for (const l of lines) out.push('│' + pad(l, width - 2) + '│');
  out.push('└' + hline(width - 2) + '┘');
  return out;
}
function pad(s: string, len: number): string {
  const vis = visLen(s);
  return vis >= len ? s : s + ' '.repeat(len - vis);
}
function visLen(s: string): number {
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, '');
  let len = 0;
  for (const ch of stripped) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0x7f) { len += 1; }
    else if (cp >= 0x2500 && cp <= 0x257f) { len += 1; } // box drawing
    else if (cp >= 0x2580 && cp <= 0x259f) { len += 1; } // block elements
    else if (cp >= 0x25a0 && cp <= 0x25ff) { len += 1; } // geometric shapes
    else if (cp >= 0x2600 && cp <= 0x26ff) { len += 1; } // misc symbols (♠♥♣♦▲▶)
    else if (cp >= 0x2700 && cp <= 0x27bf) { len += 1; } // dingbats (✓)
    else if (cp >= 0x3000 && cp <= 0x9fff) { len += 2; } // CJK
    else if (cp >= 0xf900 && cp <= 0xfaff) { len += 2; } // CJK compat
    else if (cp >= 0xff00 && cp <= 0xff60) { len += 2; } // fullwidth forms
    else { len += 1; }
  }
  return len;
}

// Card names that may appear in server log strings (Chinese form). Used by
// the colorizer to highlight card/skill mentions.
const CARD_KEYWORDS = ['杀','闪','桃','决斗','南蛮入侵','南蛮','万箭齐发','万箭','无中生有','无中','诸葛连弩','连弩','+1马','-1马'];
const SKILL_KEYWORDS = ['奸雄','武圣','制衡','洛神','仁德'];

// Highlight known tokens inside a log line: player names blue, cards/skills
// yellow. Player names come from current game state so any future renames
// follow automatically. Tokens are matched longest-first so '南蛮入侵'
// wins over '南蛮'.
function highlightTokens(text: string, playerNames: string[]): string {
  const tokens = [
    ...playerNames.map(n => ({ token: n, color: blue })),
    ...[...CARD_KEYWORDS].sort((a, b) => b.length - a.length).map(t => ({ token: t, color: yellow })),
    ...SKILL_KEYWORDS.map(t => ({ token: t, color: yellow })),
  ].filter(t => t.token.length > 0);

  let out = '';
  let i = 0;
  outer: while (i < text.length) {
    for (const { token, color } of tokens) {
      if (text.startsWith(token, i)) { out += color(token); i += token.length; continue outer; }
    }
    out += text[i];
    i++;
  }
  return out;
}

// A single log line, fully colorized. Turn-start lines get the red banner
// treatment; everything else is grey-by-default with token highlights.
function colorizeLog(text: string, playerNames: string[]): string {
  if (/回合开始/.test(text) || /^第\d+回合/.test(text)) {
    return red(`--- ${highlightTokens(text, playerNames)} ---`);
  }
  if (/阵亡|获胜/.test(text)) {
    return red(highlightTokens(text, playerNames));
  }
  if (text.startsWith('✓')) return green(text);
  if (text.startsWith('✗')) return red(text);
  // Default: grey body, with player/card/skill tokens overpainted in their
  // own color (their inner reset terminates the grey; the next plain run
  // is left uncolored, which reads as default fg — close enough to grey
  // without nesting issues).
  return grey(highlightTokens(text, playerNames));
}

// Word-wrap a plain log line to a visible width (CJK-aware), then colorize
// each row. Returns ready-to-print colored strings.
function wrapColoredLog(plain: string, playerNames: string[], width: number): string[] {
  if (width <= 0) return [];
  const lines: string[] = [];
  let cur = '';
  let curWidth = 0;
  for (const ch of plain) {
    const cw = visLen(ch);
    if (curWidth + cw > width && cur.length > 0) {
      lines.push(colorizeLog(cur, playerNames));
      cur = ch;
      curWidth = cw;
    } else {
      cur += ch;
      curWidth += cw;
    }
  }
  if (cur.length > 0) lines.push(colorizeLog(cur, playerNames));
  return lines;
}

// Render card box (3 lines: top/content/bottom, 6 cols wide)
function renderCard(card: any, highlighted: boolean, selected: boolean, playable: boolean): string[] {
  const name = cardName(card.def.id);
  const suit = suitChar(card.def.suit);
  const num = card.def.number > 9 ? String(card.def.number) : ' ' + card.def.number;
  const sc = (s: string) => playable ? suitColor(card.def.suit, s) : dim(s);
  if (highlighted && selected) {
    return [green('┌────┐'), green(`│${name}${name.length > 1 ? '' : '  '}│`), green(`│${suit}${num} │`), green('└────┘')];
  }
  if (highlighted) {
    if (!playable) return [dim('┌────┐'), dim(`│${name}${name.length > 1 ? '' : '  '}│`), dim(`│${suit}${num} │`), dim('└────┘')];
    return [bgYellow('┌────┐'), bgYellow(`│${name}${name.length > 1 ? '' : '  '}│`), bgYellow(`│${suit}${num} │`), bgYellow('└────┘')];
  }
  const top = selected ? green('┌────┐') : playable ? '┌────┐' : dim('┌────┐');
  const bot = selected ? green('└────┘') : playable ? '└────┘' : dim('└────┘');
  return [top, `│${sc(name)}${visLen(name) > 2 ? '' : '  '}│`, `│${sc(suit+num)} │`, bot];
}

// WebSocket connect
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
        let hdr: Buffer;
        if (payload.length < 126) { hdr = Buffer.alloc(6); hdr[0] = 0x81; hdr[1] = 0x80 | payload.length; mask.copy(hdr, 2); }
        else { hdr = Buffer.alloc(8); hdr[0] = 0x81; hdr[1] = 0x80 | 126; hdr.writeUInt16BE(payload.length, 2); mask.copy(hdr, 4); }
        const masked = Buffer.from(payload);
        for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
        socket.write(Buffer.concat([hdr, masked]));
      };
      let buffer = Buffer.alloc(0);
      socket.on('data', (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);
        while (buffer.length >= 2) {
          let pLen = buffer[1] & 0x7f; let off = 2;
          if (pLen === 126) { if (buffer.length < 4) return; pLen = buffer.readUInt16BE(2); off = 4; }
          if (buffer.length < off + pLen) return;
          const p = buffer.subarray(off, off + pLen).toString();
          buffer = buffer.subarray(off + pLen);
          try { client.handleMessage(JSON.parse(p)); } catch {}
        }
      });
      socket.on('close', () => { teardownTerminal(); console.log('断开连接'); process.exit(1); });
      resolve();
    });
    req.on('error', reject);
    req.end();
  });
}

// === Selectors ===
const handSelector = new Selector<any>({
  items: [],
  onConfirm(card, idx) {
    const state = client.state;
    const gs = state.gameState;
    if (!gs) return;
    const waiting = gs.waitingFor;

    if (waiting && waiting.playerId === state.myId) {
      if (waiting.type === 'discard') {
        client.toggleCard(card.uid); render();
      } else {
        sendFn({ type: 'respond', cardUid: card.uid });
      }
    } else if (client.isMyTurn() && gs.phase === 'play') {
      const playableUids = state.playableUids || [];
      if (playableUids.length > 0 && !playableUids.includes(card.uid)) {
        pushLog('该牌不可使用'); render(); return;
      }
      if (playableUids.length === 0 && !canPlayCard(card)) {
        pushLog('该牌不可使用'); render(); return;
      }
      if (needsTarget(card.def.id)) {
        selectedCardUid = card.uid;
        const opponents = gs.players.filter((p: any) => p.id !== state.myId);
        targetSelector.setItems(opponents);
        targetSelector.cursor = 0;
        activeSelector = targetSelector;
        render();
      } else {
        sendFn({ type: 'play_card', cardUid: card.uid });
      }
    }
  },
  onCancel() {
    const state = client.state;
    const gs = state.gameState;
    const waiting = gs?.waitingFor;
    if (waiting && waiting.playerId === state.myId && waiting.type !== 'discard') {
      sendFn({ type: 'respond', cardUid: null });
    }
  },
});

const targetSelector = new Selector<any>({
  items: [],
  onConfirm(target) {
    if (selectedCardUid !== null) {
      sendFn({ type: 'play_card', cardUid: selectedCardUid, targetId: target.id });
    }
    selectedCardUid = null;
    activeSelector = handSelector;
    render();
  },
  onCancel() {
    selectedCardUid = null;
    activeSelector = handSelector;
    render();
  },
});

const heroSelector = new Selector<any>({
  items: [],
  onConfirm(hero) {
    sendFn({ type: 'select_hero', heroId: hero.id });
    heroSelector.cursor = 0;
    clear(); w(bold('已选择武将\n') + '等待对手...\n');
  },
  onCancel() {},
});

let activeSelector: Selector<any> = heroSelector;

// Bounded log ring. We keep a few hundred lines; the visible window inside
// the log box is computed at render time from terminal height. Values older
// than the cap roll off the front so memory stays flat on long games.
const LOG_CAP = 500;
const logLines: string[] = [];
function pushLog(line: string) {
  logLines.push(line);
  if (logLines.length > LOG_CAP) logLines.splice(0, logLines.length - LOG_CAP);
}

function render() {
  // Errors must bypass the diff buffer — process.exit fires before flush would.
  const state = client.state;
  if (state.error) { teardownTerminal(); console.error(`❌ ${state.error}`); process.exit(1); }
  renderBuf = '';
  renderInner();
  const buf = renderBuf;
  renderBuf = null;
  flush(buf.split('\n'));
}

// Compare the new frame line-by-line against prevLines and emit only changes.
function flush(rawLines: string[]) {
  // Drop the trailing empty element produced by a final '\n'.
  const lines = rawLines.length > 1 && rawLines[rawLines.length - 1] === ''
    ? rawLines.slice(0, -1) : rawLines;
  let out = `${ESC}[?25l`; // hide cursor while we repaint
  const n = Math.max(lines.length, prevLines.length);
  for (let i = 0; i < n; i++) {
    const next = lines[i] ?? '';
    if (next === prevLines[i]) continue; // unchanged — leave it alone
    out += `${ESC}[${i + 1};1H${ESC}[2K${next}`; // move to row, clear, rewrite
  }
  // Park cursor just below the frame so stray output lands sensibly.
  out += `${ESC}[${lines.length + 1};1H${ESC}[?25h`;
  prevLines = lines;
  RAW(out);
}

function renderInner() {
  const state = client.state;
  cols = process.stdout.columns || 80;
  rows = process.stdout.rows || 24;

  if (state.screen === 'lobby') { w(bold('三国杀 Online\n') + '连接中...\n'); return; }
  if (state.screen === 'waiting') { w(bold('三国杀 Online\n\n') + `等待对手... PIN: ${bold(state.pin||'')}\n`); return; }

  if (state.screen === 'hero_select') {
    if (!state.heroes) { w('等待其他玩家...\n'); return; }
    heroSelector.setItems(state.heroes);
    w(bold('选择武将') + '  [↑↓/Tab] 移动  [Enter] 确认\n\n');
    state.heroes.forEach((h: any, i: number) => {
      const line = ` ${h.nameCn} (${kingdomName(h.kingdom)}) HP:${'❤'.repeat(h.maxHp)} [${h.skillIds.join(',')}]`;
      w((i === heroSelector.cursor ? invert(` → ${line} `) : `   ${line}`) + '\n');
    });
    return;
  }

  if (state.screen === 'gameover') { w(bold(`\n🏆 ${state.winner} 获胜!\n\n`) + '按任意键退出\n'); return; }

  if (state.screen === 'game') {
    const gs = state.gameState;
    if (!gs) return;
    const me = client.getMyPlayer();
    const opp = client.getOpponent();
    if (!me || !opp) return;
    const hand = state.myHand || [];
    const isMyTurn = client.isMyTurn();
    const waiting = gs.waitingFor;

    // === ZONE 1: STATUS ===
    const statusLines = [
      ` ${bold(`第${gs.turnNumber}回合`)}  │  ${cyan(phaseName(gs.phase))}  │  牌堆: ${gs.deckCount}  │  弃牌堆: ${68 - gs.deckCount - hand.length}`,
      getHint(state, gs, waiting, isMyTurn),
    ];
    for (const l of box(statusLines, cols - 1)) w(l + '\n');

    // === ZONE 2: OPPONENTS ===
    const opponents = gs.players.filter((p: any) => p.id !== state.myId);
    const oppWidth = Math.min(22, Math.floor((cols - 2) / Math.max(opponents.length, 1)));
    const oppLines: string[][] = opponents.map((p: any, oi: number) => {
      const isTarget = activeSelector === targetSelector && oi === targetSelector.cursor;
      const nameStr = isTarget ? bgYellow(` ▶ ${p.name}`) : ` ${bold(p.name)}`;
      return [
        nameStr,
        ` ${p.heroId}`,
        ` HP: ${hpText(p.hp, p.maxHp)}`,
        ` 手牌: ${p.handCount}`,
        ` ${formatEquip(p.equipment) || '装备: -'}`,
      ];
    });
    // Render opponents side by side
    const maxOppLines = Math.max(...oppLines.map(l => l.length));
    for (let row = 0; row < maxOppLines + 2; row++) {
      let line = '│';
      for (let oi = 0; oi < oppLines.length; oi++) {
        if (row === 0) line += '┌' + hline(oppWidth - 2) + '┐';
        else if (row === maxOppLines + 1) line += '└' + hline(oppWidth - 2) + '┘';
        else line += '│' + pad(oppLines[oi][row - 1] || '', oppWidth - 2) + '│';
      }
      w(pad(line, cols - 1) + '\n');
    }

    // === ZONE 3: MY ZONE ===
    w('┌' + hline(cols - 2) + '┐\n');
    // Hero info left, equipment right
    const heroInfo = ` ${bold(me.name)}(${me.heroId}) HP: ${hpText(me.hp, me.maxHp)}`;
    const equipInfo = `${formatEquip(me.equipment) || '装备: -'} `;
    w('│' + pad(heroInfo, cols - 2 - visLen(equipInfo)) + equipInfo + '│\n');

    // Cards horizontally
    if (hand.length > 0) {
      handSelector.setItems(hand);
      const maxCards = Math.max(1, Math.floor((cols - 4) / 6));
      let startIdx = 0;
      if (hand.length > maxCards) {
        startIdx = Math.max(0, Math.min(handSelector.cursor - Math.floor(maxCards / 2), hand.length - maxCards));
      }
      const visibleHand = hand.slice(startIdx, startIdx + maxCards);
      const playableUids = state.playableUids || [];
      const playableSet = playableUids.length > 0 ? new Set(playableUids) : null;
      const cardBoxes = visibleHand.map((c: any, vi: number) => {
        const i = vi + startIdx;
        const isCursor = (activeSelector === handSelector && i === handSelector.cursor) || c.uid === selectedCardUid;
        const isSelected = state.selectedCards.includes(c.uid);
        // During resolution (respond), show respondable cards as playable
        let isPlayable: boolean;
        if (waiting && waiting.playerId === state.myId) {
          if (waiting.type === 'respond_attack') isPlayable = c.def.id === 'shan';
          else if (waiting.type === 'respond_duel' || waiting.type === 'respond_barbarian') isPlayable = c.def.id === 'sha';
          else if (waiting.type === 'discard') isPlayable = true;
          else isPlayable = true;
        } else {
          isPlayable = playableSet ? playableSet.has(c.uid) : canPlayCard(c);
        }
        return renderCard(c, isCursor, isSelected, isPlayable);
      });
      const scrollHint = hand.length > maxCards ? dim(` [${startIdx + 1}-${startIdx + visibleHand.length}/${hand.length}]`) : '';
      for (let row = 0; row < 4; row++) {
        let line = '│ ';
        for (let i = 0; i < cardBoxes.length; i++) line += cardBoxes[i][row];
        if (row === 0) line += scrollHint;
        w(pad(line, cols - 1) + '│\n');
      }
      let cursorLine = '│ ';
      for (let vi = 0; vi < visibleHand.length; vi++) cursorLine += (vi + startIdx === handSelector.cursor ? ' ▲   ' : '      ');
      w(pad(cursorLine, cols - 1) + '│\n');
    }

    // Controls
    let controls: string;
    if (activeSelector === targetSelector) {
      controls = ' [←→]选择目标  [Enter]确认目标  [Esc]取消';
    } else if (isMyTurn || (waiting?.playerId === state.myId)) {
      controls = ' [←→]选牌 [Enter]出牌 [Space]多选 [q]结束 [Esc]放弃 [h]帮助';
    } else {
      controls = ' 等待对手操作...';
    }
    w('│' + pad(controls, cols - 2) + '│\n');
    w('└' + hline(cols - 2) + '┘\n');

    // === ZONE 4: LOG BOX (auto-fills remaining height) ===
    // Measure chrome already written so we can size the log area to whatever
    // rows remain. Reserve at least 3 rows (top border + 1 line + bottom).
    const chromeLines = (renderBuf || '').split('\n').length - 1;
    const logBoxRows = Math.max(3, rows - chromeLines - 1);
    const innerRows = logBoxRows - 2;
    const innerWidth = cols - 4; // borders + 1 cell padding each side

    const playerNames = (gs.players || []).map((p: any) => p.name).filter((n: string) => !!n);
    // Wrap every buffered log line, then take the most recent rows that fit.
    // This is the "rotate when full" behavior — oldest wrapped rows scroll
    // out the top while newest land at the bottom.
    const wrapped: string[] = [];
    for (const raw of logLines) {
      for (const row of wrapColoredLog(raw, playerNames, innerWidth)) wrapped.push(row);
    }
    const visibleLog = wrapped.slice(-innerRows);
    const titleRaw = ' 战报 ';
    const titleVis = visLen(titleRaw);
    const leftDash = 2;
    const rightDash = Math.max(1, cols - 2 - leftDash - titleVis);
    w('┌' + hline(leftDash) + bold(titleRaw) + hline(rightDash) + '┐\n');
    for (let i = 0; i < innerRows; i++) {
      const line = visibleLog[i] ?? '';
      w('│ ' + pad(line, innerWidth) + ' │\n');
    }
    w('└' + hline(cols - 2) + '┘\n');
  }
}

function getHint(state: any, gs: any, waiting: any, isMyTurn: boolean): string {
  if (activeSelector === targetSelector) {
    const hand = state.myHand || [];
    const card = hand.find((c: any) => c.uid === selectedCardUid);
    return ` ${yellow('>>')} 选择目标: ${card ? cardName(card.def.id) : '?'} → ?`;
  }
  if (waiting && waiting.playerId === state.myId) {
    const t: Record<string, string> = { respond_attack: '响应杀 (选闪+Enter, Esc放弃)', respond_duel: '响应决斗 (选杀+Enter, Esc放弃)', respond_barbarian: '响应南蛮/万箭', discard: '弃牌 (Space选牌, Enter确认)' };
    return ` ${yellow('>>')} ${t[waiting.type] || '等待你响应'}`;
  }
  if (waiting) {
    const who = gs.players.find((p: any) => p.id === waiting.playerId);
    return ` ${dim('>>')} 等待 ${who?.name} 响应`;
  }
  if (isMyTurn && gs.phase === 'play') return ` ${yellow('>>')} 你的出牌阶段`;
  return ` ${dim('>>')} 等待对手`;
}

client.setOnChange((state: any, msg: any) => {
  if (msg?.type === 'log') pushLog(msg.msg);
  render();
});

// Key handling — buffer escape sequences
let keyBuf = '';
let keyTimer: ReturnType<typeof setTimeout> | null = null;

function processKey(s: string) {
  const state = client.state;

  if (s === '\x03') { process.exit(0); }

  // Update active selector based on screen
  if (state.screen === 'hero_select') activeSelector = heroSelector;
  else if (state.screen === 'game' && activeSelector === heroSelector) activeSelector = handSelector;

  // Navigation — delegate to active selector. Both CSI (\x1b[A) and SS3
  // (\x1bOA) are accepted because terminals in application-cursor-key mode
  // emit the SS3 form.
  if (s === '\x1b[C' || s === '\x1bOC' || s === '\t') { activeSelector.next(); render(); return; }
  if (s === '\x1b[D' || s === '\x1bOD' || s === '\x1b[Z') { activeSelector.prev(); render(); return; }
  if (s === '\x1b[A' || s === '\x1bOA') { activeSelector.prev(); render(); return; }
  if (s === '\x1b[B' || s === '\x1bOB') { activeSelector.next(); render(); return; }

  if (s === '\x1b') { activeSelector.cancel(); render(); return; }

  if (s === 'x') {
    sendFn({ type: 'abort', reason: 'user_cancel' });
    pushLog('已发送取消信号');
    render();
    return;
  }

  if (s === 'q') {
    if (activeSelector === targetSelector) { activeSelector.cancel(); render(); return; }
    if (state.screen === 'game' && client.isMyTurn() && state.gameState?.phase === 'play') {
      sendFn({ type: 'end_play' });
    }
    return;
  }

  if (s === 'h' || s === '?') {
    if (state.screen === 'game' && activeSelector === handSelector) {
      const hand = state.myHand || [];
      const card = hand[handSelector.cursor];
      if (card) {
        const HELP: Record<string, string> = {
          sha: '杀: 对一名角色造成1点伤害，目标可出闪抵消。每回合限1张(诸葛连弩除外)',
          shan: '闪: 被杀时使用，抵消杀的伤害',
          tao: '桃: 回复1点体力(不超过上限)',
          juedou: '决斗: 与目标轮流出杀，先不出者受1伤',
          nanman: '南蛮入侵: 所有其他角色出杀或受1伤 (无需选目标)',
          wanjian: '万箭齐发: 所有其他角色出闪或受1伤 (无需选目标)',
          wuzhong: '无中生有: 摸2张牌',
          zhuge: '诸葛连弩: 武器，出杀无次数限制',
          plus_horse: '+1马: 防御马，他人到你距离+1',
          minus_horse: '-1马: 进攻马，你到他人距离-1',
        };
        pushLog(HELP[card.def.id] || `${card.def.nameCn}: 无详细说明`);
        render();
      }
    }
    return;
  }

  if (s === ' ') {
    if (state.screen === 'game') {
      const hand = state.myHand || [];
      const card = hand[handSelector.cursor];
      if (card) { client.toggleCard(card.uid); }
    }
    render();
    return;
  }

  if (s === '\r' || s === '\n') {
    if (state.screen === 'gameover') process.exit(0);
    // Discard: if enough cards selected, submit
    if (state.screen === 'game') {
      const gs = state.gameState;
      const waiting = gs?.waitingFor;
      if (waiting?.type === 'discard' && waiting.playerId === state.myId) {
        const needed = waiting.data?.count || 0;
        if (state.selectedCards.length >= needed) {
          sendFn({ type: 'discard_cards', cardUids: state.selectedCards.slice(0, needed) });
          client.clearSelection();
          return;
        }
        // Not enough selected — toggle current card
        const hand = state.myHand || [];
        const card = hand[handSelector.cursor];
        if (card) { client.toggleCard(card.uid); render(); }
        return;
      }
    }
    activeSelector.confirm();
    render();
    return;
  }
}

process.stdout.on('resize', () => {
  cols = process.stdout.columns;
  rows = process.stdout.rows;
  // Geometry changed — every cached line is stale; force a full repaint.
  prevLines = [];
  RAW(`${ESC}[2J${ESC}[H`);
  render();
});

// Pull complete key sequences out of keyBuf and dispatch each one. A bare
// ESC at the end is left in the buffer so the timer can flush it (or wait
// for the rest of an arriving CSI/SS3 sequence).
function drainKeys() {
  while (keyBuf.length > 0) {
    const c = keyBuf[0];
    if (c !== '\x1b') {
      processKey(c);
      keyBuf = keyBuf.slice(1);
      continue;
    }
    if (keyBuf.length === 1) return; // bare ESC — wait for the timer or more bytes
    const second = keyBuf[1];
    if (second === '[') {
      // CSI: \x1b[ params? final  where final ∈ 0x40..0x7E
      const m = keyBuf.match(/^\x1b\[[\x30-\x3f]*[\x20-\x2f]*([\x40-\x7e])/);
      if (!m) return; // not yet complete
      processKey(m[0]);
      keyBuf = keyBuf.slice(m[0].length);
      continue;
    }
    if (second === 'O') {
      // SS3: \x1bO X (3 bytes total)
      if (keyBuf.length < 3) return;
      processKey(keyBuf.slice(0, 3));
      keyBuf = keyBuf.slice(3);
      continue;
    }
    // ESC followed by some other byte (Alt-key, etc.) — emit just the ESC,
    // let the next loop iteration handle the rest as a normal byte.
    processKey('\x1b');
    keyBuf = keyBuf.slice(1);
  }
}

async function main() {
  if (!JOIN_PIN) { console.error('Usage: cli/tui.ts --join <PIN> [--port PORT] [--name NAME]'); process.exit(1); }
  setupTerminal();
  await connectWs();
  sendFn({ type: 'join_room', pin: JOIN_PIN, name: NAME });
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (data: Buffer) => {
    if (keyTimer) { clearTimeout(keyTimer); keyTimer = null; }
    keyBuf += data.toString();
    drainKeys();
    // If anything is still buffered, it's a partial ESC sequence. Arm a
    // short timer: if no more bytes arrive, flush it as a literal ESC.
    if (keyBuf.length > 0) {
      keyTimer = setTimeout(() => {
        while (keyBuf.length > 0) {
          processKey(keyBuf[0]);
          keyBuf = keyBuf.slice(1);
        }
      }, 30);
    }
  });
  render();
}

main().catch(e => { teardownTerminal(); console.error(`Error: ${e.message}`); process.exit(1); });
