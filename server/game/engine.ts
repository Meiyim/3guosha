import { WaitingType, ResolverType, ResolveResult, TargetType, type GameState, type PlayerState, type CardInstance, type WaitingAction, type ResolutionItem, type GameContext, type GameEvent, type LegalAction, type PlayerObservation, type PublicGameState, type PrivateGameState } from './types.ts';
import { buildDeck, shuffleDeck, getCardHandler } from './cards/index.ts';
import { getHeroes, getSkill, getSkillsForEvent } from './heroes/index.ts';
import { responseResolvers } from './resolvers/response.ts';
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
    if (players.length < 2) throw new Error('Game requires at least 2 players');
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

  step(playerId: string, action: LegalAction): { ok: boolean; error?: string } {
    if (!this.legalActions(playerId).some(legal => this.sameAction(legal, action))) {
      return { ok: false, error: 'illegal_action' };
    }

    switch (action.type) {
      case 'play_card': this.playCard(playerId, action.cardUid, action.targetId); break;
      case 'respond': this.respond(playerId, action.cardUid); break;
      case 'discard_cards': this.discardCards(playerId, action.cardUids); break;
      case 'end_play': this.endPlay(playerId); break;
      case 'zhiheng': this.useZhiheng(playerId, action.cardUids); break;
    }
    return { ok: true };
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

  dealDamage(target: PlayerState, amount: number, sourceId?: string, data?: { card?: CardInstance; afterRescue?: WaitingAction }): void {
    target.hp -= amount;
    this.log(`${target.name} 受到${amount}点伤害，剩余${target.hp}点体力`);
    this.fireEvent('damage_taken', target, { sourceId, card: data?.card });
    if (target.hp <= 0) {
      this.beginRescue(target, sourceId, data?.afterRescue);
    }
  }

  useCard(player: PlayerState, cardIdx: number): void {
    this.state.discard.push(player.hand.splice(cardIdx, 1)[0]);
  }

  getPlayer(id: string): PlayerState | undefined { return this.state.players.find(p => p.id === id); }
  getOpponent(player: PlayerState): PlayerState | undefined { return this.state.players.find(p => p.id !== player.id && p.alive); }
  getDistance(from: PlayerState, to: PlayerState): number {
    if (from.id === to.id) return 0;
    const alivePlayers = this.state.players.filter(p => p.alive);
    const fromIdx = alivePlayers.findIndex(p => p.id === from.id);
    const toIdx = alivePlayers.findIndex(p => p.id === to.id);
    if (fromIdx < 0 || toIdx < 0) return Number.POSITIVE_INFINITY;
    const aliveCount = alivePlayers.length;
    const clockwise = (toIdx - fromIdx + aliveCount) % aliveCount;
    const counterClockwise = (fromIdx - toIdx + aliveCount) % aliveCount;
    let distance = Math.min(clockwise, counterClockwise);
    if (from.equipment.horse_minus) distance -= 1;
    if (to.equipment.horse_plus) distance += 1;
    return Math.max(1, distance);
  }

  canUseShaOn(from: PlayerState, to: PlayerState): boolean {
    if (from.id === to.id || !to.alive) return false;
    const range = from.equipment.weapon?.def.id === 'zhuge' ? 1 : 1;
    return this.getDistance(from, to) <= range;
  }

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

  legalActions(playerId: string): LegalAction[] {
    const player = this.getPlayer(playerId);
    if (!player || !player.alive || this.state.winner) return [];

    const waiting = this.waitingFor;
    if (waiting) {
      if (waiting.playerId !== playerId) return [];
      if (waiting.type === WaitingType.DISCARD) {
        return this.cardCombinations(player.hand.map(c => c.uid), waiting.data?.count ?? 0)
          .map(cardUids => ({ type: 'discard_cards', cardUids }));
      }
      const responseCards = player.hand.filter(card => this.canUseCardForResponse(player, card, waiting));
      return [
        ...responseCards.map(card => ({ type: 'respond' as const, cardUid: card.uid, cardId: card.def.id })),
        { type: 'respond', cardUid: null },
      ];
    }

    if (this.state.phase !== 'play' || this.currentPlayer.id !== playerId) return [];

    const actions: LegalAction[] = [];
    for (const card of player.hand) {
      actions.push(...this.legalPlayCardActions(player, card));
    }
    if (this.hasSkill(player, 'zhiheng')) {
      for (const card of player.hand) actions.push({ type: 'zhiheng', cardUids: [card.uid] });
    }
    actions.push({ type: 'end_play' });
    return actions;
  }

  observe(playerId: string): PlayerObservation | null {
    const player = this.getPlayer(playerId);
    if (!player) return null;
    return {
      publicState: this.buildPublicState(),
      privateState: this.buildPrivateState(playerId),
      legalActions: this.legalActions(playerId),
    };
  }

  // Resolution stack — backward-compatible waitingFor getter
  get waitingFor(): WaitingAction | null {
    const top = this.state.resolutionStack[this.state.resolutionStack.length - 1];
    return top ? { playerId: top.playerId, type: top.type, data: top.data } : null;
  }

  setWaiting(action: WaitingAction): void {
    const resolver = action.type === WaitingType.DISCARD
      ? ResolverType.DISCARD
      : action.type === WaitingType.RESPOND_RESCUE
        ? ResolverType.RESCUE
        : ResolverType.ATTACK;
    this.pushResolution(action.type, action.playerId, resolver, action.data);
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
    const resolver = responseResolvers[item.type];
    return resolver ? resolver(this, item, player, cardUid) : this.waitingFor;
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
    const waiting = this.waitingFor;
    if (!player || waiting?.playerId !== playerId || waiting.type !== WaitingType.DISCARD) return;
    const required = waiting.data?.count ?? 0;
    const uniqueUids = [...new Set(cardUids)];
    const ownedCount = uniqueUids.filter(uid => player.hand.some(c => c.uid === uid)).length;
    if (ownedCount !== required) {
      this.log(`${player.name} 需要弃${required}张牌`);
      return;
    }
    this.recordAction(playerId, 'discard_cards', { cardUids });
    for (const uid of uniqueUids) {
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
    if (this.state.winner) return;
    this.state.resolutionStack = [];
    this.state.phase = 'end';
    this.fireEvent('turn_end', this.currentPlayer);
    if (this.state.winner) return;
    this.dumpState();
    const next = this.findNextAlivePlayerIndex(this.state.currentPlayerIdx);
    if (next < 0) return;
    this.state.currentPlayerIdx = next;
    this.state.turnNumber++;
    this.startTurn();
  }

  private findNextAlivePlayerIndex(fromIdx: number): number {
    for (let offset = 1; offset <= this.state.players.length; offset++) {
      const idx = (fromIdx + offset) % this.state.players.length;
      if (this.state.players[idx].alive) return idx;
    }
    return -1;
  }

  private legalPlayCardActions(player: PlayerState, card: CardInstance): LegalAction[] {
    const effectiveId = this.getEffectivePlayCardId(player, card);
    const handler = getCardHandler(effectiveId);
    if (!handler) return [];
    if (handler.canPlay && !handler.canPlay(this, player, card)) return [];

    if (handler.targetType === TargetType.SELF || handler.targetType === TargetType.ALL_OTHERS) {
      return [{ type: 'play_card', cardUid: card.uid, cardId: effectiveId }];
    }

    return this.state.players
      .filter(target => this.canTargetCard(player, card, effectiveId, target))
      .map(target => ({ type: 'play_card', cardUid: card.uid, cardId: effectiveId, targetId: target.id }));
  }

  private getEffectivePlayCardId(player: PlayerState, card: CardInstance): string {
    if (card.def.id !== 'sha' && this.hasSkill(player, 'wusheng') &&
        (card.def.suit === 'heart' || card.def.suit === 'diamond') && card.def.type !== 'equipment') {
      return 'sha';
    }
    return card.def.id;
  }

  private canTargetCard(player: PlayerState, card: CardInstance, effectiveId: string, target: PlayerState): boolean {
    if (!target.alive || target.id === player.id) return false;
    if (effectiveId === 'sha') return this.canUseShaOn(player, target);
    if (effectiveId === 'juedou') return true;
    return true;
  }

  private canUseCardForResponse(player: PlayerState, card: CardInstance, waiting: WaitingAction): boolean {
    if (waiting.type === WaitingType.RESPOND_ATTACK) return card.def.id === 'shan';
    if (waiting.type === WaitingType.RESPOND_DUEL) return this.isValidAttackResponse(player, card);
    if (waiting.type === WaitingType.RESPOND_BARBARIAN) {
      return waiting.data?.needShan ? card.def.id === 'shan' : this.isValidAttackResponse(player, card);
    }
    if (waiting.type === WaitingType.RESPOND_RESCUE) return card.def.id === 'tao';
    return false;
  }

  private cardCombinations(values: number[], count: number): number[][] {
    if (count < 0 || count > values.length) return [];
    if (count === 0) return [[]];
    const results: number[][] = [];
    const walk = (start: number, chosen: number[]) => {
      if (chosen.length === count) {
        results.push(chosen.slice());
        return;
      }
      for (let i = start; i < values.length; i++) {
        chosen.push(values[i]);
        walk(i + 1, chosen);
        chosen.pop();
      }
    };
    walk(0, []);
    return results;
  }

  beginRescue(dying: PlayerState, sourceId?: string, afterRescue?: WaitingAction): void {
    if (!dying.alive) return;
    const responders = this.getRescueOrder(dying.id);
    if (responders.length === 0) {
      this.finalizeDeath(dying);
      this.continueAfterRescue(afterRescue);
      return;
    }
    this.log(`${dying.name} 进入濒死，等待桃救援`);
    this.pushResolution(WaitingType.RESPOND_RESCUE, responders[0], ResolverType.RESCUE, {
      dyingPlayerId: dying.id,
      source: sourceId,
      remaining: responders.slice(1),
      afterRescue,
    });
  }

  private getRescueOrder(dyingPlayerId: string): string[] {
    const players = this.state.players;
    const start = players.findIndex(p => p.id === dyingPlayerId);
    if (start < 0) return [];
    const ordered: PlayerState[] = [];
    for (let i = 0; i < players.length; i++) {
      ordered.push(players[(start + i) % players.length]);
    }
    return ordered.filter(p => p.alive).map(p => p.id);
  }

  finalizeDeath(player: PlayerState): void {
    if (!player.alive) return;
    player.alive = false;
    this.log(`${player.name} 阵亡`);
    const alive = this.state.players.filter(p => p.alive);
    if (alive.length === 1) {
      this.state.winner = alive[0].id;
      this.log(`${alive[0].name} 获胜!`);
      this.dumpState();
    }
  }

  continueAfterRescue(action?: WaitingAction): void {
    if (!action || this.state.winner) return;
    const target = this.getPlayer(action.playerId);
    if (!target?.alive) return;
    const resolver = action.type === WaitingType.RESPOND_BARBARIAN ? ResolverType.BARBARIAN : ResolverType.ATTACK;
    this.pushResolution(action.type, action.playerId, resolver, action.data);
  }

  private buildPublicState(): PublicGameState {
    const s = this.state;
    return {
      players: s.players.map(p => ({
        id: p.id,
        name: p.name,
        heroId: p.heroId,
        hp: p.hp,
        maxHp: p.maxHp,
        handCount: p.hand.length,
        equipment: Object.fromEntries(Object.entries(p.equipment).map(([slot, card]) => [slot, (card as CardInstance).def])),
        alive: p.alive,
      })),
      currentPlayerIdx: s.currentPlayerIdx,
      phase: s.phase,
      deckCount: s.deck.length,
      turnNumber: s.turnNumber,
      waitingFor: this.waitingFor,
    };
  }

  private buildPrivateState(playerId: string): PrivateGameState {
    const me = this.getPlayer(playerId)!;
    return {
      myId: playerId,
      myHand: me.hand,
      playableUids: this.getPlayableUids(me),
      legalActions: this.legalActions(playerId),
    };
  }

  private sameAction(a: LegalAction, b: LegalAction): boolean {
    if (a.type !== b.type) return false;
    if (a.type === 'play_card' && b.type === 'play_card') {
      return a.cardUid === b.cardUid && a.targetId === b.targetId;
    }
    if (a.type === 'respond' && b.type === 'respond') {
      return a.cardUid === b.cardUid;
    }
    if (a.type === 'discard_cards' && b.type === 'discard_cards') {
      return this.sameUidSet(a.cardUids, b.cardUids);
    }
    if (a.type === 'zhiheng' && b.type === 'zhiheng') {
      return this.sameUidSet(a.cardUids, b.cardUids);
    }
    return true;
  }

  private sameUidSet(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    const left = [...a].sort((x, y) => x - y);
    const right = [...b].sort((x, y) => x - y);
    return left.every((uid, i) => uid === right[i]);
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

  isValidAttackResponse(player: PlayerState, card: CardInstance): boolean {
    if (card.def.id === 'sha') return true;
    if (this.hasSkill(player, 'wusheng') && (card.def.suit === 'heart' || card.def.suit === 'diamond')) return true;
    return false;
  }
}
