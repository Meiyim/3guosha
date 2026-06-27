import type { Action } from './action.ts';
import type { Effect } from './effect.ts';
import type { ActionResolutionResult, ResolutionFrame } from './resolution.ts';
import type { CardInstance, CardZone, GamePhase, GameState, PlayerState, TurnState, WinnerState } from './state.ts';

export type GameTraceEvent = {
  index: number;
  timestamp: number;
  resolutionDepth: number;
} & GameTraceEventPayload;

export type GameTraceEventPayload =
  | { type: 'dispatch_start'; action: Action }
  | { type: 'dispatch_rejected'; action: Action; error: string }
  | { type: 'dispatch_end'; action: Action; effects: Effect[] }
  | { type: 'action_interpret_start'; action: Action }
  | { type: 'action_resolved'; action: Action; result: ActionResolutionResult }
  | { type: 'frame_pushed'; frame: ResolutionFrame }
  | { type: 'frame_action_received'; frame: ResolutionFrame; action: Action }
  | { type: 'frame_marker_selected'; frame: ResolutionFrame; marker: Action; remainingActions: Action[] }
  | { type: 'criterion_pending'; frame: ResolutionFrame; actions: Action[] }
  | { type: 'criterion_completed'; frame: ResolutionFrame; actions: Action[] }
  | { type: 'primitive_resolved'; action: Action; effects: Effect[] }
  | { type: 'effect_applied'; effect: Effect }
  | { type: 'state_changed'; effect: Effect; changes: GameStateChange[] };

export type GameStateChange =
  | { type: 'phase'; before: GamePhase; after: GamePhase }
  | { type: 'turn'; before: TurnState; after: TurnState }
  | { type: 'winner'; before: WinnerState | null; after: WinnerState | null }
  | { type: 'player_hp'; playerId: string; before: number; after: number }
  | { type: 'player_alive'; playerId: string; before: boolean; after: boolean }
  | { type: 'player_hand'; playerId: string; before: string[]; after: string[] }
  | { type: 'card_zone'; cardInstanceId: string; cardId: string; before: CardZone; after: CardZone }
  | { type: 'card_owner'; cardInstanceId: string; cardId: string; before?: string; after?: string }
  | { type: 'deck'; before: string[]; after: string[] }
  | { type: 'discard_pile'; before: string[]; after: string[] };

export interface GameStateSnapshot {
  phase: GamePhase;
  turn: TurnState;
  winner: WinnerState | null;
  players: Record<string, Pick<PlayerState, 'id' | 'hp' | 'alive' | 'hand'>>;
  cards: Record<string, Pick<CardInstance, 'id' | 'cardId' | 'zone' | 'ownerId'>>;
  deck: string[];
  discardPile: string[];
}

export interface TraceFormatOptions {
  colors?: boolean;
  includeTimestamp?: boolean;
}

export function snapshotGameState(state: GameState): GameStateSnapshot {
  return {
    phase: state.phase,
    turn: { ...state.turn },
    winner: state.winner ? JSON.parse(JSON.stringify(state.winner)) : null,
    players: Object.fromEntries(state.players.map(player => [player.id, {
      id: player.id,
      hp: player.hp,
      alive: player.alive,
      hand: [...player.hand],
    }])),
    cards: Object.fromEntries(Object.entries(state.cards).map(([id, card]) => [id, {
      id: card.id,
      cardId: card.cardId,
      zone: card.zone,
      ownerId: card.ownerId,
    }])),
    deck: [...state.deck],
    discardPile: [...state.discardPile],
  };
}

export function diffGameState(before: GameStateSnapshot, after: GameStateSnapshot): GameStateChange[] {
  const changes: GameStateChange[] = [];

  if (before.phase !== after.phase) changes.push({ type: 'phase', before: before.phase, after: after.phase });
  if (before.turn.currentPlayerId !== after.turn.currentPlayerId || before.turn.turnNumber !== after.turn.turnNumber) {
    changes.push({ type: 'turn', before: before.turn, after: after.turn });
  }
  if (JSON.stringify(before.winner) !== JSON.stringify(after.winner)) {
    changes.push({ type: 'winner', before: before.winner, after: after.winner });
  }

  for (const playerId of new Set([...Object.keys(before.players), ...Object.keys(after.players)])) {
    const oldPlayer = before.players[playerId];
    const newPlayer = after.players[playerId];
    if (!oldPlayer || !newPlayer) continue;
    if (oldPlayer.hp !== newPlayer.hp) {
      changes.push({ type: 'player_hp', playerId, before: oldPlayer.hp, after: newPlayer.hp });
    }
    if (oldPlayer.alive !== newPlayer.alive) {
      changes.push({ type: 'player_alive', playerId, before: oldPlayer.alive, after: newPlayer.alive });
    }
    if (!sameList(oldPlayer.hand, newPlayer.hand)) {
      changes.push({ type: 'player_hand', playerId, before: oldPlayer.hand, after: newPlayer.hand });
    }
  }

  for (const cardInstanceId of new Set([...Object.keys(before.cards), ...Object.keys(after.cards)])) {
    const oldCard = before.cards[cardInstanceId];
    const newCard = after.cards[cardInstanceId];
    if (!oldCard || !newCard) continue;
    if (oldCard.zone !== newCard.zone) {
      changes.push({
        type: 'card_zone',
        cardInstanceId,
        cardId: newCard.cardId,
        before: oldCard.zone,
        after: newCard.zone,
      });
    }
    if (oldCard.ownerId !== newCard.ownerId) {
      changes.push({
        type: 'card_owner',
        cardInstanceId,
        cardId: newCard.cardId,
        before: oldCard.ownerId,
        after: newCard.ownerId,
      });
    }
  }

  if (!sameList(before.deck, after.deck)) changes.push({ type: 'deck', before: before.deck, after: after.deck });
  if (!sameList(before.discardPile, after.discardPile)) {
    changes.push({ type: 'discard_pile', before: before.discardPile, after: after.discardPile });
  }

  return changes;
}

export function formatTraceLog(events: readonly GameTraceEvent[], options: TraceFormatOptions = {}): string {
  return events.map(event => formatTraceEvent(event, options)).filter(Boolean).join('\n');
}

export function formatTraceEvent(event: GameTraceEvent, options: TraceFormatOptions = {}): string {
  const color = createColor(options.colors ?? true);
  const baseIndent = traceIndent(event);
  const prefix = `${baseIndent}${color.dim(`#${event.index}`)}${options.includeTimestamp ? ` ${color.dim(String(event.timestamp))}` : ''}`;
  const detailLine = (line: string) => detail(line, event);

  switch (event.type) {
    case 'dispatch_start':
      return [
        `${prefix} ${color.action('RECV Action')}`,
        detailLine(formatAction(event.action, color)),
      ].join('\n');
    case 'dispatch_rejected':
      return [
        `${prefix} ${color.error('REJECT Action')}`,
        detailLine(formatAction(event.action, color)),
        detailLine(color.error(event.error)),
      ].join('\n');
    case 'action_interpret_start':
      return [
        `${prefix} ${color.action('RUN Action')}`,
        detailLine(formatAction(event.action, color)),
      ].join('\n');
    case 'action_resolved':
      return [
        `${prefix} ${color.action('RESOLVE Action')}`,
        detailLine(formatAction(event.action, color)),
        detailLine(`${color.action('=> actions')} ${formatActionList(event.result.actions, color)}`),
        detailLine(`${color.frame('=> frames')} ${formatFrameList(event.result.frames, color)}`),
      ].join('\n');
    case 'frame_pushed':
      return [
        `${prefix} ${color.frame('PUSH Frame')}`,
        detailLine(formatFrame(event.frame, color)),
      ].join('\n');
    case 'frame_action_received':
      return [
        `${prefix} ${color.action('FRAME RECV Action')}`,
        detailLine(formatAction(event.action, color)),
        detailLine(color.frame(`in ${event.frame.id}`)),
      ].join('\n');
    case 'frame_marker_selected':
      return [
        `${prefix} ${color.action('FRAME MARKER')}`,
        detailLine(formatAction(event.marker, color)),
        detailLine(color.frame(`for ${event.frame.id}`)),
        detailLine(`${color.action('remaining')} ${formatActionList(event.remainingActions, color)}`),
      ].join('\n');
    case 'criterion_pending':
      return [
        `${prefix} ${color.frame('CRITERION pending')}`,
        detailLine(formatFrame(event.frame, color)),
        detailLine(formatActionList(event.actions, color)),
      ].join('\n');
    case 'criterion_completed':
      return [
        `${prefix} ${color.frame('CRITERION completed')}`,
        detailLine(formatFrame(event.frame, color)),
        detailLine(`${color.action('actions')} ${formatActionList(event.actions, color)}`),
      ].join('\n');
    case 'primitive_resolved':
      return [
        `${prefix} ${color.action('RESOLVE Primitive')}`,
        detailLine(formatAction(event.action, color)),
        detailLine(`${color.effect('=>')} ${formatEffectList(event.effects, color)}`),
      ].join('\n');
    case 'effect_applied':
      return [
        `${prefix} ${color.effect('APPLY Effect')}`,
        detailLine(formatEffect(event.effect, color)),
      ].join('\n');
    case 'state_changed':
      return formatStateChangeEvent(prefix, event, event.changes, color);
    case 'dispatch_end':
      return [
        `${prefix} ${color.dim('END Dispatch')}`,
        detailLine(formatAction(event.action, color)),
        detailLine(`${color.effect('effects')} ${formatEffectList(event.effects, color)}`),
      ].join('\n');
  }
}

function formatStateChangeEvent(prefix: string, event: GameTraceEvent, changes: GameStateChange[], color: TraceColor): string {
  const lines = changes.map(change => {
    const formatter = change.type === 'phase' || change.type === 'turn' ? color.phase : color.state;
    return detail(formatter(formatStateChange(change, color)), event);
  });
  return [`${prefix} ${color.state('STATE Change')}`, ...lines].join('\n');
}

function detail(line: string, event: GameTraceEvent): string {
  return `${traceIndent(event)}  ${line}`;
}

function traceIndent(event: GameTraceEvent): string {
  return '  '.repeat(event.resolutionDepth ?? 0);
}

function formatActionList(actions: Action[], color: TraceColor): string {
  if (actions.length === 0) return color.dim('[]');
  return `[${actions.map(action => formatAction(action, color)).join(', ')}]`;
}

function formatEffectList(effects: Effect[], color: TraceColor): string {
  if (effects.length === 0) return color.dim('[]');
  return `[${effects.map(effect => formatEffect(effect, color)).join(', ')}]`;
}

function formatFrameList(frames: ResolutionFrame[], color: TraceColor): string {
  if (frames.length === 0) return color.dim('[]');
  return `[${frames.map(frame => formatFrame(frame, color)).join(', ')}]`;
}

function formatAction(action: Action, color: TraceColor): string {
  switch (action.type) {
    case 'card_play':
      return color.action(`CardPlayAction(player=${color.bold(action.playerId)}, card=${color.bold(action.cardId)}, instance=${color.bold(action.cardInstanceId)}, targets=${formatIdList(action.targets, color)})`);
    case 'card_respond':
      return color.action(`CardRespondAction(player=${color.bold(action.playerId)}, card=${color.bold(action.cardId)}, instance=${color.bold(action.cardInstanceId)}, frame=${action.resolutionFrameId})`);
    case 'pass':
      return color.action(`PassAction(player=${color.bold(action.playerId)}, frame=${action.resolutionFrameId})`);
    case 'end_phase':
      return color.action(`EndPhaseAction(player=${color.bold(action.playerId)})`);
    case 'discard':
      return color.action(`DiscardAction(player=${color.bold(action.playerId)}, cards=${formatIdList(action.cardInstanceIds, color)})`);
    case 'cancel_sha_resolution':
      return color.action(`CancelShaResolutionAction(player=${color.bold(action.playerId)})`);
    case 'damage':
      return color.action(`DamageAction(source=${formatOptionalId(action.sourcePlayerId, color)}, target=${color.bold(action.targetPlayerId)}, amount=${action.amount})`);
    case 'heal':
      return color.action(`HealAction(player=${color.bold(action.playerId)}, amount=${action.amount})`);
    case 'card_discard':
      return color.action(`CardDiscardAction(player=${formatOptionalId(action.playerId, color)}, instance=${color.bold(action.cardInstanceId)})`);
    case 'draw_card':
      return color.action(`DrawCardAction(player=${color.bold(action.playerId)}, count=${action.count})`);
    case 'set_winner':
      return color.action(`SetWinnerAction(winners=${formatIdList(action.winnerPlayerIds, color)})`);
  }
}

function formatEffect(effect: Effect, color: TraceColor): string {
  switch (effect.type) {
    case 'heal':
      return color.effect(`HealEffect(player=${color.bold(effect.playerId)}, amount=${effect.amount})`);
    case 'damage':
      return color.effect(`DamageEffect(source=${formatOptionalId(effect.sourcePlayerId, color)}, target=${color.bold(effect.targetPlayerId)}, amount=${effect.amount})`);
    case 'card_move':
      return color.effect(`CardMoveEffect(instance=${color.bold(effect.cardInstanceId)}, player=${formatOptionalId(effect.playerId, color)}, to=${effect.to})`);
    case 'draw_card':
      return color.effect(`DrawCardEffect(player=${color.bold(effect.playerId)}, count=${effect.count})`);
    case 'next_phase':
      return color.effect(`NextPhaseEffect(phase=${effect.phase})`);
    case 'next_turn':
      return color.effect('NextTurnEffect()');
    case 'set_winner':
      return color.effect(`SetWinnerEffect(${JSON.stringify(effect.winner)})`);
    case 'no_effect':
      return color.effect('NoEffect()');
  }
}

function formatFrame(frame: ResolutionFrame, color: TraceColor): string {
  if (frame.criterion.type === 'action_response') {
    return color.frame(`Frame(${frame.id}, player=${color.bold(frame.criterion.playerId)}, expects=${frame.criterion.actionTypes.join('|')})`);
  }
  if (frame.criterion.type === 'card_respond') {
    return color.frame(`Frame(${frame.id}, cards=${frame.criterion.cardIds.map(id => color.bold(id)).join('|')})`);
  }
  return color.frame(`Frame(${frame.id}, judgement=${frame.criterion.reason})`);
}

function formatStateChange(change: GameStateChange, color: TraceColor): string {
  switch (change.type) {
    case 'phase':
      return `Phase ${change.before} -> ${change.after}`;
    case 'turn':
      return `Turn player ${color.bold(change.before.currentPlayerId)}#${change.before.turnNumber} -> ${color.bold(change.after.currentPlayerId)}#${change.after.turnNumber}`;
    case 'winner':
      return `Winner ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`;
    case 'player_hp':
      return `Player ${color.bold(change.playerId)} hp ${change.before} -> ${change.after}`;
    case 'player_alive':
      return `Player ${color.bold(change.playerId)} alive ${change.before} -> ${change.after}`;
    case 'player_hand':
      return `Player ${color.bold(change.playerId)} hand ${formatIdList(change.before, color)} -> ${formatIdList(change.after, color)}`;
    case 'card_zone':
      return `Card ${color.bold(change.cardId)}/${color.bold(change.cardInstanceId)} zone ${change.before} -> ${change.after}`;
    case 'card_owner':
      return `Card ${color.bold(change.cardId)}/${color.bold(change.cardInstanceId)} owner ${formatOptionalId(change.before, color)} -> ${formatOptionalId(change.after, color)}`;
    case 'deck':
      return `Deck [${change.before.length}] -> [${change.after.length}]`;
    case 'discard_pile':
      return `DiscardPile ${formatIdList(change.before, color)} -> ${formatIdList(change.after, color)}`;
  }
}

function formatIdList(ids: string[], color: TraceColor): string {
  return `[${ids.map(id => color.bold(id)).join(', ')}]`;
}

function formatOptionalId(id: string | undefined, color: TraceColor): string {
  return id ? color.bold(id) : '-';
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

type TraceColor = ReturnType<typeof createColor>;

function createColor(enabled: boolean) {
  const wrap = (open: string, close: string, value: string) => enabled ? `${open}${value}${close}` : value;
  return {
    bold: (value: string) => wrap('\x1b[1m', '\x1b[22m', value),
    dim: (value: string) => wrap('\x1b[2m', '\x1b[22m', value),
    action: (value: string) => wrap('\x1b[36m', '\x1b[39m', value),
    effect: (value: string) => wrap('\x1b[35m', '\x1b[39m', value),
    state: (value: string) => wrap('\x1b[32m', '\x1b[39m', value),
    phase: (value: string) => wrap('\x1b[33m', '\x1b[39m', value),
    frame: (value: string) => wrap('\x1b[34m', '\x1b[39m', value),
    error: (value: string) => wrap('\x1b[31m', '\x1b[39m', value),
  };
}
