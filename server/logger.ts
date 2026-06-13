import * as fs from 'fs';
import * as path from 'path';

type LogLevel = 'info' | 'debug' | 'warn' | 'error';

const VERBOSE = process.env.VERBOSE === '1';
const LOG_DIR = process.env.LOG_DIR || '';
const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024;
const MAX_FILES = 5;

function createLogger(prefix: string) {
  let stream: fs.WriteStream | null = null;
  let fileSize = 0;
  let fileIdx = 0;

  function open() {
    if (!LOG_DIR) return;
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const fp = path.join(LOG_DIR, `${prefix}-${fileIdx}.log`);
    stream = fs.createWriteStream(fp, { flags: 'a' });
    try { fileSize = fs.statSync(fp).size; } catch { fileSize = 0; }
  }

  function rotate() {
    if (!stream || fileSize < MAX_FILE_SIZE) return;
    stream.end();
    fileIdx = (fileIdx + 1) % MAX_FILES;
    const fp = path.join(LOG_DIR, `${prefix}-${fileIdx}.log`);
    try { fs.unlinkSync(fp); } catch {}
    stream = fs.createWriteStream(fp, { flags: 'w' });
    fileSize = 0;
  }

  function write(level: LogLevel, ...args: any[]) {
    const ts = new Date().toISOString();
    const msg = `[${ts}] [${level.toUpperCase()}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
    if (VERBOSE || level !== 'debug') console.log(`[${prefix}] ${msg}`);
    if (stream) { stream.write(msg + '\n'); fileSize += msg.length + 1; rotate(); }
  }

  if (LOG_DIR) open();

  return {
    info: (...args: any[]) => write('info', ...args),
    debug: (...args: any[]) => { if (VERBOSE) write('debug', ...args); },
    warn: (...args: any[]) => write('warn', ...args),
    error: (...args: any[]) => write('error', ...args),
  };
}

export const log = createLogger('server');
export const gameLog = createLogger('game');
