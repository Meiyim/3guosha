export type Action =
  | PlayerAction
  | ResolutionAction
  | PrimitiveAction;

// Actions a client/player is allowed to submit when legal in the active rule layer.
export type PlayerAction =
  | CardPlayAction
  | CardRespondAction
  | PassAction
  | EndPhaseAction
  | DiscardAction;

// Actions produced while resolving a ResolutionFrame. They express rule outcomes,
// but are not direct state deltas.
export type ResolutionAction =
  | CancelShaResolutionAction;

// Primitive actions are the last step before Effect[]. They are produced by
// card rules, skill callbacks, or frame results, not directly by clients.
export type PrimitiveAction =
  | DamageAction
  | HealAction
  | CardDiscardAction
  | DrawCardAction
  | SetWinnerAction;

export type ActionType = Action['type'];
export type PlayerActionType = PlayerAction['type'];
export type ResolutionActionType = ResolutionAction['type'];
export type PrimitiveActionType = PrimitiveAction['type'];

export interface CardPlayAction {
  type: 'card_play';
  playerId: string;
  cardInstanceId: string;
  cardId: string;
  targets: string[];
}

export interface CardRespondAction {
  type: 'card_respond';
  playerId: string;
  cardInstanceId: string;
  cardId: string;
  resolutionFrameId: string;
}

export interface PassAction {
  type: 'pass';
  playerId: string;
  resolutionFrameId: string;
}

export interface EndPhaseAction {
  type: 'end_phase';
  playerId: string;
}

export interface DiscardAction {
  type: 'discard';
  playerId: string;
  cardInstanceIds: string[];
}

export interface CancelShaResolutionAction {
  type: 'cancel_sha_resolution';
  playerId: string;
}

export interface DamageAction {
  type: 'damage';
  sourcePlayerId?: string;
  targetPlayerId: string;
  amount: number;
}

export interface HealAction {
  type: 'heal';
  playerId: string;
  amount: number;
}

export interface CardDiscardAction {
  type: 'card_discard';
  playerId?: string;
  cardInstanceId: string;
}

export interface DrawCardAction {
  type: 'draw_card';
  playerId: string;
  count: number;
}

export interface SetWinnerAction {
  type: 'set_winner';
  winnerPlayerIds: string[];
}

export function isPrimitiveAction(action: Action): boolean {
  return action.type === 'damage'
    || action.type === 'heal'
    || action.type === 'card_discard'
    || action.type === 'draw_card'
    || action.type === 'end_phase'
    || action.type === 'set_winner';
}
