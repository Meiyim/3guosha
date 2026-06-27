import type { CardRuleAst, EffectAst, TargetAst, TimingAst } from './ast.ts';

const FIELD_ALIASES = new Map([
  ['卡牌', 'name'],
  ['名称', 'name'],
  ['卡牌类型', 'cardType'],
  ['类型', 'cardType'],
  ['使用时机', 'timing'],
  ['目标', 'target'],
  ['效果', 'effect'],
  ['备注', 'note'],
]);

export function parseCardRuleSource(id: string, source: string): CardRuleAst {
  const fields = new Map<string, string>();
  let headingName: string | undefined;

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(/^(.+)[：:]$/);
    if (heading && !FIELD_ALIASES.has(heading[1].trim())) {
      headingName = heading[1].trim();
      continue;
    }

    const field = line.match(/^([^：:]+)[：:](.*)$/);
    if (!field) throw new Error(`unsupported 3gs card line: ${line}`);

    const key = FIELD_ALIASES.get(field[1].trim());
    if (!key) throw new Error(`unsupported 3gs card field: ${field[1].trim()}`);
    fields.set(key, field[2].trim());
  }

  const name = fields.get('name') || headingName;
  if (!name) throw new Error(`3gs card source missing card name for ${id}`);

  return {
    kind: 'card_rule',
    id,
    name,
    cardType: fields.get('cardType'),
    timing: parseTiming(fields.get('timing') ?? ''),
    target: parseTarget(fields.get('target') ?? ''),
    effects: parseEffects(fields.get('effect') ?? ''),
    notes: fields.get('note') ? [fields.get('note')!] : [],
    source,
  };
}

function parseTiming(text: string): TimingAst {
  if (text === '出牌阶段') return { kind: 'play_phase', text };
  if (text === '以你为目标的【杀】开始结算时') return { kind: 'sha_resolution_started', text };
  return { kind: 'unknown', text };
}

function parseTarget(text: string): TargetAst {
  if (!text) return { kind: 'none', text };
  if (text === '你') return { kind: 'self', text };
  if (text === '除你外，你攻击范围内的一名角色') {
    return { kind: 'single_other_in_attack_range', text };
  }
  if (text === '以你为目标的那张【杀】') return { kind: 'current_sha', text };
  return { kind: 'unknown', text };
}

function parseEffects(text: string): EffectAst[] {
  if (!text) return [];
  return text
    .split(/[；;]/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(parseEffect);
}

function parseEffect(text: string): EffectAst {
  const damage = text.match(/^对目标造成\s*(\d+)\s*点伤害$/);
  if (damage) return { kind: 'damage_target', amount: Number(damage[1]), text };

  const heal = text.match(/^回复\s*(\d+)\s*点体力$/);
  if (heal) return { kind: 'heal_self', amount: Number(heal[1]), text };

  if (text === '抵消该【杀】的全部效果，你不会受到这张【杀】造成的伤害') {
    return { kind: 'cancel_sha_resolution', text };
  }

  return { kind: 'unknown', text };
}
