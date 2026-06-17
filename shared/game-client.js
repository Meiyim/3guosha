// Shared game client logic — runs in both browser (via <script>) and Node (via import)
// No DOM, no Node-specific APIs. Pure state machine + helpers.

var GameClient = (function() {

const PHASE_NAMES = { prepare:'准备',judge:'判定',draw:'摸牌',play:'出牌',discard:'弃牌',end:'结束' };
const SUIT_SYMBOLS = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
const KINGDOMS = { shu: '蜀', wei: '魏', wu: '吴', qun: '群' };

function createGameClient() {
  const state = {
    screen: 'lobby',
    myId: null,
    myHand: [],
    playableUids: [],
    legalActions: [],
    pin: null,
    heroes: null,
    gameState: null,
    selectedCards: [],
    selectedTargetIds: [],
    logs: [],
    error: null,
    winner: null,
    selectedHeroId: null,
  };

  let onChange = null;

  function handleMessage(msg) {
    state.error = null;
    switch (msg.type) {
      case 'room_created':
        state.pin = msg.pin;
        state.screen = 'waiting';
        break;
      case 'room_joined':
        if (msg.pin) state.pin = msg.pin;
        if (msg.players && msg.players.length < 2) state.screen = 'waiting';
        break;
      case 'hero_selection':
        state.heroes = msg.heroes;
        if (msg.selectedHeroId) state.selectedHeroId = msg.selectedHeroId;
        state.screen = 'hero_select';
        break;
      case 'hero_selected':
        state.selectedHeroId = msg.heroId;
        break;
      case 'game_update':
        state.gameState = msg.state;
        state.screen = 'game';
        break;
      case 'private_update':
        state.myId = msg.state.myId;
        state.myHand = msg.state.myHand;
        state.playableUids = msg.state.playableUids || [];
        state.legalActions = msg.state.legalActions || [];
        state.selectedCards = state.selectedCards.filter(
          uid => msg.state.myHand.some(c => c.uid === uid)
        );
        state.selectedTargetIds = state.selectedTargetIds.filter(
          id => state.gameState?.players.some(p => p.id === id && p.alive)
        );
        if (state.gameState) state.screen = 'game';
        break;
      case 'log':
        state.logs.push(msg.msg);
        break;
      case 'game_over':
        state.winner = msg.winner;
        state.screen = 'gameover';
        break;
      case 'error':
        state.error = msg.msg;
        break;
      case 'room_left':
        resetLocalState();
        break;
      case 'room_closed':
        resetLocalState();
        state.error = msg.msg || '房间已关闭';
        break;
    }
    if (onChange) onChange(state, msg);
  }

  function resetLocalState(screen) {
    state.screen = screen || 'lobby';
    state.myId = null;
    state.myHand = [];
    state.playableUids = [];
    state.legalActions = [];
    state.pin = null;
    state.heroes = null;
    state.gameState = null;
    state.selectedCards = [];
    state.selectedTargetIds = [];
    state.logs = [];
    state.winner = null;
    state.selectedHeroId = null;
  }

  function toggleCard(uid) {
    const idx = state.selectedCards.indexOf(uid);
    if (idx >= 0) state.selectedCards.splice(idx, 1);
    else state.selectedCards.push(uid);
    state.selectedTargetIds = [];
    if (onChange) onChange(state, null);
  }

  function selectTarget(playerId) {
    if (!state.selectedCards.length) return;
    const maxTargets = getTargetLimitForSelectedCard();
    if (maxTargets <= 0) return;

    const idx = state.selectedTargetIds.indexOf(playerId);
    if (idx >= 0) state.selectedTargetIds.splice(idx, 1);
    else if (maxTargets === 1) state.selectedTargetIds = [playerId];
    else if (state.selectedTargetIds.length < maxTargets) state.selectedTargetIds.push(playerId);
    if (onChange) onChange(state, null);
  }

  function clearSelection() { state.selectedCards = []; state.selectedTargetIds = []; }

  function getAvailableActions() {
    const gs = state.gameState;
    if (!gs) return [];
    const actions = [];
    const waiting = gs.waitingFor;
    const isMyTurn = gs.players[gs.currentPlayerIdx].id === state.myId;

    if (waiting && waiting.playerId === state.myId) {
      if (waiting.type === 'discard') {
        actions.push({ id: 'discard', label: '弃牌 (需弃' + waiting.data.count + '张)' });
      } else if (waiting.type === 'respond_rescue') {
        actions.push({ id: 'respond', label: '使用桃救援' });
        actions.push({ id: 'pass', label: '不救援' });
      } else {
        actions.push({ id: 'respond', label: '出牌响应' });
        actions.push({ id: 'pass', label: '放弃' });
      }
    } else if (isMyTurn && gs.phase === 'play') {
      actions.push({ id: 'play', label: '出牌' });
      const me = gs.players.find(p => p.id === state.myId);
      if (me && me.heroId === 'sunquan' && state.selectedCards.length > 0) {
        actions.push({ id: 'zhiheng', label: '制衡' });
      }
      actions.push({ id: 'end_play', label: '结束出牌' });
    }
    return actions;
  }

  function buildCommand(actionId) {
    const gs = state.gameState;
    if (!gs) return null;
    switch (actionId) {
      case 'play':
        if (state.selectedCards.length === 1) {
          const legalForCard = state.legalActions.filter(a => a.type === 'play_card' && a.cardUid === state.selectedCards[0]);
          const legal = requiresTargetSelection(legalForCard)
            ? legalForCard.find(a => sameTargetSet(getActionTargets(a), state.selectedTargetIds))
            : legalForCard[0];
          return legal ? { type: 'play_card', cardUid: legal.cardUid, targetId: legal.targetId, targetIds: legal.targetIds } : null;
        }
        return null;
      case 'respond':
        return { type: 'respond', cardUid: state.selectedCards[0] || null };
      case 'pass':
        return { type: 'respond', cardUid: null };
      case 'discard':
        return { type: 'discard_cards', cardUids: state.selectedCards.slice() };
      case 'end_play':
        return { type: 'end_play' };
      case 'zhiheng':
        return { type: 'zhiheng', cardUids: state.selectedCards.slice() };
      default: return null;
    }
  }

  function getMyPlayer() { return state.gameState ? state.gameState.players.find(p => p.id === state.myId) : null; }
  function getOpponent() { return state.gameState ? state.gameState.players.find(p => p.id !== state.myId) : null; }
  function getOpponents() { return state.gameState ? state.gameState.players.filter(p => p.id !== state.myId) : []; }
  function isMyTurn() { return state.gameState ? state.gameState.players[state.gameState.currentPlayerIdx].id === state.myId : false; }
  function getSelectedTargetNames() {
    if (!state.gameState) return [];
    return state.selectedTargetIds
      .map(id => state.gameState.players.find(p => p.id === id)?.name)
      .filter(Boolean);
  }
  function getTargetLimitForSelectedCard() {
    if (state.selectedCards.length !== 1) return 0;
    const legalForCard = state.legalActions.filter(a => a.type === 'play_card' && a.cardUid === state.selectedCards[0]);
    if (!requiresTargetSelection(legalForCard)) return 0;
    return Math.max(...legalForCard.map(a => getActionTargets(a).length));
  }
  function requiresTargetSelection(legalForCard) {
    return legalForCard.filter(a => getActionTargets(a).length > 0).length > 1;
  }
  function getActionTargets(action) {
    if (Array.isArray(action.targetIds)) return action.targetIds;
    return action.targetId ? [action.targetId] : [];
  }
  function sameTargetSet(a, b) {
    if (a.length !== b.length) return false;
    const left = [...a].sort();
    const right = [...b].sort();
    return left.every((id, i) => id === right[i]);
  }

  return { state, handleMessage, resetLocalState, toggleCard, selectTarget, clearSelection, getAvailableActions, buildCommand, getMyPlayer, getOpponent, getOpponents, getSelectedTargetNames, getTargetLimitForSelectedCard, isMyTurn, setOnChange(fn) { onChange = fn; } };
}

function suitSymbol(suit) { return SUIT_SYMBOLS[suit] || suit; }
function formatCard(card) { return card.def.nameCn + ' ' + suitSymbol(card.def.suit) + card.def.number; }
function formatEquip(eq) { if (!eq || Object.keys(eq).length === 0) return ''; return Object.values(eq).map(c => c.nameCn).join(' | '); }
function hpText(hp, max) { return '❤'.repeat(hp) + '○'.repeat(max - hp); }
function phaseName(phase) { return PHASE_NAMES[phase] || phase; }
function kingdomName(k) { return KINGDOMS[k] || k; }

return { createGameClient, suitSymbol, formatCard, formatEquip, hpText, phaseName, kingdomName, PHASE_NAMES, SUIT_SYMBOLS, KINGDOMS };
})();

if (typeof module !== 'undefined') module.exports = GameClient;
