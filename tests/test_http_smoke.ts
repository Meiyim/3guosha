import { spawn } from 'child_process';
import http from 'http';

const PORT = 8334;
const BASE = { host: 'localhost', port: PORT };

type HttpClient = { token: string; playerId: string; pending: any[] };

let passed = 0;
let failed = 0;
let serverOutput = '';

function test(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}: ${detail || 'failed'}`);
  }
}

function postJson(path: string, body: any): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(body);
    const req = http.request(
      { ...BASE, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } },
      res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, data: data ? JSON.parse(data) : {} });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(raw);
    req.end();
  });
}

function getJson(path: string): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    http.get({ ...BASE, path }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, data: data ? JSON.parse(data) : {} });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function getText(path: string): Promise<{ status: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    http.get({ ...BASE, path }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        body,
        contentType: String(res.headers['content-type'] || ''),
      }));
    }).on('error', reject);
  });
}

async function connect(): Promise<HttpClient> {
  const res = await postJson('/api/action', { type: 'connect' });
  if (res.status !== 200 || !res.data.token || !res.data.playerId) {
    throw new Error(`connect failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return { ...res.data, pending: [] };
}

async function action(client: HttpClient, msg: any) {
  const res = await postJson('/api/action', { ...msg, token: client.token });
  if (res.status !== 200) throw new Error(`${msg.type} failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

async function poll(client: HttpClient) {
  const res = await getJson(`/api/poll?token=${encodeURIComponent(client.token)}`);
  if (res.status !== 200) throw new Error(`poll failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data.messages || [];
}

async function waitFor(client: HttpClient, type: string, timeoutMs = 3000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const buffered = client.pending.findIndex((m: any) => m.type === type);
    if (buffered >= 0) return client.pending.splice(buffered, 1)[0];

    const messages = await poll(client);
    for (const message of messages) client.pending.push(message);
    const found = messages.find((m: any) => m.type === type);
    if (found) {
      const index = client.pending.indexOf(found);
      if (index >= 0) client.pending.splice(index, 1);
      return found;
    }
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`timeout waiting for ${type}`);
}

async function waitForRoomSize(client: HttpClient, count: number, timeoutMs = 5000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const msg = await waitFor(client, 'room_joined', Math.max(25, deadline - Date.now()));
    if (msg.players?.length === count) return msg;
  }
  throw new Error(`timeout waiting for room size ${count}`);
}

async function startServer(): Promise<any> {
  const server = spawn('tsx', ['server/index.ts'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 5000);
    server.stdout.on('data', (d: Buffer) => {
      const text = d.toString();
      serverOutput += text;
      if (text.includes('running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', (d: Buffer) => { serverOutput += d.toString(); });
    server.on('exit', code => reject(new Error(`server exited early with ${code}`)));
  });
  return server;
}

async function testNormalMode() {
  console.log('\n=== HTTP Smoke: normal multiplayer ===\n');

  const p1 = await connect();
  const p2 = await connect();
  test('Two HTTP clients connect', !!p1.token && !!p2.token && p1.playerId !== p2.playerId);

  const created = await action(p1, { type: 'create_room', name: '玩家一' });
  test('Player one joins the default room', !!created.pin && /^\d{4}$/.test(created.pin), `pin=${created.pin}`);

  const joined1 = await waitFor(p1, 'room_joined');
  test('Player one receives room_joined', joined1.players.length === 1, `players=${joined1.players?.length}`);

  await action(p2, { type: 'join_room', pin: created.pin, name: '玩家二' });
  const joined2 = await waitFor(p2, 'room_joined');
  test('Player two joins by PIN', joined2.players.length === 2, `players=${joined2.players?.length}`);

  const hero1 = await waitFor(p1, 'hero_selection');
  const hero2 = await waitFor(p2, 'hero_selection');
  test('Both players receive hero selection', hero1.heroes?.length > 0 && hero2.heroes?.length > 0);

  await action(p1, { type: 'select_hero', heroId: 'guanyu' });
  await action(p2, { type: 'select_hero', heroId: 'caocao' });
  const game = await waitFor(p1, 'game_update');
  const priv = await waitFor(p1, 'private_update');
  test('Normal mode starts after both heroes are selected', game.state?.phase === 'play', `phase=${game.state?.phase}`);
  test('Normal mode sends private hand state', priv.state?.myHand?.length > 0, `hand=${priv.state?.myHand?.length}`);
}

async function testDevMode() {
  console.log('\n=== HTTP Smoke: developer AI mode ===\n');

  const dev = await connect();
  const started = await action(dev, { type: 'start_dev_game', name: '开发者' });
  test('Developer helper starts player-vs-AI room', started.ok === true);

  const joined = await waitForRoomSize(dev, 2);
  test('Dev room contains human and AI seats', joined.players.length === 2, `players=${joined.players?.length}`);

  const heroes = await waitFor(dev, 'hero_selection');
  test('Dev mode sends hero choices to the human', heroes.heroes?.length > 0);

  await action(dev, { type: 'select_hero', heroId: 'sunquan' });
  const selected = await waitFor(dev, 'hero_selected');
  test('Human hero selection is acknowledged', selected.heroId === 'sunquan', `hero=${selected.heroId}`);

  const game = await waitFor(dev, 'game_update');
  const priv = await waitFor(dev, 'private_update');
  const bot = game.state?.players?.find((p: any) => p.name === '开发对手');
  test('Dev mode starts a game against the AI client', !!bot && game.state.players.length === 2);
  test('Dev mode sends private hand state', priv.state?.myId === dev.playerId && priv.state.myHand.length > 0);

  const restarted = await action(dev, { type: 'start_dev_game', name: '开发者', playerCount: 3 });
  test('Dev mode can restart into a new AI room', restarted.ok === true && restarted.playerCount === 3);
  const restartedHeroes = await waitFor(dev, 'hero_selection');
  test('Restarted dev room reaches hero selection', restartedHeroes.heroes?.length > 0);

  const left = await action(dev, { type: 'leave_game' });
  test('Restarted dev room can be left cleanly', left.ok === true);
  const roomLeft = await waitFor(dev, 'room_left');
  test('Restarted dev room leave is acknowledged', roomLeft.type === 'room_left');
}

async function testDevMultiBotMode() {
  console.log('\n=== HTTP Smoke: developer multi-bot mode ===\n');

  const dev = await connect();
  const started = await action(dev, { type: 'start_dev_game', name: '开发者', playerCount: 4 });
  test('Developer helper starts 4-player room', started.ok === true && started.playerCount === 4);

  await waitFor(dev, 'hero_selection');
  await action(dev, { type: 'select_hero', heroId: 'sunquan' });
  const game = await waitFor(dev, 'game_update');
  const priv = await waitFor(dev, 'private_update');
  const botCount = game.state?.players?.filter((p: any) => p.name.startsWith('开发对手')).length;
  test('Dev multi-bot game starts with 3 AI opponents', game.state?.players?.length === 4 && botCount === 3,
    `players=${game.state?.players?.length} bots=${botCount}`);
  test('Dev multi-bot private state includes legal actions', Array.isArray(priv.state?.legalActions));

  const left = await action(dev, { type: 'leave_game' });
  test('Developer helper can leave the current game', left.ok === true);
  const roomLeft = await waitFor(dev, 'room_left');
  test('Leaving current game acknowledges the client', roomLeft.type === 'room_left');
}

async function testManualEndpoint() {
  console.log('\n=== HTTP Smoke: generated manual ===\n');

  const manual = await getText('/api/manual');
  test('Manual endpoint returns HTML', manual.status === 200 && manual.contentType.includes('text/html'),
    `status=${manual.status} contentType=${manual.contentType}`);
  test('Manual includes generated document shell', manual.body.includes('<!DOCTYPE html>') && manual.body.includes('<body>'));
  test('Manual includes rule document content',
    manual.body.includes('三国杀 Online 基础规则') && manual.body.includes('回合流程') && manual.body.includes('杀'));
  test('Manual renders Markdown headings to HTML', manual.body.includes('<h1>三国杀 Online 基础规则</h1>'));
  test('Manual does not leak top-level Markdown heading marker', !manual.body.includes('# 三国杀 Online 基础规则'));
}

async function main() {
  let server: any;
  try {
    server = await startServer();
    await testManualEndpoint();
    await testNormalMode();
    await testDevMode();
    await testDevMultiBotMode();
  } catch (e: any) {
    failed++;
    console.error('\nEXCEPTION:', e.stack || e.message);
    if (serverOutput) console.error('\n--- server output ---\n' + serverOutput);
  } finally {
    if (server) server.kill();
  }

  console.log(`\n=== HTTP Smoke Results: ${passed} passed, ${failed} failed ===\n`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
