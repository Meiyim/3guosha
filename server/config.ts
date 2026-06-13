import * as fs from 'fs';
import { parse } from 'yaml';

export interface ServerConfig {
  server: {
    port: number;
    host: string;
    verbose: boolean;
    log_dir: string;
    open_join: boolean;
  };
  game: {
    mode: 'dual' | 'identity' | '2v2' | '3v3';
    turn_timeout: number;
    reconnect_timeout: number;
    max_rounds: number;
  };
}

const DEFAULTS: ServerConfig = {
  server: { port: 3000, host: '0.0.0.0', verbose: false, log_dir: '', open_join: false },
  game: { mode: 'dual', turn_timeout: 60, reconnect_timeout: 30, max_rounds: 50 },
};

export function loadConfig(filePath?: string): ServerConfig {
  if (!filePath) return DEFAULTS;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = parse(raw);
    return {
      server: { ...DEFAULTS.server, ...parsed?.server },
      game: { ...DEFAULTS.game, ...parsed?.game },
    };
  } catch (e: any) {
    console.error(`Failed to load config ${filePath}: ${e.message}`);
    process.exit(1);
  }
}
