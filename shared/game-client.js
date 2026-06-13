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
    pin: null,
    heroes: null,
    gameState: null,
    selectedCards: [],
    logs: [],
    error: null,
    winner: null,
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
        break;
      case 'hero_selection':
        state.heroes = msg.heroes;
        state.screen = 'hero_select';
        break;
      case 'game_update':
        state.gameState = msg.state;
        state.screen = 'game';
        break;
      case 'private_update':
        state.myId = msg.state.myId;
        state.myHand = msg.state.myHand;
        state.playableUids = msg.state.playableUids || [];
        state.selectedCards = state.selectedCards.filter(
          uid => msg.state.myHand.some(c => c.uid === uid)
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
    }
    if (onChange) onChange(state, msg);
  }

  function toggleCard(uid) {
    const idx = state.selectedCards.indexOf(uid);
    if (idx >= 0) state.selectedCards.splice(idx, 1);
    else state.selectedCards.push(uid);
    if (onChange) onChange(state, null);
  }

  function clearSelection() { state.selectedCards = []; }

  function getAvailableActions() {
    const gs = state.gameState;
    if (!gs) return [];
    const actions = [];
    const waiting = gs.waitingFor;
    const isMyTurn = gs.players[gs.currentPlayerIdx].id === state.myId;

    if (waiting && waiting.playerId === state.myId) {
      if (waiting.type === 'discard') {
        actions.push({ id: 'discard', label: '弃牌 (需弃' + waiting.data.count + '张)' });
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
    const opp = gs.players.find(p => p.id !== state.myId);
    switch (actionId) {
      case 'play':
        if (state.selectedCards.length === 1)
          return { type: 'play_card', cardUid: state.selectedCards[0], targetId: opp ? opp.id : undefined };
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
  function isMyTurn() { return state.gameState ? state.gameState.players[state.gameState.currentPlayerIdx].id === state.myId : false; }

  return { state, handleMessage, toggleCard, clearSelection, getAvailableActions, buildCommand, getMyPlayer, getOpponent, isMyTurn, setOnChange(fn) { onChange = fn; } };
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
