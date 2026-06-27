import { GameController } from '../core/controller.ts';
import type { GameControllerOptions } from '../core/controller.ts';
import { RuleInterpreter } from '../core/interpreter.ts';
import type { CardInstance, GameState, PlayerState, WinnerState } from '../core/state.ts';
import { getAlivePlayers } from '../core/state.ts';

export interface CreateDualGameOptions {
  id?: string;
  shuffleSeed?: string;
  players: Array<{ id: string; name: string; maxHp?: number; hand?: string[] }>;
  cards?: CardInstance[];
}

export class DualGameController extends GameController {
  constructor(
    state: GameState,
    options: GameControllerOptions = { shuffleSeed: 'default' },
    interpreter = new RuleInterpreter(),
  ) {
    super(state, options, interpreter);
  }

  isEndState(state: GameState): WinnerState | null {
    const alive = getAlivePlayers(state);
    if (alive.length === 1 && state.players.length > 1) {
      return { type: 'players', playerIds: [alive[0].id] };
    }
    return null;
  }
}

export function createDualGameState(options: CreateDualGameOptions): GameState {
  if (options.players.length !== 2) throw new Error('Dual game requires exactly 2 players');
  const cards = Object.fromEntries((options.cards ?? []).map(card => [card.id, card]));
  const players: PlayerState[] = options.players.map(player => ({
    id: player.id,
    name: player.name,
    hp: player.maxHp ?? 4,
    maxHp: player.maxHp ?? 4,
    alive: true,
    hand: player.hand ?? [],
    equipment: {},
  }));

  for (const player of players) {
    for (const cardId of player.hand) {
      if (!cards[cardId]) throw new Error(`missing card instance for hand card: ${cardId}`);
      cards[cardId].zone = 'hand';
      cards[cardId].ownerId = player.id;
    }
  }

  return {
    id: options.id ?? 'game_1',
    mode: 'dual',
    phase: 'play',
    turn: { currentPlayerId: players[0].id, turnNumber: 1 },
    players,
    cards,
    deck: Object.values(cards).filter(card => card.zone === 'deck').map(card => card.id),
    discardPile: Object.values(cards).filter(card => card.zone === 'discard').map(card => card.id),
    resolutionStack: [],
    actionLog: [],
    winner: null,
    metadata: { shuffleSeed: options.shuffleSeed ?? 'default' },
  };
}
