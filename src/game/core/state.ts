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

export function getPlayer(state: GameState, playerId: string): PlayerState | undefined {
  return state.players.find(player => player.id === playerId);
}

export function getCurrentPlayer(state: GameState): PlayerState | undefined {
  return getPlayer(state, state.turn.currentPlayerId);
}

export function getAlivePlayers(state: GameState): PlayerState[] {
  return state.players.filter(player => player.alive);
}
