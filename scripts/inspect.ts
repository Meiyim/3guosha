#!/usr/bin/env node
// Inspect game states & actions in human-readable format
// Usage: node --experimental-transform-types scripts/inspect.ts <states_dir>

import * as fs from 'fs';
import * as path from 'path';

const dir = process.argv[2] || './logs/states';
if (!fs.existsSync(dir)) { console.error(`Directory not found: ${dir}`); process.exit(1); }

const SUITS: Record<string, string> = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
const CARDS: Record<string, string> = { sha: '杀', shan: '闪', tao: '桃', juedou: '决斗', nanman: '南蛮入侵', wanjian: '万箭齐发', wuzhong: '无中生有', zhuge: '诸葛连弩', plus_horse: '+1马', minus_horse: '-1马' };

function cardStr(c: any): string { return `${CARDS[c.id]||c.id}${SUITS[c.suit]||c.suit}${c.number}`; }
function hpBar(hp: number, max: number): string { return '❤'.repeat(hp) + '○'.repeat(max - hp); }

const turnFiles = fs.readdirSync(dir).filter(f => f.startsWith('turn_')).sort((a, b) => {
  return parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]);
});

for (const turnFile of turnFiles) {
  const turn = JSON.parse(fs.readFileSync(path.join(dir, turnFile), 'utf8'));
  const turnNum = turn.turnNumber;
  const actFile = path.join(dir, `actions_turn_${turnNum}.json`);
  const actions = fs.existsSync(actFile) ? JSON.parse(fs.readFileSync(actFile, 'utf8')) : [];


  console.log(`\n${'═'.repeat(60)}`);
  if (turnFile === 'turn_0.json') {
    console.log(`  游戏开始  |  牌堆: ${turn.deckCount}  |  弃牌堆: ${turn.discardCount}`);
  } else {
    console.log(`  回合 ${turnNum}  |  阶段: ${turn.phase}  |  牌堆: ${turn.deckCount}  |  弃牌堆: ${turn.discardCount}`);
  }
  console.log(`${'═'.repeat(60)}`);

  for (const p of turn.players) {
    const marker = turn.currentPlayerIdx === turn.players.indexOf(p) ? '→' : ' ';
    const status = p.alive ? hpBar(p.hp, p.maxHp) : '💀';
    const hand = p.hand.map(cardStr).join(', ');
    const equip = Object.entries(p.equipment).map(([s, c]: any) => `${CARDS[c.id]||c.id}`).join(' ');
    console.log(`  ${marker} ${p.name}(${p.heroId}) ${status}  手牌[${p.hand.length}]: ${hand}`);
    if (equip) console.log(`    装备: ${equip}`);
  }

  if (turn.winner) {
    const winner = turn.players.find((p: any) => p.id === turn.winner);
    console.log(`\n  🏆 胜者: ${winner?.name || turn.winner}`);
  }

  if (actions.length > 0) {
    console.log(`\n  动作序列:`);
    for (const a of actions) {
      const player = turn.players.find((p: any) => p.id === a.playerId)?.name || a.playerId;
      let desc = '';
      switch (a.action) {
        case 'play_card': {
          const target = turn.players.find((p: any) => p.id === a.data.targetId)?.name || a.data.targetId || '';
          desc = `使用 ${CARDS[a.data.cardId]||a.data.cardId}${target ? ' → ' + target : ''}`;
          break;
        }
        case 'draw': {
          const cards = (a.data.cards || []).map((c: any) => `${CARDS[c.id]||c.id}${SUITS[c.suit]||c.suit}${c.number}`).join(', ');
          desc = `摸牌: ${cards}`;
          break;
        }
        case 'respond': {
          desc = a.data.cardUid ? `响应 (出牌uid=${a.data.cardUid})` : `响应 (放弃)`;
          break;
        }
        case 'end_play': desc = '结束出牌'; break;
        case 'discard_cards': desc = `弃牌 x${a.data.cardUids.length}`; break;
        case 'zhiheng': desc = `制衡 x${a.data.cardUids.length}`; break;
        default: desc = a.action;
      }
      console.log(`    ${player}: ${desc}`);
    }
  }
}

console.log(`\n${'═'.repeat(60)}\n`);
