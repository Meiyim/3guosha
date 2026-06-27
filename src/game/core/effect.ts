import type { GamePhase, GameState, WinnerState } from './state.ts';
import { getAlivePlayers, getPlayer } from './state.ts';

export type Effect =
  | HealEffect
  | DamageEffect
  | CardMoveEffect
  | DrawCardEffect
  | NextPhaseEffect
  | NextTurnEffect
  | SetWinnerEffect
  | NoEffect;

export interface HealEffect {
  type: 'heal';
  playerId: string;
  amount: number;
}

export interface DamageEffect {
  type: 'damage';
  targetPlayerId: string;
  amount: number;
  sourcePlayerId?: string;
}

export interface CardMoveEffect {
  type: 'card_move';
  cardInstanceId: string;
  to: 'discard' | 'hand' | 'deck' | 'void';
  playerId?: string;
}

export interface DrawCardEffect {
  type: 'draw_card';
  playerId: string;
  count: number;
}

export interface NextPhaseEffect {
  type: 'next_phase';
  phase: GamePhase;
}

export interface NextTurnEffect {
  type: 'next_turn';
}

export interface SetWinnerEffect {
  type: 'set_winner';
  winner: WinnerState;
}

export interface NoEffect {
  type: 'no_effect';
}

export function applyEffect(state: GameState, effect: Effect): void {
  switch (effect.type) {
    case 'heal':
      applyHeal(state, effect);
      return;
    case 'damage':
      applyDamage(state, effect);
      return;
    case 'card_move':
      applyCardMove(state, effect);
      return;
    case 'draw_card':
      applyDrawCard(state, effect);
      return;
    case 'next_phase':
      state.phase = effect.phase;
      return;
    case 'next_turn':
      applyNextTurn(state);
      return;
    case 'set_winner':
      state.winner = effect.winner;
      state.phase = 'ended';
      return;
    case 'no_effect':
      return;
  }
}

function applyHeal(state: GameState, effect: HealEffect): void {
  const player = getPlayer(state, effect.playerId);
  if (!player) throw new Error(`heal target not found: ${effect.playerId}`);
  player.hp = Math.min(player.maxHp, player.hp + effect.amount);
}

function applyDamage(state: GameState, effect: DamageEffect): void {
  const player = getPlayer(state, effect.targetPlayerId);
  if (!player) throw new Error(`damage target not found: ${effect.targetPlayerId}`);
  player.hp -= effect.amount;
  if (player.hp <= 0) player.alive = false;
}

function applyCardMove(state: GameState, effect: CardMoveEffect): void {
  const card = state.cards[effect.cardInstanceId];
  if (!card) throw new Error(`card not found: ${effect.cardInstanceId}`);

  for (const player of state.players) {
    player.hand = player.hand.filter(id => id !== effect.cardInstanceId);
    for (const [slot, cardId] of Object.entries(player.equipment)) {
      if (cardId === effect.cardInstanceId) delete player.equipment[slot];
    }
  }
  state.deck = state.deck.filter(id => id !== effect.cardInstanceId);
  state.discardPile = state.discardPile.filter(id => id !== effect.cardInstanceId);

  card.zone = effect.to;
  card.ownerId = effect.playerId;
  if (effect.to === 'hand') {
    if (!effect.playerId) throw new Error('moving card to hand requires playerId');
    const player = getPlayer(state, effect.playerId);
    if (!player) throw new Error(`hand target not found: ${effect.playerId}`);
    player.hand.push(effect.cardInstanceId);
  } else if (effect.to === 'deck') {
    state.deck.push(effect.cardInstanceId);
  } else if (effect.to === 'discard') {
    state.discardPile.push(effect.cardInstanceId);
  }
}

function applyDrawCard(state: GameState, effect: DrawCardEffect): void {
  const player = getPlayer(state, effect.playerId);
  if (!player) throw new Error(`draw target not found: ${effect.playerId}`);
  for (let i = 0; i < effect.count; i++) {
    const cardId = state.deck.shift();
    if (!cardId) return;
    applyCardMove(state, { type: 'card_move', cardInstanceId: cardId, to: 'hand', playerId: player.id });
  }
}

function applyNextTurn(state: GameState): void {
  const alivePlayers = getAlivePlayers(state);
  if (alivePlayers.length === 0) return;
  const currentIndex = alivePlayers.findIndex(player => player.id === state.turn.currentPlayerId);
  const next = alivePlayers[(currentIndex + 1 + alivePlayers.length) % alivePlayers.length];
  state.turn.currentPlayerId = next.id;
  state.turn.turnNumber += 1;
  state.phase = 'play';
}
