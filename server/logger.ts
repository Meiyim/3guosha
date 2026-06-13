import * as fs from 'fs';
import * as path from 'path';

type LogLevel = 'info' | 'debug' | 'warn' | 'error';

const VERBOSE = process.env.VERBOSE === '1';
const LOG_DIR = process.env.LOG_DIR || '';
const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024; // 4GB per file
const MAX_FILES = 5;

let logStream: fs.WriteStream | null = null;
let currentFileSize = 0;
let fileIndex = 0;

function openLogFile(): void {
  if (!LOG_DIR) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const filePath = path.join(LOG_DIR, `server-${fileIndex}.log`);
  logStream = fs.createWriteStream(filePath, { flags: 'a' });
  try { currentFileSize = fs.statSync(filePath).size; } catch { currentFileSize = 0; }
}

function rotateIfNeeded(): void {
  if (!logStream || currentFileSize < MAX_FILE_SIZE) return;
  logStream.end();
  fileIndex = (fileIndex + 1) % MAX_FILES;
  const filePath = path.join(LOG_DIR, `server-${fileIndex}.log`);
  try { fs.unlinkSync(filePath); } catch {}
  logStream = fs.createWriteStream(filePath, { flags: 'w' });
  currentFileSize = 0;
}

function writeLog(level: LogLevel, ...args: any[]): void {
  const timestamp = new Date().toISOString();
  const msg = `[${timestamp}] [${level.toUpperCase()}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;

  if (VERBOSE || level === 'error' || level === 'warn') {
    console.log(msg);
  }

  if (logStream) {
    logStream.write(msg + '\n');
    currentFileSize += msg.length + 1;
    rotateIfNeeded();
  }
}

if (LOG_DIR) openLogFile();

export const log = {
  info: (...args: any[]) => writeLog('info', ...args),
  debug: (...args: any[]) => { if (VERBOSE) writeLog('debug', ...args); },
  warn: (...args: any[]) => writeLog('warn', ...args),
  error: (...args: any[]) => writeLog('error', ...args),
};
