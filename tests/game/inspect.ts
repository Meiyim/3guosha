import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { formatTraceLog, reprGameState, type GameState, type GameTraceEvent } from '../../src/game/index.ts';

interface ScenarioLogMeta {
  scenarioId?: string;
  scenarioName?: string;
  generatedAt?: string;
}

const args = process.argv.slice(2);
const noColor = args.includes('--no-color');
const logDir = args.find(arg => !arg.startsWith('--'));

if (!logDir) {
  printUsage();
  process.exit(1);
}

if (!existsSync(logDir)) {
  console.error(`Log directory not found: ${logDir}`);
  process.exit(1);
}

const tracePath = join(logDir, 'trace.json');
const finalStatePath = join(logDir, 'final_state.json');
const metaPath = join(logDir, 'meta.json');

if (!existsSync(tracePath)) {
  console.error(`Missing trace.json in: ${logDir}`);
  const childDirs = readdirSync(logDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
  if (childDirs.length > 0) {
    console.error('\nThis looks like a log root. Pick one scenario folder:');
    for (const childDir of childDirs) console.error(`  ${join(logDir, childDir)}`);
  }
  process.exit(1);
}

const meta = existsSync(metaPath) ? readJson<ScenarioLogMeta>(metaPath) : {};
const trace = readJson<GameTraceEvent[]>(tracePath);
const finalState = existsSync(finalStatePath) ? readJson<GameState>(finalStatePath) : undefined;

console.log(`\n=== Inspect Trace: ${meta.scenarioId ?? logDir} ===`);
if (meta.scenarioName) console.log(`${meta.scenarioName}`);
if (meta.generatedAt) console.log(`generatedAt: ${meta.generatedAt}`);
console.log('');
console.log(formatTraceLog(trace, { colors: !noColor }));

if (finalState) {
  console.log('\n=== Final State ===');
  console.log(reprGameState(finalState, { includeCards: true }));
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function printUsage(): void {
  console.error('Usage: npm run inspect:game -- <scenario-log-dir> [--no-color]');
  console.error('');
  console.error('Generate logs first:');
  console.error('  npm run test:game -- --log-dir logs/game');
  console.error('');
  console.error('Inspect one scenario:');
  console.error('  npm run inspect:game -- logs/game/sha-blocked-by-shan');
}
