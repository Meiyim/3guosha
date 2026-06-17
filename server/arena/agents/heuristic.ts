import type { AgentAdapter } from './types.ts';
import type { CardInstance, LegalAction, PlayerObservation } from '../../game/types.ts';

export function createHeuristicAgent(id = 'heuristic-baseline', name = 'Heuristic Baseline'): AgentAdapter {
  return {
    id,
    name,
    act(observation) {
      return chooseHeuristicAction(observation);
    },
  };
}

export function chooseHeuristicAction(observation: PlayerObservation): LegalAction | null {
  const { publicState, privateState, legalActions } = observation;
  if (legalActions.length === 0) return null;

  const waiting = publicState.waitingFor;
  if (waiting?.playerId === privateState.myId) {
    if (waiting.type === 'discard') return legalActions.find(a => a.type === 'discard_cards') || null;
    if (waiting.type === 'respond_rescue') {
      const shouldSaveSelf = waiting.data?.dyingPlayerId === privateState.myId;
      return shouldSaveSelf
        ? findResponse(legalActions, 'tao') || passAction(legalActions)
        : passAction(legalActions);
    }

    const needShan = waiting.data?.needShan || waiting.type === 'respond_attack';
    return findResponse(legalActions, needShan ? 'shan' : 'sha') || passAction(legalActions);
  }

  const me = publicState.players.find(p => p.id === privateState.myId);
  const playable = legalActions.filter((a): a is Extract<LegalAction, { type: 'play_card' }> => a.type === 'play_card');
  const handByUid = new Map<number, CardInstance>(privateState.myHand.map(card => [card.uid, card]));
  const cardId = (action: Extract<LegalAction, { type: 'play_card' }>) => action.cardId || handByUid.get(action.cardUid)?.def.id;
  const usefulEquipment = (action: Extract<LegalAction, { type: 'play_card' }>) => {
    const card = handByUid.get(action.cardUid);
    return card?.def.id === 'zhuge' || card?.def.id === 'minus_horse';
  };

  return (
    (me && me.hp <= 1 ? playable.find(a => cardId(a) === 'tao') : undefined) ||
    playable.find(a => cardId(a) === 'wuzhong') ||
    playable.find(a => cardId(a) === 'sha') ||
    playable.find(a => cardId(a) === 'juedou' || cardId(a) === 'nanman' || cardId(a) === 'wanjian') ||
    playable.find(usefulEquipment) ||
    (me && me.hp < me.maxHp ? playable.find(a => cardId(a) === 'tao') : undefined) ||
    legalActions.find(a => a.type === 'end_play') ||
    null
  );
}

function findResponse(actions: LegalAction[], cardId: string): LegalAction | undefined {
  return actions.find(a => a.type === 'respond' && a.cardId === cardId);
}

function passAction(actions: LegalAction[]): LegalAction | null {
  return actions.find(a => a.type === 'respond' && a.cardUid === null) || null;
}
