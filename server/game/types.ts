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

export enum WaitingType {
  RESPOND_ATTACK = 'respond_attack',
  RESPOND_DUEL = 'respond_duel',
  RESPOND_BARBARIAN = 'respond_barbarian',
  RESPOND_WUXIE = 'respond_wuxie',
  DISCARD = 'discard',
}

export enum ResolverType {
  ATTACK = 'attack',
  DUEL = 'duel',
  BARBARIAN = 'barbarian',
  WUXIE = 'wuxie',
  DISCARD = 'discard',
}

export enum ResolveResult {
  SUCCESS = 'success',
  CANCELED = 'canceled',
  PASSED = 'passed',
}

export interface ResolutionItem {
  id: string;
  type: WaitingType;
  playerId: string;
  resolver: ResolverType;
  data?: any;
}

export interface WaitingAction {
  playerId: string;
  type: WaitingType;
  data?: any;
}

export interface GameState {
  players: PlayerState[];
  currentPlayerIdx: number;
  phase: Phase;
  deck: CardInstance[];
  discard: CardInstance[];
  turnNumber: number;
  resolutionStack: ResolutionItem[];
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
  waitingFor: WaitingAction | null;
}

export interface PrivateGameState {
  myId: string;
  myHand: CardInstance[];
}

export enum ServerMsgType {
  ROOM_JOINED = 'room_joined',
  HERO_SELECTION = 'hero_selection',
  GAME_UPDATE = 'game_update',
  PRIVATE_UPDATE = 'private_update',
  GAME_OVER = 'game_over',
  ERROR = 'error',
  LOG = 'log',
}

export enum ClientMsgType {
  JOIN_ROOM = 'join_room',
  SELECT_HERO = 'select_hero',
  PLAY_CARD = 'play_card',
  RESPOND = 'respond',
  END_PLAY = 'end_play',
  DISCARD_CARDS = 'discard_cards',
  ZHIHENG = 'zhiheng',
}

export type ServerMsg =
  | { type: ServerMsgType.ROOM_JOINED; players: { id: string; name: string }[] }
  | { type: ServerMsgType.HERO_SELECTION; heroes: HeroDef[] }
  | { type: ServerMsgType.GAME_UPDATE; state: PublicGameState }
  | { type: ServerMsgType.PRIVATE_UPDATE; state: PrivateGameState }
  | { type: ServerMsgType.GAME_OVER; winner: string }
  | { type: ServerMsgType.ERROR; msg: string }
  | { type: ServerMsgType.LOG; msg: string };

// Plugin interfaces
export type GameEvent = 'turn_start' | 'turn_end' | 'before_play' | 'damage_taken' | 'respond_needed';

export interface GameContext {
  state: GameState;
  readonly waitingFor: WaitingAction | null;
  drawCards(player: PlayerState, count: number): CardInstance[];
  dealDamage(target: PlayerState, amount: number, sourceId?: string): void;
  useCard(player: PlayerState, cardIdx: number): void;
  getPlayer(id: string): PlayerState | undefined;
  getOpponent(player: PlayerState): PlayerState | undefined;
  setWaiting(action: WaitingAction): void;
  log(msg: string): void;
  hasSkill(player: PlayerState, skillId: string): boolean;
}

export interface CardHandler {
  canPlay?(ctx: GameContext, player: PlayerState, card: CardInstance): boolean;
  onPlay(ctx: GameContext, player: PlayerState, card: CardInstance, cardIdx: number, targetId?: string): WaitingAction | null;
}

export interface SkillHandler {
  id: string;
  events: GameEvent[];
  trigger(ctx: GameContext, event: GameEvent, player: PlayerState, data?: any): void;
  activeAction?(ctx: GameContext, player: PlayerState, cardUids: number[]): void;
}
