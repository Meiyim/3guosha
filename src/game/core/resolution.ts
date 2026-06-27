import type { Action } from './action.ts';
import type { GameState } from './state.ts';

export interface ResolutionParticipant {
  playerId: string;
}

export interface ResolutionFrame {
  id: string;
  sourceAction: Action;
  participants: ResolutionParticipant[];
  cursor: number;
  criterion: ResolutionCriterion;
  result: ResolutionResultActions;
  context: Record<string, unknown>;
}

export interface ResolutionResultActions {
  success: Action[];
  failure: Action[];
  always: Action[];
}

export type ResolutionCriterion =
  | CardRespondCriterion
  | ActionResponseCriterion
  | CardJudgementCriterion;

export interface CardRespondCriterion {
  type: 'card_respond';
  cardIds: string[];
  passAllowed: boolean;
  successWhen: 'responded' | 'not_responded';
  requiredCount?: number;
  respondedCount?: number;
  failureWhen?: 'current_player_passed' | 'all_participants_passed';
}

export interface ActionResponseCriterion {
  type: 'action_response';
  playerId: string;
  actionTypes: string[];
  passAllowed: boolean;
  successWhen: 'responded' | 'not_responded';
}

export interface CardJudgementCriterion {
  type: 'card_judgement';
  reason: string;
  judgePlayerId: string;
  cardPattern: CardPattern;
}

export interface CardPattern {
  suits?: string[];
  colors?: Array<'red' | 'black'>;
  cardIds?: string[];
}

export type CriterionResult =
  | { status: 'pending'; frame: ResolutionFrame; actions: Action[] }
  | { status: 'completed'; actions: Action[] };

export interface ActionResolutionResult {
  actions: Action[];
  frames: ResolutionFrame[];
}

export function emptyResolutionResult(): ActionResolutionResult {
  return { actions: [], frames: [] };
}

export function currentFramePlayer(frame: ResolutionFrame): string | null {
  return frame.participants[frame.cursor]?.playerId ?? null;
}

export function completeFrame(frame: ResolutionFrame, succeeded: boolean): CriterionResult {
  return {
    status: 'completed',
    actions: [
      ...(succeeded ? frame.result.success : frame.result.failure),
      ...frame.result.always,
    ],
  };
}

export function acceptCardRespond(
  state: GameState,
  frame: ResolutionFrame,
  action: Action,
): CriterionResult {
  const criterion = frame.criterion;
  if (criterion.type !== 'card_respond') throw new Error('frame criterion is not card_respond');
  const expectedPlayerId = currentFramePlayer(frame);
  const passed = action.type === 'pass' && action.playerId === expectedPlayerId;
  const responded = action.type === 'card_respond'
    && action.playerId === expectedPlayerId
    && action.resolutionFrameId === frame.id
    && criterion.cardIds.includes(action.cardId);

  if (!passed && !responded) return { status: 'pending', frame, actions: [] };
  if (passed && !criterion.passAllowed) return { status: 'pending', frame, actions: [] };

  if (responded) {
    const respondedCount = (criterion.respondedCount ?? 0) + 1;
    const requiredCount = criterion.requiredCount ?? 1;
    const nextFrame = {
      ...frame,
      criterion: { ...criterion, respondedCount },
    };
    const discardAction: Action = {
      type: 'card_discard',
      playerId: action.playerId,
      cardInstanceId: action.cardInstanceId,
    };
    if (respondedCount >= requiredCount) {
      return completeFrame({
        ...nextFrame,
        result: {
          ...nextFrame.result,
          success: [...nextFrame.result.success, discardAction],
        },
      }, criterion.successWhen === 'responded');
    }
    return advancePendingFrame(state, nextFrame, [discardAction]);
  }

  const shouldCompleteOnPass = criterion.failureWhen !== 'all_participants_passed'
    || isLastParticipant(frame);
  if (shouldCompleteOnPass) return completeFrame(frame, criterion.successWhen === 'not_responded');
  return advancePendingFrame(state, frame, []);
}

export function acceptActionResponse(frame: ResolutionFrame, action: Action): CriterionResult {
  const criterion = frame.criterion;
  if (criterion.type !== 'action_response') throw new Error('frame criterion is not action_response');
  const passed = action.type === 'pass'
    && action.playerId === criterion.playerId
    && action.resolutionFrameId === frame.id;
  const responded = 'playerId' in action
    && action.playerId === criterion.playerId
    && criterion.actionTypes.includes(action.type);

  if (!passed && !responded) return { status: 'pending', frame, actions: [] };
  if (passed && !criterion.passAllowed) return { status: 'pending', frame, actions: [] };
  return completeFrame(frame, responded ? criterion.successWhen === 'responded' : criterion.successWhen === 'not_responded');
}

function advancePendingFrame(
  _state: GameState,
  frame: ResolutionFrame,
  actions: Action[],
): CriterionResult {
  const nextCursor = (frame.cursor + 1) % frame.participants.length;
  return {
    status: 'pending',
    frame: { ...frame, cursor: nextCursor },
    actions,
  };
}

function isLastParticipant(frame: ResolutionFrame): boolean {
  return frame.cursor >= frame.participants.length - 1;
}
