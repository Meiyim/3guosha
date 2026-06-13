(function() {
  let ws = null;
  let myId = null;
  let gameState = null;
  let selectedCards = [];
  let reconnectTimer = null;

  const $ = id => document.getElementById(id);
  const screens = ['lobby', 'waiting', 'hero-select', 'game', 'gameover'];
  function showScreen(id) {
    screens.forEach(s => $(s).classList.remove('active'));
    $(id).classList.add('active');
  }

  function connect() {
    ws = new WebSocket(`ws://${location.host}`);
    ws.onopen = () => { $('lobby-status').textContent = ''; };
    ws.onclose = () => { $('lobby-status').textContent = '连接断开，重连中...'; reconnectTimer = setTimeout(connect, 2000); };
    ws.onerror = () => {};
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      handleMsg(msg);
    };
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function handleMsg(msg) {
    switch (msg.type) {
      case 'room_created':
        $('room-pin').textContent = msg.pin;
        showScreen('waiting');
        break;
      case 'room_joined':
        break;
      case 'hero_selection':
        renderHeroSelection(msg.heroes);
        showScreen('hero-select');
        break;
      case 'game_update':
        gameState = msg.state;
        myId = msg.state.myId;
        renderGame();
        showScreen('game');
        break;
      case 'log':
        appendLog(msg.msg);
        break;
      case 'game_over':
        $('gameover-msg').textContent = msg.winner + ' 获胜!';
        showScreen('gameover');
        break;
      case 'error':
        $('lobby-status').textContent = msg.msg;
        break;
    }
  }

  // Lobby
  $('btn-create').onclick = () => {
    const name = $('player-name').value.trim() || '玩家';
    send({ type: 'create_room', name });
  };
  $('btn-join').onclick = () => {
    const name = $('player-name').value.trim() || '玩家';
    const pin = $('pin-input').value.trim();
    if (pin.length !== 4) { $('lobby-status').textContent = '请输入4位PIN'; return; }
    send({ type: 'join_room', pin, name });
  };

  connect();

  function renderHeroSelection(heroes) {
    const grid = $('hero-grid');
    grid.innerHTML = '';
    const kingdoms = { shu: '蜀', wei: '魏', wu: '吴', qun: '群' };
    heroes.forEach(h => {
      const div = document.createElement('div');
      div.className = 'hero-card';
      div.innerHTML = `<div class="hero-name">${h.nameCn}</div><div class="hero-kingdom">${kingdoms[h.kingdom]}</div><div class="hero-hp">${'❤'.repeat(h.maxHp)}</div>`;
      div.onclick = () => send({ type: 'select_hero', heroId: h.id });
      grid.appendChild(div);
    });
  }

  function renderGame() {
    if (!gameState) return;
    selectedCards = selectedCards.filter(uid => gameState.myHand.some(c => c.uid === uid));
    renderOpponent();
    renderInfo();
    renderMyArea();
    renderActions();
  }

  function renderOpponent() {
    const area = $('opponent-area');
    const opp = gameState.players.find(p => p.id !== myId);
    if (!opp) return;
    const isCurrent = gameState.players[gameState.currentPlayerIdx].id === opp.id;
    area.innerHTML = `<div class="player-panel" style="${isCurrent ? 'border-left:3px solid #e94560;padding-left:8px' : ''}">
      <div class="p-name">${opp.name} ${isCurrent ? '⟵ 当前回合' : ''}</div>
      <div class="p-hero">${opp.heroId} | 手牌: ${opp.handCount}</div>
      <div class="hp-bar">${hpPips(opp.hp, opp.maxHp)}</div>
      <div class="equip-list">${formatEquip(opp.equipment)}</div>
    </div>`;
  }

  function renderInfo() {
    const phaseNames = { prepare:'准备',judge:'判定',draw:'摸牌',play:'出牌',discard:'弃牌',end:'结束' };
    $('deck-info').textContent = `牌堆: ${gameState.deckCount}张`;
    $('phase-info').textContent = `第${gameState.turnNumber}回合 | 阶段: ${phaseNames[gameState.phase] || gameState.phase}`;
  }

  function renderMyArea() {
    const me = gameState.players.find(p => p.id === myId);
    const isCurrent = gameState.players[gameState.currentPlayerIdx].id === myId;
    $('my-info').innerHTML = `<div class="player-panel" style="${isCurrent ? 'border-left:3px solid #e94560;padding-left:8px' : ''}">
      <div class="p-name">${me.name} ${isCurrent ? '⟵ 你的回合' : ''}</div>
      <div class="p-hero">${me.heroId}</div>
      <div class="hp-bar">${hpPips(me.hp, me.maxHp)}</div>
      <div class="equip-list">${formatEquip(me.equipment)}</div>
    </div>`;

    const hand = $('my-hand');
    hand.innerHTML = '';
    gameState.myHand.forEach(card => {
      const div = document.createElement('div');
      const isRed = card.def.suit === 'heart' || card.def.suit === 'diamond';
      div.className = `card ${isRed ? 'red' : 'black'} ${selectedCards.includes(card.uid) ? 'selected' : ''}`;
      div.innerHTML = `<div class="card-name">${card.def.nameCn}</div><div class="card-suit">${suitSymbol(card.def.suit)} ${card.def.number}</div>`;
      div.onclick = () => toggleCard(card.uid);
      hand.appendChild(div);
    });
  }

  function renderActions() {
    const btns = $('action-buttons');
    btns.innerHTML = '';
    const isMyTurn = gameState.players[gameState.currentPlayerIdx].id === myId;
    const waiting = gameState.waitingFor;

    if (waiting && waiting.playerId === myId) {
      if (waiting.type === 'discard') {
        btns.appendChild(mkBtn(`弃牌 (需弃${waiting.data.count}张)`, () => {
          if (selectedCards.length === waiting.data.count) { send({ type: 'discard_cards', cardUids: selectedCards }); selectedCards = []; }
        }));
      } else {
        btns.appendChild(mkBtn('出牌响应', () => { send({ type: 'respond', cardUid: selectedCards[0] || null }); selectedCards = []; }));
        btns.appendChild(mkBtn('放弃', () => { send({ type: 'respond', cardUid: null }); selectedCards = []; }, 'secondary'));
      }
      return;
    }

    if (isMyTurn && gameState.phase === 'play') {
      btns.appendChild(mkBtn('出牌', () => {
        if (selectedCards.length === 1) {
          const opp = gameState.players.find(p => p.id !== myId);
          send({ type: 'play_card', cardUid: selectedCards[0], targetId: opp?.id });
          selectedCards = [];
        }
      }));
      const me = gameState.players.find(p => p.id === myId);
      if (me?.heroId === 'sunquan' && selectedCards.length > 0) {
        btns.appendChild(mkBtn('制衡', () => { send({ type: 'zhiheng', cardUids: selectedCards }); selectedCards = []; }));
      }
      btns.appendChild(mkBtn('结束出牌', () => { send({ type: 'end_play' }); selectedCards = []; }, 'secondary'));
    }
  }

  function toggleCard(uid) {
    const idx = selectedCards.indexOf(uid);
    if (idx >= 0) selectedCards.splice(idx, 1); else selectedCards.push(uid);
    renderGame();
  }

  function appendLog(msg) {
    const log = $('game-log');
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent = msg;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function hpPips(hp, max) { let s = ''; for (let i = 0; i < max; i++) s += `<div class="hp-pip ${i < hp ? '' : 'lost'}"></div>`; return s; }
  function suitSymbol(suit) { return { spade: '♠', heart: '♥', club: '♣', diamond: '♦' }[suit] || suit; }
  function formatEquip(eq) { if (!eq || Object.keys(eq).length === 0) return ''; return Object.values(eq).map(c => c.nameCn).join(' | '); }
  function mkBtn(text, onclick, cls) { const b = document.createElement('button'); b.textContent = text; b.onclick = onclick; if (cls) b.className = cls; return b; }
})();
