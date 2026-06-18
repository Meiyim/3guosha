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
const TSX_BIN = path.join(PROJECT_DIR, 'node_modules/.bin/tsx');
let devBotProcesses: ChildProcess[] = [];

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
};

const MANUAL_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>三国杀 - 游戏手册</title>
<style>body{font-family:'Microsoft YaHei',sans-serif;background:#1a1a2e;color:#eee;max-width:800px;margin:0 auto;padding:2rem;line-height:1.8;}
h1{color:#e94560;border-bottom:2px solid #e94560;padding-bottom:0.5rem;}
h2{color:#e94560;margin-top:2rem;}h3{color:#f5a623;}
table{width:100%;border-collapse:collapse;margin:1rem 0;}th,td{border:1px solid #333;padding:8px;text-align:left;}
th{background:#0f3460;}.red{color:#e94560;}.card{background:#16213e;padding:0.5rem;border-radius:4px;margin:0.3rem 0;}
a{color:#4fc3f7;}</style></head><body>
<h1>三国杀 Online - 新手手册</h1>
<h2>游戏概述</h2>
<p>三国杀是一款以三国时代为背景的策略卡牌对战游戏。本版本为1v1决斗模式，两位玩家各选一名武将，通过出牌击败对手获胜。</p>

<h2>如何开始</h2>
<ol>
<li>一位玩家点击<b>创建房间</b>，获得4位数PIN码</li>
<li>将PIN码分享给对手</li>
<li>对手输入PIN码加入房间</li>
<li>双方各选择一名武将</li>
<li>游戏开始！</li>
</ol>

<h2>回合流程</h2>
<table><tr><th>阶段</th><th>说明</th></tr>
<tr><td>摸牌阶段</td><td>从牌堆摸2张牌</td></tr>
<tr><td>出牌阶段</td><td>使用手牌（杀、锦囊、装备），每回合限出1张杀（诸葛连弩除外）</td></tr>
<tr><td>弃牌阶段</td><td>手牌上限=当前体力值，超出须弃掉</td></tr>
</table>

<h2>基本牌</h2>
<table><tr><th>牌名</th><th>效果</th></tr>
<tr><td class="red">杀</td><td>对一名角色造成1点伤害。目标可出<b>闪</b>抵消</td></tr>
<tr><td>闪</td><td>响应杀时使用，抵消杀的伤害</td></tr>
<tr><td class="red">桃</td><td>回复1点体力（不超过上限）</td></tr>
</table>

<h2>锦囊牌</h2>
<table><tr><th>牌名</th><th>效果</th></tr>
<tr><td>决斗</td><td>与目标轮流出杀，先不出杀的受1点伤害</td></tr>
<tr><td>南蛮入侵</td><td>除你外所有角色须出杀，否则受1点伤害</td></tr>
<tr><td>万箭齐发</td><td>除你外所有角色须出闪，否则受1点伤害</td></tr>
<tr><td>无中生有</td><td>摸2张牌</td></tr>
</table>

<h2>装备牌</h2>
<table><tr><th>牌名</th><th>效果</th></tr>
<tr><td>诸葛连弩</td><td>武器：出杀无次数限制</td></tr>
<tr><td>+1马</td><td>防御马：其他角色计算与你距离+1</td></tr>
<tr><td>-1马</td><td>进攻马：你计算与其他角色距离-1</td></tr>
</table>

<h2>武将技能</h2>
<table><tr><th>武将</th><th>势力</th><th>体力</th><th>技能</th></tr>
<tr><td>刘备</td><td>蜀</td><td>4</td><td><b>仁德</b>：将牌交给其他角色</td></tr>
<tr><td>曹操</td><td>魏</td><td>4</td><td><b>奸雄</b>：受到伤害时获得造成伤害的牌</td></tr>
<tr><td>孙权</td><td>吴</td><td>4</td><td><b>制衡</b>：弃任意张牌，摸等量的牌</td></tr>
<tr><td>关羽</td><td>蜀</td><td>4</td><td><b>武圣</b>：可将红色牌当杀使用</td></tr>
<tr><td>甄姬</td><td>魏</td><td>3</td><td><b>洛神</b>：回合开始时翻牌，获得黑色牌</td></tr>
</table>

<h2>胜利条件</h2>
<p>将对手体力降至0即获胜。</p>

<h2>操作提示</h2>
<ul>
<li>点击手牌选中/取消选中</li>
<li>选中牌后点击<b>出牌</b>按钮使用</li>
<li>被攻击时选择<b>出牌响应</b>（选中闪）或<b>放弃</b></li>
<li>出牌阶段结束点击<b>结束出牌</b></li>
</ul>

<p><a href="/">← 返回游戏</a></p>
</body></html>`;

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
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(MANUAL_HTML);
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
