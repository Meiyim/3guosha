import { buildDeck, shuffleDeck } from './cards.ts';
import { HEROES } from './heroes.ts';
import type { GameState, PlayerState, CardInstance, WaitingAction } from './types.ts';

export class Game {
  state: GameState;
  logs: string[] = [];

  constructor(players: { id: string; name: string; heroId: string }[]) {
    const deck = buildDeck();
    shuffleDeck(deck);
    this.state = {
      players: players.map(p => {
        const hero = HEROES.find(h => h.id === p.heroId);
        return {
          id: p.id, name: p.name, heroId: p.heroId,
          hp: hero.maxHp, maxHp: hero.maxHp,
          hand: [], equipment: {}, alive: true, attackCount: 0,
        };
      }),
      currentPlayerIdx: 0, phase: 'draw',
      deck, discard: [], turnNumber: 1, waitingFor: null, winner: null,
    };
    for (const p of this.state.players) this.drawCards(p, 4);
  }

  get currentPlayer() { return this.state.players[this.state.currentPlayerIdx]; }

  drawCards(player, count) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
      if (this.state.deck.length === 0) {
        this.state.deck = this.state.discard.splice(0);
        shuffleDeck(this.state.deck);
        if (this.state.deck.length === 0) break;
      }
      const card = this.state.deck.pop();
      player.hand.push(card);
      drawn.push(card);
    }
    return drawn;
  }

  startTurn() {
    const p = this.currentPlayer;
    p.attackCount = 0;
    this.state.phase = 'draw';
    this.log(`${p.name} 的回合开始`);
    if (this.hasSkill(p, 'luoshen')) this.executeLuoshen(p);
    this.drawCards(p, 2);
    this.state.phase = 'play';
  }

  playCard(playerId, cardUid, targetId) {
    const player = this.getPlayer(playerId);
    if (!player || this.state.phase !== 'play' || this.currentPlayer.id !== playerId) return null;
    const cardIdx = player.hand.findIndex(c => c.uid === cardUid);
    if (cardIdx === -1) return null;
    const card = player.hand[cardIdx];

    if (card.def.id !== 'sha' && this.hasSkill(player, 'wusheng') &&
        (card.def.suit === 'heart' || card.def.suit === 'diamond') && card.def.type !== 'equipment') {
      return this.resolveAttack(player, card, cardIdx, targetId);
    }

    switch (card.def.id) {
      case 'sha': return this.resolveAttack(player, card, cardIdx, targetId);
      case 'tao': return this.resolvePeach(player, card, cardIdx);
      case 'juedou': return this.resolveDuel(player, card, cardIdx, targetId);
      case 'nanman': return this.resolveBarbarian(player, card, cardIdx);
      case 'wanjian': return this.resolveArrowBarrage(player, card, cardIdx);
      case 'wuzhong': return this.resolveWuzhong(player, card, cardIdx);
      case 'zhuge': case 'plus_horse': case 'minus_horse':
        return this.resolveEquip(player, card, cardIdx);
      default: return null;
    }
  }

  respond(playerId, cardUid) {
    const waiting = this.state.waitingFor;
    if (!waiting || waiting.playerId !== playerId) return null;
    const player = this.getPlayer(playerId);
    if (!player) return null;
    this.state.waitingFor = null;

    if (waiting.type === 'respond_attack') {
      if (cardUid !== null) {
        const idx = player.hand.findIndex(c => c.uid === cardUid);
        if (idx !== -1 && player.hand[idx].def.id === 'shan') {
          this.useCard(player, idx);
          this.log(`${player.name} 使用了闪`);
          return null;
        }
      }
      this.dealDamage(player, 1, waiting.data?.source);
      return null;
    }

    if (waiting.type === 'respond_duel') {
      if (cardUid !== null) {
        const idx = player.hand.findIndex(c => c.uid === cardUid);
        if (idx !== -1 && this.isValidAttackResponse(player, player.hand[idx])) {
          this.useCard(player, idx);
          this.log(`${player.name} 出杀`);
          const opponent = this.getPlayer(waiting.data.opponent);
          this.state.waitingFor = {
            playerId: opponent.id, type: 'respond_duel',
            data: { opponent: player.id, source: waiting.data.source },
          };
          return this.state.waitingFor;
        }
      }
      this.dealDamage(player, 1, waiting.data?.source);
      return null;
    }

    if (waiting.type === 'respond_barbarian') {
      if (cardUid !== null) {
        const idx = player.hand.findIndex(c => c.uid === cardUid);
        const needShan = waiting.data?.needShan;
        if (idx !== -1) {
          const card = player.hand[idx];
          const valid = needShan ? card.def.id === 'shan' : this.isValidAttackResponse(player, card);
          if (valid) {
            this.useCard(player, idx);
            this.log(`${player.name} 响应成功`);
          } else {
            this.dealDamage(player, 1, waiting.data?.source);
          }
        } else {
          this.dealDamage(player, 1, waiting.data?.source);
        }
      } else {
        this.dealDamage(player, 1, waiting.data?.source);
      }
      const nextTarget = this.getNextBarbarianTarget(player.id, waiting.data.remaining);
      if (nextTarget) {
        this.state.waitingFor = {
          playerId: nextTarget, type: 'respond_barbarian',
          data: { ...waiting.data, remaining: waiting.data.remaining.filter(id => id !== nextTarget) },
        };
        return this.state.waitingFor;
      }
      return null;
    }
    return null;
  }

  endPlay(playerId) {
    if (this.currentPlayer.id !== playerId || this.state.phase !== 'play') return;
    this.state.phase = 'discard';
    const p = this.currentPlayer;
    const excess = p.hand.length - p.hp;
    if (excess <= 0) this.endTurn();
    else this.state.waitingFor = { playerId: p.id, type: 'discard', data: { count: excess } };
  }

  discardCards(playerId, cardUids) {
    const player = this.getPlayer(playerId);
    if (!player || this.state.waitingFor?.playerId !== playerId) return;
    for (const uid of cardUids) {
      const idx = player.hand.findIndex(c => c.uid === uid);
      if (idx !== -1) this.state.discard.push(player.hand.splice(idx, 1)[0]);
    }
    this.state.waitingFor = null;
    if (this.state.phase === 'discard') this.endTurn();
  }

  useZhiheng(playerId, cardUids) {
    const player = this.getPlayer(playerId);
    if (!player || this.currentPlayer.id !== playerId || this.state.phase !== 'play') return null;
    if (!this.hasSkill(player, 'zhiheng') || cardUids.length === 0) return null;
    for (const uid of cardUids) {
      const idx = player.hand.findIndex(c => c.uid === uid);
      if (idx !== -1) this.state.discard.push(player.hand.splice(idx, 1)[0]);
    }
    this.drawCards(player, cardUids.length);
    this.log(`${player.name} 发动制衡，弃${cardUids.length}张摸${cardUids.length}张`);
    return null;
  }

  resolveAttack(player, card, cardIdx, targetId) {
    const maxAttacks = player.equipment.weapon?.def.id === 'zhuge' ? 999 : 1;
    if (player.attackCount >= maxAttacks) return null;
    const target = targetId ? this.getPlayer(targetId) : this.getOpponent(player);
    if (!target || !target.alive) return null;
    player.attackCount++;
    this.useCard(player, cardIdx);
    this.log(`${player.name} 对 ${target.name} 使用了杀`);
    this.state.waitingFor = { playerId: target.id, type: 'respond_attack', data: { source: player.id } };
    return this.state.waitingFor;
  }

  resolvePeach(player, card, cardIdx) {
    if (player.hp >= player.maxHp) return null;
    this.useCard(player, cardIdx);
    player.hp = Math.min(player.hp + 1, player.maxHp);
    this.log(`${player.name} 使用桃，回复至${player.hp}点体力`);
    return null;
  }

  resolveDuel(player, card, cardIdx, targetId) {
    const target = targetId ? this.getPlayer(targetId) : this.getOpponent(player);
    if (!target || !target.alive || target.id === player.id) return null;
    this.useCard(player, cardIdx);
    this.log(`${player.name} 对 ${target.name} 使用了决斗`);
    this.state.waitingFor = { playerId: target.id, type: 'respond_duel', data: { opponent: player.id, source: player.id } };
    return this.state.waitingFor;
  }

  resolveBarbarian(player, card, cardIdx) {
    this.useCard(player, cardIdx);
    this.log(`${player.name} 使用了南蛮入侵`);
    const targets = this.state.players.filter(p => p.id !== player.id && p.alive).map(p => p.id);
    if (targets.length === 0) return null;
    this.state.waitingFor = { playerId: targets[0], type: 'respond_barbarian', data: { source: player.id, remaining: targets.slice(1) } };
    return this.state.waitingFor;
  }

  resolveArrowBarrage(player, card, cardIdx) {
    this.useCard(player, cardIdx);
    this.log(`${player.name} 使用了万箭齐发`);
    const targets = this.state.players.filter(p => p.id !== player.id && p.alive).map(p => p.id);
    if (targets.length === 0) return null;
    this.state.waitingFor = { playerId: targets[0], type: 'respond_barbarian', data: { source: player.id, remaining: targets.slice(1), needShan: true } };
    return this.state.waitingFor;
  }

  resolveWuzhong(player, card, cardIdx) {
    this.useCard(player, cardIdx);
    this.drawCards(player, 2);
    this.log(`${player.name} 使用无中生有，摸2张牌`);
    return null;
  }

  resolveEquip(player, card, cardIdx) {
    const slot = card.def.equipSlot;
    if (player.equipment[slot]) this.state.discard.push(player.equipment[slot]);
    player.hand.splice(cardIdx, 1);
    player.equipment[slot] = card;
    this.log(`${player.name} 装备了${card.def.nameCn}`);
    return null;
  }

  dealDamage(target, amount, sourceId) {
    target.hp -= amount;
    this.log(`${target.name} 受到${amount}点伤害，剩余${target.hp}点体力`);
    if (this.hasSkill(target, 'jianxiong') && this.state.discard.length > 0) {
      const taken = this.state.discard.pop();
      target.hand.push(taken);
      this.log(`${target.name} 发动奸雄，获得造成伤害的牌`);
    }
    if (target.hp <= 0) {
      target.alive = false;
      this.log(`${target.name} 阵亡`);
      this.checkWin();
    }
  }

  checkWin() {
    const alive = this.state.players.filter(p => p.alive);
    if (alive.length === 1) {
      this.state.winner = alive[0].id;
      this.log(`${alive[0].name} 获胜!`);
    }
  }

  endTurn() {
    this.state.waitingFor = null;
    let next = (this.state.currentPlayerIdx + 1) % this.state.players.length;
    while (!this.state.players[next].alive) next = (next + 1) % this.state.players.length;
    this.state.currentPlayerIdx = next;
    this.state.turnNumber++;
    this.startTurn();
  }

  useCard(player, cardIdx) { this.state.discard.push(player.hand.splice(cardIdx, 1)[0]); }
  getPlayer(id) { return this.state.players.find(p => p.id === id); }
  getOpponent(player) { return this.state.players.find(p => p.id !== player.id && p.alive); }
  getNextBarbarianTarget(currentId, remaining) { return remaining.find(id => this.getPlayer(id)?.alive); }
  hasSkill(player, skillId) { const hero = HEROES.find(h => h.id === player.heroId); return hero?.skillIds.includes(skillId) ?? false; }
  isValidAttackResponse(player, card) {
    if (card.def.id === 'sha') return true;
    if (this.hasSkill(player, 'wusheng') && (card.def.suit === 'heart' || card.def.suit === 'diamond')) return true;
    return false;
  }

  executeLuoshen(player) {
    let count = 0;
    while (true) {
      if (this.state.deck.length === 0) break;
      const card = this.state.deck.pop();
      if (card.def.suit === 'spade' || card.def.suit === 'club') { player.hand.push(card); count++; }
      else { this.state.discard.push(card); break; }
    }
    if (count > 0) this.log(`${player.name} 发动洛神，获得${count}张黑色牌`);
  }

  log(msg) { this.logs.push(msg); }
  popLogs() { const l = this.logs; this.logs = []; return l; }
}
