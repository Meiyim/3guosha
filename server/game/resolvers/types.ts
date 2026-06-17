import { type CardInstance, type PlayerState, type ResolutionItem, type WaitingAction } from '../types.ts';

export type ResponseResolver = (ctx: ResolverContext, item: ResolutionItem, player: PlayerState, cardUid: number | null) => WaitingAction | null;

export interface ResolverContext {
  readonly waitingFor: WaitingAction | null;
  useCard(player: PlayerState, cardIdx: number): void;
  dealDamage(target: PlayerState, amount: number, sourceId?: string, data?: { card?: CardInstance; afterRescue?: WaitingAction }): void;
  log(msg: string): void;
  getPlayer(id: string): PlayerState | undefined;
  pushResolution(type: WaitingAction['type'], playerId: string, resolver: ResolutionItem['resolver'], data?: any): void;
  beginRescue(dying: PlayerState, sourceId?: string, afterRescue?: WaitingAction): void;
  finalizeDeath(player: PlayerState): void;
  continueAfterRescue(action?: WaitingAction): void;
  isValidAttackResponse(player: PlayerState, card: CardInstance): boolean;
}
