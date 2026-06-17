import { WaitingType, ResolverType, ResolveResult, type GameState, type PlayerState, type CardInstance, type WaitingAction, type ResolutionItem, type GameContext, type GameEvent } from './types.ts';
import { buildDeck, shuffleDeck, getCardHandler } from './cards/index.ts';
import { getHeroes, getSkill, getSkillsForEvent } from './heroes/index.ts';
import { gameLog } from '../logger.ts';
import * as fs from 'fs';
import * as path from 'path';
// Load all card and hero plugins
import './cards/basic.ts';
import './cards/tricks.ts';
import './cards/equip.ts';
import './heroes/wei.ts';
import './heroes/shu.ts';
import './heroes/wu.ts';

export { getHeroes } from './heroes/index.ts';

export class Game implements GameContext {
  state: GameState;
  logs: string[] = [];
  actionHistory: { turn: number; playerId: string; action: string; data: any; timestamp: number }[] = [];

  constructor(players: { id: string; name: string; heroId: string }[]) {
    const deck = buildDeck();
    shuffleDeck(deck);
    this.state = {
      players: players.map(p => {
        const heroes = getHeroes();
        const hero = heroes.find(h => h.id === p.heroId)!;
        return {
          id: p.id, name: p.name, heroId: p.heroId,
          hp: hero.maxHp, maxHp: hero.maxHp,
          hand: [], equipment: {}, alive: true, attackCount: 0,
        };
      }),
      currentPlayerIdx: 0, phase: 'draw',
      deck, discard: [], turnNumber: 1, resolutionStack: [], winner: null,
    };
    for (const p of this.state.players) this.drawCards(p, 4);
    this.dumpInitialState();
  }

  private dumpInitialState(): void {
    const logDir = process.env.LOG_DIR;
    if (!logDir) return;
    const dir = path.join(logDir, 'states');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'turn_0.json'), JSON.stringify(this.saveStateDict(), null, 2));
  }

  static fromState(state: GameState): Game {
    const game = Object.create(Game.prototype) as Game;
    game.state = state;
    game.logs = [];
    game.actionHistory = [];
    return game;
  }

  replayAction(action: { playerId: string; action: string; data: any }): void {
    switch (action.action) {
      case 'play_card': this.playCard(action.playerId, action.data.cardUid, action.data.targetId); break;
      case 'respond': this.respond(action.playerId, action.data.cardUid); break;
      case 'end_play': this.endPlay(action.playerId); break;
      case 'discard_cards': this.discardCards(action.playerId, action.data.cardUids); break;
      case 'zhiheng': this.useZhiheng(action.playerId, action.data.cardUids); break;
    }
  }

  get currentPlayer(): PlayerState { return this.state.players[this.state.currentPlayerIdx]; }

  // GameContext implementation
  drawCards(player: PlayerState, count: number): CardInstance[] {
    const drawn: CardInstance[] = [];
    for (let i = 0; i < count; i++) {
      if (this.state.deck.length === 0) {
        this.state.deck = this.state.discard.splice(0);
        shuffleDeck(this.state.deck);
        if (this.state.deck.length === 0) break;
      }
      const card = this.state.deck.pop()!;
      player.hand.push(card);
      drawn.push(card);
    }
    gameLog.debug(`${player.name} 摸${drawn.length}张牌`);
    return drawn;
  }

  dealDamage(target: PlayerState, amount: number, sourceId?: string): void {
    target.hp -= amount;
    this.log(`${target.name} 受到${amount}点伤害，剩余${target.hp}点体力`);
    this.fireEvent('damage_taken', target);
    if (target.hp <= 0) {
      target.alive = false;
      this.log(`${target.name} 阵亡`);
      const alive = this.state.players.filter(p => p.alive);
      if (alive.length === 1) {
        this.state.winner = alive[0].id;
        this.log(`${alive[0].name} 获胜!`);
        this.dumpState();
      }
    }
  }

  useCard(player: PlayerState, cardIdx: number): void {
    this.state.discard.push(player.hand.splice(cardIdx, 1)[0]);
  }

  getPlayer(id: string): PlayerState | undefined { return this.state.players.find(p => p.id === id); }
  getOpponent(player: PlayerState): PlayerState | undefined { return this.state.players.find(p => p.id !== player.id && p.alive); }

  getPlayableUids(player: PlayerState): number[] {
    if (this.state.phase !== 'play' || this.currentPlayer.id !== player.id) return [];
    if (this.waitingFor && this.waitingFor.playerId === player.id) return [];
    return player.hand.filter(c => {
      const handler = getCardHandler(c.def.id);
      if (!handler) return false;
      if (handler.canPlay && !handler.canPlay(this, player, c)) return false;
      return true;
    }).map(c => c.uid);
  }

  // Resolution stack — backward-compatible waitingFor getter
  get waitingFor(): WaitingAction | null {
    const top = this.state.resolutionStack[this.state.resolutionStack.length - 1];
    return top ? { playerId: top.playerId, type: top.type, data: top.data } : null;
  }

  setWaiting(action: WaitingAction): void {
    this.pushResolution(action.type, action.playerId, action.type === WaitingType.DISCARD ? ResolverType.DISCARD : ResolverType.ATTACK, action.data);
  }

  pushResolution(type: WaitingType, playerId: string, resolver: ResolverType, data?: any): void {
    const id = `res_${this.state.resolutionStack.length}_${Date.now()}`;
    this.state.resolutionStack.push({ id, type, playerId, resolver, data });
  }

  popResolution(): ResolutionItem | undefined {
    return this.state.resolutionStack.pop();
  }

  hasSkill(player: PlayerState, skillId: string): boolean {
    const heroes = getHeroes();
    const hero = heroes.find(h => h.id === player.heroId);
    return hero?.skillIds.includes(skillId) ?? false;
  }

  log(msg: string): void { this.logs.push(msg); gameLog.debug(msg); }
  popLogs(): string[] { const l = this.logs; this.logs = []; return l; }

  saveStateDict(): object {
    const s = this.state;
    return {
      turnNumber: s.turnNumber,
      phase: s.phase,
      currentPlayerIdx: s.currentPlayerIdx,
      winner: s.winner,
      deckCount: s.deck.length,
      discardCount: s.discard.length,
      waitingFor: this.waitingFor ? { ...this.waitingFor } : null,
      resolutionStack: s.resolutionStack.map(r => ({ ...r })),
      players: s.players.map(p => ({
        id: p.id, name: p.name, heroId: p.heroId,
        hp: p.hp, maxHp: p.maxHp, alive: p.alive, attackCount: p.attackCount,
        hand: p.hand.map(c => ({ uid: c.uid, id: c.def.id, suit: c.def.suit, number: c.def.number })),
        equipment: Object.fromEntries(Object.entries(p.equipment).map(([slot, c]) => [slot, { uid: c!.uid, id: c!.def.id }])),
      })),
    };
  }

  // Event system
  fireEvent(event: GameEvent, player: PlayerState, data?: any): void {
    for (const skill of getSkillsForEvent(event)) {
      if (this.hasSkill(player, skill.id)) {
        skill.trigger(this, event, player, data);
      }
    }
  }

  // Turn flow
  startTurn(): void {
    const p = this.currentPlayer;
    p.attackCount = 0;
    this.state.phase = 'prepare';
    this.log(`${p.name} 的回合开始`);
    this.fireEvent('turn_start', p);
    this.state.phase = 'draw';
    const drawn = this.drawCards(p, 2);
    this.recordAction(p.id, 'draw', { cards: drawn.map(c => ({ uid: c.uid, id: c.def.id, suit: c.def.suit, number: c.def.number })) });
    this.state.phase = 'play';
  }

  playCard(playerId: string, cardUid: number, targetId?: string): WaitingAction | string | null {
    const player = this.getPlayer(playerId);
    if (!player || this.state.phase !== 'play' || this.currentPlayer.id !== playerId) return null;
    const cardIdx = player.hand.findIndex(c => c.uid === cardUid);
    if (cardIdx === -1) return null;
    const card = player.hand[cardIdx];
    this.recordAction(playerId, 'play_card', { cardUid, cardId: card.def.id, targetId });
    gameLog.debug(`${player.name} 尝试使用 ${card.def.nameCn}(${card.def.suit}${card.def.number}) target=${targetId||'none'}`);

    // Wusheng: red non-equipment cards can be played as sha
    if (card.def.id !== 'sha' && this.hasSkill(player, 'wusheng') &&
        (card.def.suit === 'heart' || card.def.suit === 'diamond') && card.def.type !== 'equipment') {
      const handler = getCardHandler('sha');
      if (handler) return handler.onPlay(this, player, card, cardIdx, targetId);
    }

    const handler = getCardHandler(card.def.id);
    if (!handler) return '未知卡牌';
    if (handler.canPlay && !handler.canPlay(this, player, card)) return '该牌当前不可使用';
    const result = handler.onPlay(this, player, card, cardIdx, targetId);
    if (result === null) return '该牌当前无法打出';
    return result;
  }

  respond(playerId: string, cardUid: number | null): WaitingAction | null {
    const waiting = this.waitingFor;
    if (!waiting || waiting.playerId !== playerId) return null;
    const player = this.getPlayer(playerId)!;
    this.recordAction(playerId, 'respond', { cardUid, waitingType: waiting.type });
    gameLog.debug(`${player.name} 响应 ${waiting.type} cardUid=${cardUid}`);

    // Pop current resolution
    const item = this.popResolution()!;

    if (item.type === WaitingType.RESPOND_ATTACK) {
      if (cardUid !== null) {
        const idx = player.hand.findIndex(c => c.uid === cardUid);
        if (idx !== -1 && player.hand[idx].def.id === 'shan') {
          this.useCard(player, idx);
          this.log(`${player.name} 使用了闪`);
          return this.waitingFor;
        }
      }
      this.dealDamage(player, 1, item.data?.source);
      return this.waitingFor;
    }

    if (item.type === WaitingType.RESPOND_DUEL) {
      if (cardUid !== null) {
        const idx = player.hand.findIndex(c => c.uid === cardUid);
        if (idx !== -1 && this.isValidAttackResponse(player, player.hand[idx])) {
          this.useCard(player, idx);
          this.log(`${player.name} 出杀`);
          const opponent = this.getPlayer(item.data.opponent)!;
          this.pushResolution(WaitingType.RESPOND_DUEL, opponent.id, ResolverType.DUEL, { opponent: player.id, source: item.data.source });
          return this.waitingFor;
        }
      }
      this.dealDamage(player, 1, item.data?.source);
      return this.waitingFor;
    }

    if (item.type === WaitingType.RESPOND_BARBARIAN) {
      if (cardUid !== null) {
        const idx = player.hand.findIndex(c => c.uid === cardUid);
        const needShan = item.data?.needShan;
        if (idx !== -1) {
          const card = player.hand[idx];
          const valid = needShan ? card.def.id === 'shan' : this.isValidAttackResponse(player, card);
          if (valid) { this.useCard(player, idx); this.log(`${player.name} 响应成功`); }
          else { this.dealDamage(player, 1, item.data?.source); }
        } else { this.dealDamage(player, 1, item.data?.source); }
      } else { this.dealDamage(player, 1, item.data?.source); }

      const nextTarget = item.data.remaining.find((id: string) => this.getPlayer(id)?.alive);
      if (nextTarget) {
        this.pushResolution(WaitingType.RESPOND_BARBARIAN, nextTarget, ResolverType.BARBARIAN, { ...item.data, remaining: item.data.remaining.filter((id: string) => id !== nextTarget) });
      }
      return this.waitingFor;
    }
    return this.waitingFor;
  }

  endPlay(playerId: string): void {
    if (this.currentPlayer.id !== playerId || this.state.phase !== 'play') return;
    this.recordAction(playerId, 'end_play', {});
    this.state.phase = 'discard';
    const p = this.currentPlayer;
    const excess = p.hand.length - p.hp;
    if (excess <= 0) this.endTurn();
    else this.pushResolution(WaitingType.DISCARD, p.id, ResolverType.DISCARD, { count: excess });
  }

  discardCards(playerId: string, cardUids: number[]): void {
    const player = this.getPlayer(playerId);
    if (!player || this.waitingFor?.playerId !== playerId) return;
    this.recordAction(playerId, 'discard_cards', { cardUids });
    for (const uid of cardUids) {
      const idx = player.hand.findIndex(c => c.uid === uid);
      if (idx !== -1) this.state.discard.push(player.hand.splice(idx, 1)[0]);
    }
    this.popResolution();
    if (this.state.phase === 'discard') this.endTurn();
  }

  useZhiheng(playerId: string, cardUids: number[]): void {
    const player = this.getPlayer(playerId);
    if (!player || this.currentPlayer.id !== playerId || this.state.phase !== 'play') return;
    if (!this.hasSkill(player, 'zhiheng') || cardUids.length === 0) return;
    this.recordAction(playerId, 'zhiheng', { cardUids });
    const skill = getSkill('zhiheng');
    if (skill?.activeAction) skill.activeAction(this, player, cardUids);
  }

  private endTurn(): void {
    this.state.resolutionStack = [];
    this.state.phase = 'end';
    this.fireEvent('turn_end', this.currentPlayer);
    this.dumpState();
    let next = (this.state.currentPlayerIdx + 1) % this.state.players.length;
    while (!this.state.players[next].alive) next = (next + 1) % this.state.players.length;
    this.state.currentPlayerIdx = next;
    this.state.turnNumber++;
    this.startTurn();
  }

  private dumpState(): void {
    const logDir = process.env.LOG_DIR;
    if (!logDir) return;
    const dir = path.join(logDir, 'states');
    fs.mkdirSync(dir, { recursive: true });
    const turn = this.state.turnNumber;
    fs.writeFileSync(path.join(dir, `turn_${turn}.json`), JSON.stringify(this.saveStateDict(), null, 2));
    fs.writeFileSync(path.join(dir, `actions_turn_${turn}.json`), JSON.stringify(this.getActionsForTurn(turn), null, 2));
    gameLog.debug(`State + actions dumped for turn ${turn}`);
  }

  private recordAction(playerId: string, action: string, data: any): void {
    this.actionHistory.push({ turn: this.state.turnNumber, playerId, action, data, timestamp: Date.now() });
  }

  private getActionsForTurn(turn: number): any[] {
    return this.actionHistory.filter(a => a.turn === turn);
  }

  getFullActionHistory(): any[] {
    return this.actionHistory;
  }

  private isValidAttackResponse(player: PlayerState, card: CardInstance): boolean {
    if (card.def.id === 'sha') return true;
    if (this.hasSkill(player, 'wusheng') && (card.def.suit === 'heart' || card.def.suit === 'diamond')) return true;
    return false;
  }
}
