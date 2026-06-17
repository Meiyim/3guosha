import type { AgentAdapter } from './types.ts';
import type { LegalAction, PlayerObservation } from '../../game/types.ts';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface OpenAIAgentOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export function createOpenAIAgent(options: OpenAIAgentOptions = {}): AgentAdapter {
  const codexConfig = loadCodexOpenAIConfig();
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || codexConfig.apiKey;
  const model = options.model || process.env.OPENAI_MODEL || process.env.CODEX_MODEL || codexConfig.model || 'gpt-5.5';
  const baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || codexConfig.baseUrl || 'https://api.openai.com/v1';
  const timeoutMs = options.timeoutMs ?? 15000;

  return {
    id: `openai:${model}`,
    name: `OpenAI ${model}`,
    async act(observation) {
      if (!apiKey) throw new Error('OPENAI_API_KEY or CODEX_API_KEY is required');
      return chooseOpenAIAction({ apiKey, model, baseUrl, timeoutMs }, observation);
    },
  };
}

export function hasOpenAIAgentCredentials(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || loadCodexOpenAIConfig().apiKey);
}

function loadCodexOpenAIConfig(): { apiKey?: string; model?: string; baseUrl?: string } {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const result: { apiKey?: string; model?: string; baseUrl?: string } = {};
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(codexHome, 'auth.json'), 'utf8'));
    result.apiKey = auth.OPENAI_API_KEY || auth.CODEX_API_KEY;
  } catch {}

  try {
    const config = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    result.model = matchTomlString(config, 'model');
    const provider = matchTomlString(config, 'model_provider');
    if (provider) {
      const section = findTomlSection(config, `model_providers.${provider}`);
      result.baseUrl = section ? matchTomlString(section, 'base_url') : undefined;
    }
  } catch {}
  return result;
}

function matchTomlString(text: string, key: string): string | undefined {
  return text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'))?.[1];
}

function findTomlSection(text: string, sectionName: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `[${sectionName}]`);
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

async function chooseOpenAIAction(options: Required<OpenAIAgentOptions>, observation: PlayerObservation): Promise<LegalAction | null> {
  const compact = compactObservation(observation);
  const input = [
    {
      role: 'developer',
      content: [
        'You are a Sanguosha arena agent.',
        'Choose exactly one legal action by index.',
        'Return only JSON in this shape: {"actionIndex": number, "reason": string}.',
        'Do not invent actions; actionIndex must refer to the legalActions array.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify(compact),
    },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await fetch(`${options.baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        input,
        reasoning: { effort: 'low' },
        max_output_tokens: 120,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`OpenAI request failed: ${res.status} ${JSON.stringify(data)}`);

    const text = extractOutputText(data);
    const parsed = parseActionIndex(text);
    const index = parsed?.actionIndex;
    return Number.isInteger(index) && index >= 0 && index < observation.legalActions.length
      ? observation.legalActions[index]
      : null;
  } finally {
    clearTimeout(timeout);
  }
}

function compactObservation(observation: PlayerObservation): object {
  return {
    me: observation.privateState.myId,
    publicState: observation.publicState,
    hand: observation.privateState.myHand.map(card => ({
      uid: card.uid,
      id: card.def.id,
      name: card.def.nameCn,
      suit: card.def.suit,
      number: card.def.number,
      type: card.def.type,
    })),
    legalActions: observation.legalActions.map((action, index) => ({ index, action })),
  };
}

function extractOutputText(data: any): string {
  if (typeof data.output_text === 'string') return data.output_text;
  const chunks: string[] = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n');
}

function parseActionIndex(text: string): { actionIndex: number } | null {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed.actionIndex === 'number' ? parsed : null;
  } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return typeof parsed.actionIndex === 'number' ? parsed : null;
  } catch {
    return null;
  }
}
