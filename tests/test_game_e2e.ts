import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const PORT = 3099;
const LOG_DIR = '/tmp/sanguosha_e2e_test';
const TIMEOUT = 60000;

function cleanup() {
  try { fs.rmSync(LOG_DIR, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(path.join(LOG_DIR, 'states'), { recursive: true });
}

function startServer(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['--experimental-transform-types', 'server/index.ts'], {
      env: { ...process.env, PORT: String(PORT), LOG_DIR, OPEN_JOIN: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('PIN=')) resolve(proc);
    });
    proc.stderr!.on('data', () => {});
    setTimeout(() => reject(new Error('server start timeout')), 5000);
  });
}

function startBot(name: string): ChildProcess {
  return spawn('node', ['--experimental-transform-types', 'bot/ai_bot.ts', '--port', String(PORT), '--join', 'any', '--name', name], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function main() {
  cleanup();
  console.log('Starting server...');
  const server = await startServer();
  console.log(`Server running on port ${PORT}`);

  const bot1 = startBot('Bot1');
  const bot2 = startBot('Bot2');

  let winner = '';
  const gameOver = new Promise<string>((resolve) => {
    for (const bot of [bot1, bot2]) {
      bot.stdout!.on('data', (d: Buffer) => {
        const m = d.toString().match(/Game Over! Winner: (.+)/);
        if (m) resolve(m[1]);
      });
    }
  });

  const timeout = new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Game did not finish within timeout')), TIMEOUT));

  try {
    winner = await Promise.race([gameOver, timeout]);
    console.log(`Game complete! Winner: ${winner}`);
  } catch (e: any) {
    console.error(`FAIL - ${e.message}`);
    server.kill(); bot1.kill(); bot2.kill();
    process.exit(1);
  }

  // Wait for state dump to flush
  await new Promise(r => setTimeout(r, 500));
  server.kill(); bot1.kill(); bot2.kill();

  // Verify replay files
  const statesDir = path.join(LOG_DIR, 'states');
  const turnFiles = fs.readdirSync(statesDir).filter(f => f.match(/^turn_\d+\.json$/)).sort();
  const actionFiles = fs.readdirSync(statesDir).filter(f => f.match(/^actions_turn_\d+\.json$/)).sort();

  let ok = true;
  if (turnFiles.length < 2) { console.error('FAIL - Not enough turn files:', turnFiles.length); ok = false; }
  if (actionFiles.length < 1) { console.error('FAIL - No action files'); ok = false; }

  if (ok) {
    const initial = JSON.parse(fs.readFileSync(path.join(statesDir, 'turn_0.json'), 'utf8'));
    if (!initial.players || initial.players.length !== 2) { console.error('FAIL - Invalid initial state'); ok = false; }

    const lastTurn = turnFiles[turnFiles.length - 1];
    const finalState = JSON.parse(fs.readFileSync(path.join(statesDir, lastTurn), 'utf8'));
    if (!finalState.winner) { console.error('FAIL - Final state has no winner'); ok = false; }

    // Verify turn progression
    const states = turnFiles.map(f => JSON.parse(fs.readFileSync(path.join(statesDir, f), 'utf8')));
    for (let i = 1; i < states.length; i++) {
      if (states[i].turnNumber < states[i - 1].turnNumber) {
        console.error(`FAIL - Turn number went backward at index ${i}`);
        ok = false; break;
      }
    }

    const totalActions = actionFiles.reduce((sum, f) => sum + JSON.parse(fs.readFileSync(path.join(statesDir, f), 'utf8')).length, 0);
    console.log(`  ${turnFiles.length} turns, ${totalActions} actions, winner: ${finalState.winner}`);
  }

  if (ok) { console.log('PASS'); process.exit(0); }
  else { console.error('FAIL'); process.exit(1); }
}

main().catch(e => { console.error('FAIL -', e.message); process.exit(1); });
