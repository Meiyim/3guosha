import type { CardDef, CardInstance, CardSuit, EquipSlot, CardHandler } from '../types.ts';

const cardRegistry = new Map<string, CardHandler>();
export function registerCard(id: string, handler: CardHandler) { cardRegistry.set(id, handler); }
export function getCardHandler(id: string): CardHandler | undefined { return cardRegistry.get(id); }

type DeckEntry = { id: string; suit: CardSuit; number: number };
function spread(id: string, suit: CardSuit, numbers: number[]): DeckEntry[] {
  return numbers.map(n => ({ id, suit, number: n }));
}

const basicCards: Omit<CardDef, 'suit' | 'number'>[] = [
  { id: 'sha', name: 'Attack', nameCn: '杀', type: 'basic' },
  { id: 'shan', name: 'Dodge', nameCn: '闪', type: 'basic' },
  { id: 'tao', name: 'Peach', nameCn: '桃', type: 'basic' },
];
const trickCards: Omit<CardDef, 'suit' | 'number'>[] = [
  { id: 'juedou', name: 'Duel', nameCn: '决斗', type: 'trick' },
  { id: 'nanman', name: 'Barbarian Invasion', nameCn: '南蛮入侵', type: 'trick' },
  { id: 'wanjian', name: 'Arrow Barrage', nameCn: '万箭齐发', type: 'trick' },
  { id: 'wuzhong', name: 'Bountiful Harvest', nameCn: '无中生有', type: 'trick' },
];
const equipCards: Omit<CardDef, 'suit' | 'number'>[] = [
  { id: 'zhuge', name: 'Zhuge Crossbow', nameCn: '诸葛连弩', type: 'equipment', equipSlot: 'weapon' as EquipSlot },
  { id: 'plus_horse', name: '+1 Horse', nameCn: '+1马', type: 'equipment', equipSlot: 'horse_plus' as EquipSlot },
  { id: 'minus_horse', name: '-1 Horse', nameCn: '-1马', type: 'equipment', equipSlot: 'horse_minus' as EquipSlot },
];

const deckList: DeckEntry[] = [
  ...spread('sha', 'spade', [1,2,3,4,5,6,7,8,9,10]),
  ...spread('sha', 'club', [2,3,4,5,6,7,8]),
  ...spread('sha', 'heart', [10,11,12]),
  ...spread('sha', 'diamond', [6,7,8,9,10,11,12,13]),
  ...spread('shan', 'diamond', [2,3,4,5,6,7,8,9,10,11]),
  ...spread('shan', 'heart', [2,3,13]),
  ...spread('shan', 'club', [2,12]),
  ...spread('tao', 'heart', [3,4,5,6,7,8,9,12]),
  ...spread('juedou', 'spade', [1]),
  ...spread('juedou', 'club', [1]),
  ...spread('juedou', 'diamond', [1]),
  ...spread('nanman', 'spade', [7,13]),
  ...spread('nanman', 'club', [7]),
  ...spread('wanjian', 'heart', [1]),
  ...spread('wuzhong', 'heart', [7,8,9,11]),
  ...spread('zhuge', 'club', [1]),
  ...spread('zhuge', 'diamond', [1]),
  ...spread('plus_horse', 'heart', [13]),
  ...spread('plus_horse', 'spade', [5]),
  ...spread('minus_horse', 'heart', [5]),
  ...spread('minus_horse', 'diamond', [13]),
];

const allCardDefs = [...basicCards, ...trickCards, ...equipCards];
const defMap = new Map(allCardDefs.map(d => [d.id, d]));

export function buildDeck(): CardInstance[] {
  let uid = 1;
  return deckList.map(entry => {
    const base = defMap.get(entry.id)!;
    const def: CardDef = { ...base, suit: entry.suit, number: entry.number };
    return { uid: uid++, def };
  });
}

export function shuffleDeck(deck: CardInstance[]): void {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}
