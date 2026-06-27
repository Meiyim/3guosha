import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { MinimalWebSocketServer } from './ws.ts';
import { connectHttpClient, getCurrentPin, handleConnection, handleHttpAction, initRoom, leaveGame, pollHttpClient, setOpenJoin, startDevGame } from './room.ts';
import { log } from './logger.ts';
import { loadConfig } from './config.ts';
import { getHeroes } from './game/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.join(__dirname, '..');
const configFile = process.argv.find(a => a.endsWith('.yaml') || a.endsWith('.yml')) || process.env.CONFIG;
const config = loadConfig(configFile);

const PORT = Number(process.env.PORT) || config.server.port;
if (config.server.verbose) process.env.VERBOSE = '1';
if (!process.env.LOG_DIR && config.server.log_dir) process.env.LOG_DIR = config.server.log_dir;
if (process.env.OPEN_JOIN === '1' || config.server.open_join) setOpenJoin(true);

const CLIENT_DIR = path.join(__dirname, '../client');
const SHARED_DIR = path.join(__dirname, '../shared');
const BASIC_RULE_DOC = path.join(__dirname, 'game/doc/basic_rule.md');
const TSX_BIN = path.join(PROJECT_DIR, 'node_modules/.bin/tsx');
let devBotProcesses: ChildProcess[] = [];

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
};

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendText(res: http.ServerResponse, status: number, text: string) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function renderManualHtml(markdown: string): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>三国杀 - 游戏手册</title>
<style>
body{font-family:'Microsoft YaHei',sans-serif;background:#1a1a2e;color:#eee;max-width:880px;margin:0 auto;padding:2rem;line-height:1.8;}
h1{color:#e94560;border-bottom:2px solid #e94560;padding-bottom:0.5rem;}
h2{color:#e94560;margin-top:2rem;}h3,h4,h5,h6{color:#f5a623;margin-top:1.5rem;}
table{width:100%;border-collapse:collapse;margin:1rem 0;}th,td{border:1px solid #333;padding:8px;text-align:left;vertical-align:top;}
th{background:#0f3460;}td{background:rgba(22,33,62,0.55);}
code{background:#16213e;padding:0.1rem 0.3rem;border-radius:4px;}pre{background:#16213e;padding:1rem;border-radius:4px;overflow:auto;}
a{color:#4fc3f7;}li{margin:0.25rem 0;}
</style></head><body>
${renderMarkdown(markdown)}
<p><a href="/">← 返回游戏</a></p>
</body></html>`;
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let inCode = false;
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  };
  const flushBlocks = () => {
    flushParagraph();
    closeList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        flushBlocks();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushBlocks();
      continue;
    }

    if (isTableStart(lines, i)) {
      flushBlocks();
      const table = collectTable(lines, i);
      html.push(renderTable(table.rows));
      i = table.endIndex;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushBlocks();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${renderInline(unordered[1])}</li>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${renderInline(ordered[1])}</li>`);
      continue;
    }

    closeList();
    paragraph.push(trimmed);
  }

  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  flushBlocks();
  return html.join('\n');
}

function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index]?.trim() || '';
  const separator = lines[index + 1]?.trim() || '';
  return header.startsWith('|') && header.endsWith('|') && /^\|[\s:-]+\|[\s|:-]*$/.test(separator);
}

function collectTable(lines: string[], startIndex: number): { rows: string[][]; endIndex: number } {
  const rows: string[][] = [];
  let index = startIndex;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) break;
    if (index !== startIndex + 1) rows.push(splitTableRow(trimmed));
    index++;
  }
  return { rows, endIndex: index - 1 };
}

function splitTableRow(row: string): string[] {
  return row.slice(1, -1).split('|').map(cell => cell.trim());
}

function renderTable(rows: string[][]): string {
  if (!rows.length) return '';
  const [head, ...body] = rows;
  const headHtml = `<tr>${head.map(cell => `<th>${renderInline(cell)}</th>`).join('')}</tr>`;
  const bodyHtml = body.map(row => `<tr>${row.map(cell => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('\n');
  return `<table><thead>${headHtml}</thead><tbody>${bodyHtml}</tbody></table>`;
}

function renderInline(text: string): string {
  const codeSpans: string[] = [];
  let escaped = escapeHtml(text).replace(/`([^`]+)`/g, (_match, code) => {
    const token = `\u0000CODE${codeSpans.length}\u0000`;
    codeSpans.push(`<code>${code}</code>`);
    return token;
  });
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  for (let i = 0; i < codeSpans.length; i++) {
    escaped = escaped.replace(`\u0000CODE${i}\u0000`, codeSpans[i]);
  }
  return escaped;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stopDevBots() {
  for (const child of devBotProcesses) {
    if (!child.killed) child.kill();
  }
  devBotProcesses = [];
}

function spawnDevBots(pin: string, playerCount: number, agentKind?: string) {
  stopDevBots();
  const botHeroIds = getHeroes().map(h => h.id).filter(id => id !== 'sunquan');
  const botCount = Math.max(0, playerCount - 1);
  for (let i = 0; i < botCount; i++) {
    const name = `${i === 0 ? '开发对手' : `开发对手${i + 1}`}${agentKind === 'llm' ? '·LLM' : ''}`;
    const heroId = botHeroIds[i % botHeroIds.length] || 'caocao';
    const child = spawn(TSX_BIN, [
      'bot/ai_bot.ts',
      '--host', 'localhost',
      '--port', String(PORT),
      '--join', pin,
      '--name', name,
      '--hero', heroId,
      '--agent', agentKind === 'llm' ? 'llm' : 'heuristic',
      '--delay', '350',
    ], {
      cwd: PROJECT_DIR,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', data => log.debug(`[${name}] ${String(data).trim()}`));
    child.stderr?.on('data', data => log.warn(`[${name}] ${String(data).trim()}`));
    child.on('exit', code => log.debug(`${name} exited${code === null ? '' : ` code=${code}`}`));
    devBotProcesses.push(child);
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/action' && req.method === 'POST') {
    readJson(req).then(msg => {
      if (msg.type === 'connect') {
        sendJson(res, 200, connectHttpClient());
        return;
      }
      if (!msg.token) {
        sendJson(res, 400, { error: 'missing token' });
        return;
      }
      if (msg.type === 'create_room') {
        handleHttpAction(msg.token, { type: 'join_room', pin: getCurrentPin(), name: msg.name });
        sendJson(res, 200, { ok: true, pin: getCurrentPin() });
        return;
      }
      if (msg.type === 'start_dev_game') {
        const result = startDevGame(msg.token, msg.name, msg.playerCount);
        if (result.ok && result.pin && result.playerCount) {
          spawnDevBots(result.pin, result.playerCount, msg.agent);
        }
        sendJson(res, 200, result);
        return;
      }
      if (msg.type === 'leave_game') {
        stopDevBots();
        sendJson(res, 200, { ok: leaveGame(msg.token) });
        return;
      }
      const ok = handleHttpAction(msg.token, msg);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'invalid token' });
    }).catch(() => sendJson(res, 400, { error: 'invalid json' }));
    return;
  }

  if (req.url?.startsWith('/api/poll') && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token') || '';
    const messages = pollHttpClient(token);
    sendJson(res, messages ? 200 : 404, messages ? { messages } : { error: 'invalid token' });
    return;
  }

  if (req.url === '/api/manual' && req.method === 'GET') {
    fs.readFile(BASIC_RULE_DOC, 'utf8', (err, markdown) => {
      if (err) {
        log.warn(`Failed to read manual source: ${err.message}`);
        sendText(res, 500, 'Manual source is unavailable');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderManualHtml(markdown));
    });
    return;
  }

  const urlPath = (req.url || '/').split('?')[0];
  const baseDir = urlPath.startsWith('/shared/') ? path.join(SHARED_DIR, urlPath.slice(8)) : path.join(CLIENT_DIR, urlPath === '/' ? 'index.html' : urlPath);
  const ext = path.extname(baseDir);
  fs.readFile(baseDir, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new MinimalWebSocketServer(server);
wss.on('connection', handleConnection);

server.listen(PORT, config.server.host, () => {
  const pin = initRoom();
  log.info(`三国杀 server running at http://${config.server.host}:${PORT} [mode=${config.game.mode}] PIN=${pin}`);
});

process.on('exit', stopDevBots);
process.on('SIGINT', () => { stopDevBots(); process.exit(130); });
process.on('SIGTERM', () => { stopDevBots(); process.exit(143); });
