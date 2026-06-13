import type { HeroDef, SkillHandler, GameEvent } from '../types.ts';

const heroRegistry: HeroDef[] = [];
const skillRegistry = new Map<string, SkillHandler>();

export function registerHero(hero: HeroDef) { heroRegistry.push(hero); }
export function registerSkill(skill: SkillHandler) { skillRegistry.set(skill.id, skill); }
export function getHeroes(): HeroDef[] { return heroRegistry; }
export function getSkill(id: string): SkillHandler | undefined { return skillRegistry.get(id); }
export function getSkillsForEvent(event: GameEvent): SkillHandler[] {
  return [...skillRegistry.values()].filter(s => s.events.includes(event));
}
