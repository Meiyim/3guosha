import type { ResolutionFrame } from './resolution.ts';
import type { Action } from './action.ts';

export type GameMode = 'dual' | 'identity' | 'one_vs_three' | 'test';
export type GamePhase = 'prepare' | 'judge' | 'draw' | 'play' | 'discard' | 'end' | 'ended';
export type CardZone = 'deck' | 'hand' | 'equipment' | 'discard' | 'void';
export type CardSuit = 'spade' | 'heart' | 'club' | 'diamond';
export type WinnerState = { type: 'players'; playerIds: string[] } | { type: 'draw' };

export interface TurnState {
  currentPlayerId: string;
  turnNumber: number;
}

export interface CardDef {
  id: string;
  name: string;
  nameCn: string;
}

export interface CardInstance {
  id: string;
  cardId: string;
  suit?: CardSuit;
  number?: number;
  zone: CardZone;
  ownerId?: string;
}

export interface PlayerState {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  alive: boolean;
  hand: string[];
  equipment: Record<string, string | undefined>;
}

export interface ActionRecord {
  action: Action;
  timestamp: number;
}

export interface GameMetadata {
  shuffleSeed?: string;
  [key: string]: unknown;
}

export interface GameState {
  id: string;
  mode: GameMode;
  phase: GamePhase;
  turn: TurnState;
  players: PlayerState[];
  cards: Record<string, CardInstance>;
  deck: string[];
  discardPile: string[];
  resolutionStack: ResolutionFrame[];
  actionLog: ActionRecord[];
  winner: WinnerState | null;
  metadata: GameMetadata;
}

export interface GameStateReprOptions {
  includeCards?: boolean;
  includeActionLog?: boolean;
}

export function getPlayer(state: GameState, playerId: string): PlayerState | undefined {
  return state.players.find(player => player.id === playerId);
}

export function getCurrentPlayer(state: GameState): PlayerState | undefined {
  return getPlayer(state, state.turn.currentPlayerId);
}

export function getAlivePlayers(state: GameState): PlayerState[] {
  return state.players.filter(player => player.alive);
}

export function reprGameState(state: GameState, options: GameStateReprOptions = {}): string {
  const lines = [
    `GameState(${state.id})`,
    `  mode: ${state.mode}`,
    `  phase: ${state.phase}`,
    '  turn:',
    `    currentPlayerId: ${state.turn.currentPlayerId}`,
    `    turnNumber: ${state.turn.turnNumber}`,
    `  winner: ${state.winner ? JSON.stringify(state.winner) : 'none'}`,
    '',
    'Players:',
    ...state.players.flatMap(player => indentLines(reprPlayerState(player), 2)),
    '',
    'Piles:',
    `  deck: ${reprIdList(state.deck)}`,
    `  discardPile: ${reprIdList(state.discardPile)}`,
    '',
    'ResolutionStack:',
    ...(state.resolutionStack.length === 0
      ? ['  empty']
      : state.resolutionStack.map(frame => `  ${frame.id}: ${frame.criterion.type}`)),
  ];

  if (options.includeCards) {
    lines.push('', 'Cards:');
    for (const card of Object.values(state.cards)) {
      lines.push(...indentLines(reprCardInstance(card), 2));
    }
  }

  if (options.includeActionLog) {
    lines.push('', 'ActionLog:');
    for (const [index, record] of state.actionLog.entries()) {
      lines.push(`  #${index} ${record.action.type}`);
    }
  }

  return lines.join('\n');
}

export function reprPlayerState(player: PlayerState): string {
  const equipment = Object.entries(player.equipment)
    .filter(([, cardId]) => !!cardId)
    .map(([slot, cardId]) => `${slot}:${cardId}`)
    .join(', ');
  return [
    `Player(${player.id})`,
    `  name: ${player.name}`,
    `  hp: ${player.hp}/${player.maxHp}`,
    `  alive: ${player.alive}`,
    `  hand: ${reprIdList(player.hand)}`,
    `  equipment: ${equipment || 'empty'}`,
  ].join('\n');
}

export function reprCardInstance(card: CardInstance): string {
  const parts = [
    `Card(${card.id})`,
    `  cardId: ${card.cardId}`,
    `  zone: ${card.zone}`,
  ];
  if (card.ownerId) parts.push(`  owner: ${card.ownerId}`);
  if (card.suit) parts.push(`  suit: ${card.suit}`);
  if (card.number) parts.push(`  number: ${card.number}`);
  return parts.join('\n');
}

function reprIdList(ids: string[]): string {
  return ids.length === 0 ? '[]' : `[${ids.join(', ')}]`;
}

function indentLines(text: string, spaces: number): string[] {
  const indent = ' '.repeat(spaces);
  return text.split('\n').map(line => `${indent}${line}`);
}
