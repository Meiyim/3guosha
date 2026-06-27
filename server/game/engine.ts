import type {
  GameState,
  HeroDef,
  LegalAction,
  PlayerObservation,
  PlayerState,
  PrivateGameState,
  PublicGameState,
  WaitingAction,
} from './types.ts';

const REMOVED_ENGINE_MESSAGE = '旧游戏引擎逻辑已移除，等待 src/game 新引擎接入。';

const HEROES: HeroDef[] = [
  { id: 'caocao', name: 'Cao Cao', nameCn: '曹操', maxHp: 4, gender: 'male', kingdom: 'wei', skillIds: [] },
  { id: 'liubei', name: 'Liu Bei', nameCn: '刘备', maxHp: 4, gender: 'male', kingdom: 'shu', skillIds: [] },
  { id: 'sunquan', name: 'Sun Quan', nameCn: '孙权', maxHp: 4, gender: 'male', kingdom: 'wu', skillIds: [] },
];

export function getHeroes(): HeroDef[] {
  return HEROES;
}

export class Game {
  state: GameState;
  private logs: string[] = [REMOVED_ENGINE_MESSAGE];

  constructor(players: { id: string; name: string; heroId: string }[]) {
    if (players.length < 2) throw new Error('Game requires at least 2 players');
    this.state = {
      players: players.map(player => {
        const hero = HEROES.find(h => h.id === player.heroId) || HEROES[0];
        return {
          id: player.id,
          name: player.name,
          heroId: hero.id,
          hp: hero.maxHp,
          maxHp: hero.maxHp,
          hand: [],
          equipment: {},
          alive: true,
          attackCount: 0,
        };
      }),
      currentPlayerIdx: 0,
      phase: 'end',
      deck: [],
      discard: [],
      turnNumber: 0,
      resolutionStack: [],
      winner: null,
    };
  }

  static fromState(state: GameState): Game {
    const game = Object.create(Game.prototype) as Game;
    game.state = state;
    game.logs = [REMOVED_ENGINE_MESSAGE];
    return game;
  }

  get waitingFor(): WaitingAction | null {
    return null;
  }

  startTurn(): void {
    this.log(REMOVED_ENGINE_MESSAGE);
  }

  replayAction(): void {}

  step(_playerId: string, _action: LegalAction): { ok: boolean; error?: string } {
    return { ok: false, error: 'legacy_engine_removed' };
  }

  playCard(_playerId: string, _cardUid: number, _targetId?: string): string {
    return REMOVED_ENGINE_MESSAGE;
  }

  respond(_playerId: string, _cardUid: number | null): void {}

  endPlay(_playerId: string): void {}

  discardCards(_playerId: string, _cardUids: number[]): void {}

  useZhiheng(_playerId: string, _cardUids: number[]): void {}

  getPlayableUids(_player: PlayerState): number[] {
    return [];
  }

  legalActions(_playerId: string): LegalAction[] {
    return [];
  }

  observe(playerId: string): PlayerObservation | null {
    if (!this.state.players.some(player => player.id === playerId)) return null;
    return {
      publicState: this.buildPublicState(),
      privateState: this.buildPrivateState(playerId),
      legalActions: [],
    };
  }

  popLogs(): string[] {
    const logs = this.logs;
    this.logs = [];
    return logs;
  }

  saveStateDict(): object {
    return this.state;
  }

  private log(message: string): void {
    this.logs.push(message);
  }

  private buildPublicState(): PublicGameState {
    return {
      players: this.state.players.map(player => ({
        id: player.id,
        name: player.name,
        heroId: player.heroId,
        hp: player.hp,
        maxHp: player.maxHp,
        handCount: player.hand.length,
        equipment: {},
        alive: player.alive,
      })),
      currentPlayerIdx: this.state.currentPlayerIdx,
      phase: this.state.phase,
      deckCount: this.state.deck.length,
      turnNumber: this.state.turnNumber,
      waitingFor: null,
    };
  }

  private buildPrivateState(playerId: string): PrivateGameState {
    return {
      myId: playerId,
      myHand: [],
      playableUids: [],
      legalActions: [],
    };
  }
}
