(function() {
  const GC = window.GameClient;
  const client = GC.createGameClient();
  let ws = null;
  let token = null;
  let pollTimer = null;
  const params = new URLSearchParams(location.search);
  const devMode = params.get('dev') === '1';
  const devPlayers = Math.max(2, Math.min(8, Number(params.get('players') || params.get('bots')) || 2));
  const devAgent = params.get('agent') === 'llm' ? 'llm' : 'heuristic';
  let layoutRaf = null;

  const $ = id => document.getElementById(id);
  const screens = ['lobby', 'waiting', 'hero-select', 'game', 'gameover'];
  function showScreen(id) {
    screens.forEach(s => $(s).classList.remove('active'));
    $(id).classList.add('active');
  }

  async function connect() {
    try {
      const res = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'connect' })
      });
      const data = await res.json();
      token = data.token;
      $('lobby-status').textContent = '';
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(poll, 300);
      poll();
      if (devMode && client.state.screen === 'lobby') {
        send({ type: 'start_dev_game', name: '开发者', playerCount: devPlayers, agent: devAgent });
      }
    } catch (e) {
      $('lobby-status').textContent = '连接断开，重连中...';
      setTimeout(connect, 2000);
    }
  }

  async function poll() {
    if (!token) return;
    try {
      const res = await fetch('/api/poll?token=' + encodeURIComponent(token));
      if (res.status === 404) {
        token = null;
        connect();
        return;
      }
      const data = await res.json();
      (data.messages || []).forEach(msg => client.handleMessage(msg));
    } catch (e) {
      $('lobby-status').textContent = '连接断开，重连中...';
    }
  }

  async function send(obj) {
    if (!token) return;
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...obj, token })
    });
    if (res.status === 404) {
      token = null;
      connect();
      return;
    }
    poll();
  }

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
        if (!state.myId) break;
        renderGame(state);
        showScreen('game');
        break;
      case 'gameover':
        $('gameover-msg').textContent = state.winner + ' 获胜!';
        showScreen('gameover');
        break;
    }
    if (msg && msg.type === 'log') appendLog(msg.msg);
    scheduleLayout();
  });

  $('btn-join').onclick = () => {
    const pin = $('pin-input').value.trim();
    if (pin.length !== 4) { $('lobby-status').textContent = '请输入4位PIN'; return; }
    send({ type: 'join_room', pin, name: $('join-name').value.trim() || '玩家' });
  };
  $('btn-dev-bot').onclick = () => send({ type: 'start_dev_game', name: $('join-name').value.trim() || '开发者', playerCount: 2, agent: devAgent });
  $('btn-leave-game').onclick = () => {
    client.clearSelection();
    if (devMode) {
      client.resetLocalState('lobby');
      $('game-log').innerHTML = '';
      send({ type: 'start_dev_game', name: '开发者', playerCount: devPlayers, agent: devAgent });
    } else {
      send({ type: 'leave_game' });
      client.resetLocalState('lobby');
      showScreen('lobby');
    }
  };

  connect();

  function renderHeroes(heroes) {
    const grid = $('hero-grid');
    grid.innerHTML = '';
    heroes.forEach(h => {
      const div = document.createElement('div');
      div.className = `hero-card ${client.state.selectedHeroId === h.id ? 'selected' : ''}`;
      div.innerHTML = `<div class="hero-name">${h.nameCn}</div><div class="hero-kingdom">${GC.kingdomName(h.kingdom)}</div><div class="hero-hp">${'❤'.repeat(h.maxHp)}</div>`;
      div.onclick = () => send({ type: 'select_hero', heroId: h.id });
      grid.appendChild(div);
    });
    if (client.state.selectedHeroId) {
      const hint = document.createElement('div');
      hint.className = 'selection-hint';
      hint.textContent = '已选择，等待对手';
      grid.appendChild(hint);
    }
  }

  function renderGame(state) {
    const gs = state.gameState;
    const me = client.getMyPlayer();
    const opponents = client.getOpponents();
    if (!gs || !me || opponents.length === 0) return;
    const myTurn = client.isMyTurn();
    const waiting = gs.waitingFor;
    const waitingForMe = waiting && waiting.playerId === state.myId;
    const statusText = waitingForMe ? '等待你响应' : waiting ? '等待对手响应' : myTurn ? '你的出牌阶段' : '对手回合';

    const opponentArea = $('opponent-area');
    opponentArea.className = opponents.length > 1 ? `seat-ring seat-count-${Math.min(opponents.length, 7)}` : '';
    opponentArea.innerHTML = opponents.map((opp, index) => `<div class="player-panel opponent seat-${index + 1} ${gs.players[gs.currentPlayerIdx].id === opp.id ? 'active-turn' : ''} ${state.selectedTargetIds.includes(opp.id) ? 'selected-target' : ''} ${opp.alive ? '' : 'dead'}" data-player-id="${opp.id}">
      <div class="avatar-seal">${heroInitial(opp.heroId)}</div>
      <div class="player-main">
        <div class="p-name">${opp.name}</div>
        <div class="p-hero">${heroName(opp.heroId)} · 手牌 ${opp.handCount}</div>
        <div class="hp-bar">${hpPips(opp.hp, opp.maxHp)}</div>
        <div class="equip-list">${GC.formatEquip(opp.equipment) || '无装备'}</div>
      </div>
    </div>`).join('');
    opponentArea.querySelectorAll('.player-panel.opponent').forEach(panel => {
      panel.onclick = () => {
        if (!panel.classList.contains('dead')) client.selectTarget(panel.dataset.playerId);
      };
    });

    $('deck-info').innerHTML = `<span>牌堆</span><strong>${gs.deckCount}</strong><span>张</span>`;
    $('phase-info').innerHTML = `<span>第 ${gs.turnNumber} 回合</span><strong>${GC.phaseName(gs.phase)}</strong><em>${statusText}</em>`;
    $('btn-leave-game').textContent = devMode ? '重开' : '退出';
    $('btn-leave-game').title = devMode ? '重开当前开发者对局' : '退出当前房间';

    $('my-info').innerHTML = `<div class="player-panel self ${myTurn ? 'active-turn' : ''}">
      <div class="avatar-seal">${heroInitial(me.heroId)}</div>
      <div class="player-main">
        <div class="p-name">${me.name}</div>
        <div class="p-hero">${heroName(me.heroId)}</div>
        <div class="hp-bar">${hpPips(me.hp, me.maxHp)}</div>
        <div class="equip-list">${GC.formatEquip(me.equipment) || '无装备'}</div>
      </div>
    </div>`;

    const hand = $('my-hand');
    hand.innerHTML = '';
    state.myHand.forEach(card => {
      const div = document.createElement('div');
      const isRed = card.def.suit === 'heart' || card.def.suit === 'diamond';
      const playable = state.playableUids.includes(card.uid);
      div.className = `card ${isRed?'red':'black'} ${playable?'playable':''} ${state.selectedCards.includes(card.uid)?'selected':''}`;
      div.innerHTML = `<div class="card-corner">${GC.suitSymbol(card.def.suit)} ${card.def.number}</div><div class="card-name">${card.def.nameCn}</div><div class="card-type">${cardTypeName(card.def.type)}</div>`;
      div.onclick = () => { client.toggleCard(card.uid); renderGame(client.state); renderActions(); };
      hand.appendChild(div);
    });

    renderActions();
    scheduleLayout();
  }

  function renderActions() {
    const btns = $('action-buttons');
    btns.innerHTML = '';
    const actions = client.getAvailableActions();
    actions.forEach((a, i) => {
      const b = document.createElement('button');
      b.textContent = a.id === 'play' ? playLabel(a.label) : a.label;
      if (a.id === 'end_play' || a.id === 'pass') b.className = 'secondary';
      b.onclick = () => doAction(a.id);
      btns.appendChild(b);
    });
  }

  function playLabel(label) {
    if (client.state.selectedCards.length !== 1) return label;
    const legalForCard = client.state.legalActions.filter(a => a.type === 'play_card' && a.cardUid === client.state.selectedCards[0]);
    const targeted = legalForCard.filter(a => a.targetId);
    if (targeted.length <= 1) return label;
    const targetNames = client.getSelectedTargetNames();
    return targetNames.length ? `${label} → ${targetNames.join('、')}` : '选择目标';
  }

  function appendLog(msg) {
    const log = $('game-log');
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent = msg;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    scheduleLayout();
  }

  function hpPips(hp, max) { let s=''; for(let i=0;i<max;i++) s+=`<div class="hp-pip ${i<hp?'':'lost'}"></div>`; return s; }
  function heroName(id) {
    const map = { caocao: '曹操', zhenji: '甄姬', liubei: '刘备', guanyu: '关羽', sunquan: '孙权' };
    return map[id] || id;
  }
  function heroInitial(id) { return heroName(id).slice(0, 1); }
  function cardTypeName(type) {
    return ({ basic: '基本', trick: '锦囊', equipment: '装备' })[type] || type;
  }
  function scheduleLayout() {
    if (layoutRaf) cancelAnimationFrame(layoutRaf);
    layoutRaf = requestAnimationFrame(adjustGameLayout);
  }
  function adjustGameLayout() {
    layoutRaf = null;
    const game = $('game');
    if (!game.classList.contains('active')) return;
    const opponent = $('opponent-area');
    const info = $('game-info');
    const command = $('my-command-row');
    const hand = $('my-hand');
    const gap = 10;
    const padding = window.innerWidth <= 760 ? 8 : 14;
    const handMax = Math.max(108, Math.min(210, window.innerHeight * 0.26));
    const opponentCount = client.getOpponents().length;
    const opponentMax = Math.max(136, Math.min(window.innerWidth <= 760 ? 174 : 230, window.innerHeight * (opponentCount > 1 ? 0.27 : 0.3)));
    const myAreaHeight = command.offsetHeight + Math.min(hand.scrollHeight || handMax, handMax) + gap;
    const fixed = opponentMax + info.offsetHeight + myAreaHeight + padding * 2 + gap * 3;
    const logMax = Math.max(96, window.innerHeight - fixed);
    game.style.setProperty('--opponent-max-height', `${opponentMax}px`);
    game.style.setProperty('--hand-max-height', `${handMax}px`);
    game.style.setProperty('--log-max-height', `${logMax}px`);
  }
  window.addEventListener('resize', scheduleLayout);
})();
