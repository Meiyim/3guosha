export type CardSuit = 'spade' | 'heart' | 'club' | 'diamond';
export type CardType = 'basic' | 'trick' | 'equipment';
export type EquipSlot = 'weapon' | 'armor' | 'horse_plus' | 'horse_minus';
export type Phase = 'prepare' | 'judge' | 'draw' | 'play' | 'discard' | 'end';

export interface CardDef {
  id: string;
  name: string;
  nameCn: string;
  type: CardType;
  suit: CardSuit;
  number: number;
  equipSlot?: EquipSlot;
}

export interface CardInstance {
  uid: number;
  def: CardDef;
}

export interface HeroDef {
  id: string;
  name: string;
  nameCn: string;
  maxHp: number;
  gender: 'male' | 'female';
  kingdom: 'shu' | 'wei' | 'wu' | 'qun';
  skillIds: string[];
}

export interface PlayerState {
  id: string;
  name: string;
  heroId: string;
  hp: number;
  maxHp: number;
  hand: CardInstance[];
  equipment: Partial<Record<EquipSlot, CardInstance>>;
  alive: boolean;
  attackCount: number;
}

export interface WaitingAction {
  playerId: string;
  type: 'respond_attack' | 'respond_duel' | 'respond_barbarian' | 'discard';
  data?: any;
}

export interface GameState {
  players: PlayerState[];
  currentPlayerIdx: number;
  phase: Phase;
  deck: CardInstance[];
  discard: CardInstance[];
  turnNumber: number;
  waitingFor: WaitingAction | null;
  winner: string | null;
}

export interface PublicPlayerState {
  id: string;
  name: string;
  heroId: string;
  hp: number;
  maxHp: number;
  handCount: number;
  equipment: Partial<Record<EquipSlot, CardDef>>;
  alive: boolean;
}

export interface PublicGameState {
  players: PublicPlayerState[];
  currentPlayerIdx: number;
  phase: Phase;
  deckCount: number;
  turnNumber: number;
  myHand: CardInstance[];
  myId: string;
  waitingFor: WaitingAction | null;
}

export type ServerMsg =
  | { type: 'room_created'; pin: string }
  | { type: 'room_joined'; players: { id: string; name: string }[] }
  | { type: 'hero_selection'; heroes: HeroDef[] }
  | { type: 'game_update'; state: PublicGameState }
  | { type: 'game_over'; winner: string }
  | { type: 'error'; msg: string }
  | { type: 'log'; msg: string };
