import type { Action } from './action.ts';
import { isPrimitiveAction } from './action.ts';
import type { Effect } from './effect.ts';
import { applyEffect } from './effect.ts';
import { RuleInterpreter } from './interpreter.ts';
import type { GameState, PlayerState, WinnerState } from './state.ts';
import { getAlivePlayers, getCurrentPlayer, getPlayer } from './state.ts';
import type { ActionResolutionResult, CriterionResult, ResolutionFrame } from './resolution.ts';
import { acceptActionResponse, acceptCardRespond, currentFramePlayer, emptyResolutionResult } from './resolution.ts';

export interface GameControllerOptions {
  shuffleSeed: string;
}

export interface DispatchResult {
  ok: boolean;
  state: GameState;
  effects: Effect[];
  error?: string;
}

export abstract class GameController {
  private frameCounter = 0;

  constructor(
    protected state: GameState,
    protected options: GameControllerOptions,
    protected interpreter: RuleInterpreter = new RuleInterpreter(),
  ) {}

  getState(): GameState {
    return this.state;
  }

  nextFrameId(): string {
    this.frameCounter += 1;
    return `frame_${this.frameCounter}`;
  }

  abstract isEndState(state: GameState): WinnerState | null;

  getLegalActions(playerId: string): Action[] {
    if (this.state.winner || this.state.phase === 'ended') return [];
    const frame = this.topFrame();
    if (frame) return this.getFrameLegalActions(frame, playerId);
    return this.getBaseLegalActions(playerId);
  }

  resolveAction(action: Action): ActionResolutionResult {
    if (action.type !== 'card_play') return emptyResolutionResult();
    return this.interpreter.interpretPlayerAction(this.cardRuleContext(), action);
  }

  resolvePrimitiveAction(action: Action): Effect[] {
    switch (action.type) {
      case 'heal':
        return [{ type: 'heal', playerId: action.playerId, amount: action.amount }];
      case 'damage':
        return [{
          type: 'damage',
          targetPlayerId: action.targetPlayerId,
          sourcePlayerId: action.sourcePlayerId,
          amount: action.amount,
        }];
      case 'card_discard':
        return [{ type: 'card_move', cardInstanceId: action.cardInstanceId, playerId: action.playerId, to: 'discard' }];
      case 'draw_card':
        return [{ type: 'draw_card', playerId: action.playerId, count: action.count }];
      case 'end_phase':
        return [{ type: 'next_turn' }];
      case 'set_winner':
        return [{ type: 'set_winner', winner: { type: 'players', playerIds: action.winnerPlayerIds } }];
      default:
        return [];
    }
  }

  dispatch(action: Action): DispatchResult {
    const legal = this.getLegalActions((action as any).playerId);
    if (this.isPlayerSubmittedAction(action) && !legal.some(candidate => sameAction(candidate, action))) {
      return { ok: false, state: this.state, effects: [], error: 'illegal_action' };
    }

    const effects: Effect[] = [];
    this.interpretActionProgram([action], effects);

    return { ok: true, state: this.state, effects };
  }

  private interpretActionProgram(initialActions: Action[], effects: Effect[]): void {
    const program = [...initialActions];
    while (program.length > 0) {
      const action = program.shift()!;
      const nextActions = this.interpretAction(action, effects);
      program.unshift(...nextActions);
    }
  }

  private interpretAction(action: Action, effects: Effect[]): Action[] {
    this.state.actionLog.push({ action, timestamp: Date.now() });

    const frame = this.topFrame();
    if (frame && this.isFrameSubmittedAction(action)) {
      return this.acceptFrameAction(frame, action).actions;
    }

    if (isPrimitiveAction(action)) {
      this.applyPrimitiveAction(action, effects);
      return [];
    }

    const result = this.resolveAction(action);
    this.pushNextFrame(result.frames);
    return result.actions;
  }

  private applyPrimitiveAction(action: Action, effects: Effect[]): void {
    const primitiveEffects = this.resolvePrimitiveAction(action);
    for (const effect of primitiveEffects) {
      applyEffect(this.state, effect);
      effects.push(effect);
      this.applyEndStateIfReached(effects);
    }
  }

  protected getBaseLegalActions(playerId: string): Action[] {
    const player = getPlayer(this.state, playerId);
    const current = getCurrentPlayer(this.state);
    if (!player || !current || !player.alive || current.id !== playerId || this.state.phase !== 'play') {
      return [];
    }

    const actions: Action[] = [];
    for (const cardInstanceId of player.hand) {
      const card = this.state.cards[cardInstanceId];
      if (!card) continue;
      const targets = this.legalTargetsForCard(player, card.cardId);
      if (targets.length === 0) {
        const action: Action = { type: 'card_play', playerId, cardInstanceId, cardId: card.cardId, targets: [] };
        if (this.interpreter.canPlayCard(this.cardRuleContext(), player, action)) actions.push(action);
      }
      for (const targetId of targets) {
        const action: Action = { type: 'card_play', playerId, cardInstanceId, cardId: card.cardId, targets: [targetId] };
        if (this.interpreter.canPlayCard(this.cardRuleContext(), player, action)) actions.push(action);
      }
    }
    actions.push({ type: 'end_phase', playerId });
    return actions;
  }

  protected legalTargetsForCard(player: PlayerState, cardId: string): string[] {
    if (cardId !== 'sha') return [];
    return getAlivePlayers(this.state)
      .filter(target => target.id !== player.id)
      .map(target => target.id);
  }

  private getFrameLegalActions(frame: ResolutionFrame, playerId: string): Action[] {
    const expectedPlayerId = currentFramePlayer(frame);
    if (expectedPlayerId !== playerId) return [];

    if (frame.criterion.type === 'card_respond') {
      const player = getPlayer(this.state, playerId);
      const actions: Action[] = [];
      for (const cardInstanceId of player?.hand ?? []) {
        const card = this.state.cards[cardInstanceId];
        if (card && frame.criterion.cardIds.includes(card.cardId)) {
          actions.push({ type: 'card_respond', playerId, cardInstanceId, cardId: card.cardId, resolutionFrameId: frame.id });
        }
      }
      if (frame.criterion.passAllowed) actions.push({ type: 'pass', playerId, resolutionFrameId: frame.id });
      return actions;
    }

    if (frame.criterion.type === 'action_response') {
      const player = getPlayer(this.state, playerId);
      const actions: Action[] = [];
      for (const cardInstanceId of player?.hand ?? []) {
        const card = this.state.cards[cardInstanceId];
        if (!card) continue;
        const action: Action = { type: 'card_play', playerId, cardInstanceId, cardId: card.cardId, targets: [] };
        if (this.interpreter.canPlayCard(this.cardRuleContext(frame), player!, action)) actions.push(action);
      }
      if (frame.criterion.passAllowed) actions.push({ type: 'pass', playerId, resolutionFrameId: frame.id });
      return actions;
    }

    return [];
  }

  private acceptFrameAction(frame: ResolutionFrame, action: Action): CriterionResult {
    if (frame.criterion.type === 'card_respond') {
      return this.applyCriterionResult(acceptCardRespond(this.state, frame, action));
    }

    if (frame.criterion.type === 'action_response') {
      if (action.type === 'card_play') {
        const resolved = this.resolveAction(action);
        const marker = resolved.actions.find(candidate => frame.criterion.type === 'action_response'
          && frame.criterion.actionTypes.includes(candidate.type));
        if (!marker) return { status: 'pending', frame, actions: [] };
        const rest = resolved.actions.filter(candidate => candidate !== marker);
        const accepted = acceptActionResponse(frame, marker);
        const applied = this.applyCriterionResult(accepted);
        return { ...applied, actions: [...rest, ...applied.actions] };
      }
      return this.applyCriterionResult(acceptActionResponse(frame, action));
    }

    return { status: 'pending', frame, actions: [] };
  }

  private applyCriterionResult(result: CriterionResult): CriterionResult {
    if (result.status === 'pending') {
      this.state.resolutionStack[this.state.resolutionStack.length - 1] = result.frame;
      return result;
    }
    this.state.resolutionStack.pop();
    return result;
  }

  private pushNextFrame(frames: ResolutionFrame[]): void {
    const [first] = frames;
    if (first) this.state.resolutionStack.push(first);
  }

  private topFrame(): ResolutionFrame | undefined {
    return this.state.resolutionStack[this.state.resolutionStack.length - 1];
  }

  private cardRuleContext(activeFrame?: ResolutionFrame) {
    return {
      state: this.state,
      nextFrameId: () => this.nextFrameId(),
      activeFrame,
    };
  }

  private isPlayerSubmittedAction(action: Action): boolean {
    return action.type === 'card_play'
      || action.type === 'card_respond'
      || action.type === 'pass'
      || action.type === 'end_phase'
      || action.type === 'discard';
  }

  private isFrameSubmittedAction(action: Action): boolean {
    return action.type === 'card_play'
      || action.type === 'card_respond'
      || action.type === 'pass'
      || action.type === 'cancel_sha_resolution';
  }

  private applyEndStateIfReached(effects: Effect[]): void {
    if (this.state.winner) return;
    const winner = this.isEndState(this.state);
    if (!winner) return;
    const effect: Effect = { type: 'set_winner', winner };
    applyEffect(this.state, effect);
    effects.push(effect);
  }
}

function sameAction(left: Action, right: Action): boolean {
  if (left.type !== right.type) return false;
  if ((left as any).playerId !== (right as any).playerId) return false;
  if (left.type === 'card_play' && right.type === 'card_play') {
    return left.cardInstanceId === right.cardInstanceId
      && left.cardId === right.cardId
      && left.targets.join(',') === right.targets.join(',');
  }
  if (left.type === 'card_respond' && right.type === 'card_respond') {
    return left.cardInstanceId === right.cardInstanceId && left.resolutionFrameId === right.resolutionFrameId;
  }
  if (left.type === 'pass' && right.type === 'pass') return left.resolutionFrameId === right.resolutionFrameId;
  return true;
}
