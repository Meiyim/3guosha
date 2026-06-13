(function() {
  const GC = window.GameClient;
  const client = GC.createGameClient();
  let ws = null;

  const $ = id => document.getElementById(id);
  const screens = ['lobby', 'waiting', 'hero-select', 'game', 'gameover'];
  function showScreen(id) {
    screens.forEach(s => $(s).classList.remove('active'));
    $(id).classList.add('active');
  }

  function connect() {
    ws = new WebSocket(`ws://${location.host}`);
    ws.onopen = () => { $('lobby-status').textContent = ''; };
    ws.onclose = () => { $('lobby-status').textContent = '连接断开，重连中...'; setTimeout(connect, 2000); };
    ws.onerror = () => {};
    ws.onmessage = (e) => client.handleMessage(JSON.parse(e.data));
  }

  function send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

  function doAction(actionId) {
    const cmd = client.buildCommand(actionId);
    if (cmd) { send(cmd); client.clearSelection(); }
  }

  client.setOnChange((state, msg) => {
    if (state.error) $('lobby-status').textContent = state.error;
    switch (state.screen) {
      case 'waiting':
        $('room-pin').textContent = state.pin;
        showScreen('waiting');
        break;
      case 'hero_select':
        renderHeroes(state.heroes);
        showScreen('hero-select');
        break;
      case 'game':
        renderGame(state);
        showScreen('game');
        break;
      case 'gameover':
        $('gameover-msg').textContent = state.winner + ' 获胜!';
        showScreen('gameover');
        break;
    }
    if (msg && msg.type === 'log') appendLog(msg.msg);
  });

  $('btn-join').onclick = () => {
    const pin = $('pin-input').value.trim();
    if (pin.length !== 4) { $('lobby-status').textContent = '请输入4位PIN'; return; }
    send({ type: 'join_room', pin, name: $('join-name').value.trim() || '玩家' });
  };

  connect();

  function renderHeroes(heroes) {
    const grid = $('hero-grid');
    grid.innerHTML = '';
    heroes.forEach(h => {
      const div = document.createElement('div');
      div.className = 'hero-card';
      div.innerHTML = `<div class="hero-name">${h.nameCn}</div><div class="hero-kingdom">${GC.kingdomName(h.kingdom)}</div><div class="hero-hp">${'❤'.repeat(h.maxHp)}</div>`;
      div.onclick = () => send({ type: 'select_hero', heroId: h.id });
      grid.appendChild(div);
    });
  }

  function renderGame(state) {
    const gs = state.gameState;
    const me = client.getMyPlayer();
    const opp = client.getOpponent();
    const myTurn = client.isMyTurn();

    // Opponent
    $('opponent-area').innerHTML = `<div class="player-panel" style="${!myTurn?'border-left:3px solid #e94560;padding-left:8px':''}">
      <div class="p-name">${opp.name} ${!myTurn?'⟵ 当前回合':''}</div>
      <div class="p-hero">${opp.heroId} | 手牌: ${opp.handCount}</div>
      <div class="hp-bar">${hpPips(opp.hp, opp.maxHp)}</div>
      <div class="equip-list">${GC.formatEquip(opp.equipment)}</div>
    </div>`;

    // Info
    $('deck-info').textContent = '牌堆: ' + gs.deckCount + '张';
    $('phase-info').textContent = '第' + gs.turnNumber + '回合 | 阶段: ' + GC.phaseName(gs.phase);

    // My area
    $('my-info').innerHTML = `<div class="player-panel" style="${myTurn?'border-left:3px solid #e94560;padding-left:8px':''}">
      <div class="p-name">${me.name} ${myTurn?'⟵ 你的回合':''}</div>
      <div class="p-hero">${me.heroId}</div>
      <div class="hp-bar">${hpPips(me.hp, me.maxHp)}</div>
      <div class="equip-list">${GC.formatEquip(me.equipment)}</div>
    </div>`;

    // Hand
    const hand = $('my-hand');
    hand.innerHTML = '';
    state.myHand.forEach(card => {
      const div = document.createElement('div');
      const isRed = card.def.suit === 'heart' || card.def.suit === 'diamond';
      div.className = `card ${isRed?'red':'black'} ${state.selectedCards.includes(card.uid)?'selected':''}`;
      div.innerHTML = `<div class="card-name">${card.def.nameCn}</div><div class="card-suit">${GC.suitSymbol(card.def.suit)} ${card.def.number}</div>`;
      div.onclick = () => { client.toggleCard(card.uid); renderGame(client.state); renderActions(); };
      hand.appendChild(div);
    });

    renderActions();
  }

  function renderActions() {
    const btns = $('action-buttons');
    btns.innerHTML = '';
    const actions = client.getAvailableActions();
    actions.forEach((a, i) => {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.id === 'end_play' || a.id === 'pass') b.className = 'secondary';
      b.onclick = () => doAction(a.id);
      btns.appendChild(b);
    });
  }

  function appendLog(msg) {
    const log = $('game-log');
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent = msg;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function hpPips(hp, max) { let s=''; for(let i=0;i<max;i++) s+=`<div class="hp-pip ${i<hp?'':'lost'}"></div>`; return s; }
})();
