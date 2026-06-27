import assert from 'assert';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  DualGameController,
  createBasicRuleInterpreter,
  createDualGameState,
  type Action,
  type CardInstance,
  type DispatchResult,
  type GameControllerOptions,
  type GameState,
  type WinnerState,
} from '../../src/game/index.ts';

export interface GameScenario {
  id: string;
  name: string;
  state: GameState;
  bots: ScriptedAiBot[];
  expect(controller: TestGameController): void;
}

export interface RunScenarioOptions {
  logRoot?: string;
}

export type BotMove = (controller: TestGameController, bot: ScriptedAiBot) => Action;

export class ScriptedAiBot {
  private cursor = 0;

  constructor(
    readonly playerId: string,
    private readonly moves: BotMove[],
  ) {}

  hasMove(): boolean {
    return this.cursor < this.moves.length;
  }

  performNextMove(controller: TestGameController): DispatchResult {
    const move = this.moves[this.cursor];
    assert.ok(move, `bot ${this.playerId} has no remaining scripted move`);
    this.cursor += 1;

    const action = move(controller, this);
    assert.equal((action as any).playerId, this.playerId, `bot ${this.playerId} emitted another player's action`);

    const result = controller.dispatch(action);
    assert.equal(result.ok, true, `bot ${this.playerId} emitted illegal action: ${JSON.stringify(action)}`);
    return result;
  }
}

export class TestGameController extends DualGameController {
  static resume(state: GameState): TestGameController {
    return new TestGameController(state, { shuffleSeed: state.metadata.shuffleSeed ?? 'test-scenario' });
  }

  constructor(
    state: GameState,
    options: GameControllerOptions = { shuffleSeed: 'test-scenario' },
  ) {
    super(state, options, createBasicRuleInterpreter());
  }

  runScenario(scenario: GameScenario): void {
    while (scenario.bots.some(bot => bot.hasMove())) {
      for (const bot of scenario.bots) {
        if (bot.hasMove()) bot.performNextMove(this);
      }
    }

    scenario.expect(this);
  }

  writeTraceLog(logDir: string, scenario: GameScenario): void {
    mkdirSync(logDir, { recursive: true });
    writeJson(join(logDir, 'meta.json'), {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      generatedAt: new Date().toISOString(),
    });
    writeJson(join(logDir, 'trace.json'), this.getTraceLog());
    writeJson(join(logDir, 'final_state.json'), this.getState());
  }

  isEndState(_state: GameState): WinnerState | null {
    return null;
  }
}

export function runScenario(scenario: GameScenario, options: RunScenarioOptions = {}): void {
  const controller = TestGameController.resume(cloneGameState(scenario.state));
  controller.runScenario(scenario);
  if (options.logRoot) controller.writeTraceLog(join(options.logRoot, scenario.id), scenario);
}

export function inspectScenario(scenario: GameScenario): TestGameController {
  const controller = TestGameController.resume(cloneGameState(scenario.state));
  controller.runScenario(scenario);
  return controller;
}

export function card(id: string, cardId: string): CardInstance {
  return { id, cardId, zone: 'void' };
}

export function createTwoPlayerTestState(options: {
  p1Hand?: string[];
  p2Hand?: string[];
  cards: CardInstance[];
}): GameState {
  return createDualGameState({
    id: 'test_game',
    shuffleSeed: 'test-scenario',
    players: [
      { id: 'p1', name: 'AI A', hand: options.p1Hand ?? [] },
      { id: 'p2', name: 'AI B', hand: options.p2Hand ?? [] },
    ],
    cards: options.cards,
  });
}

export function playCard(cardInstanceId: string, cardId: string, targets: string[] = []): BotMove {
  return (_controller, bot) => ({
    type: 'card_play',
    playerId: bot.playerId,
    cardInstanceId,
    cardId,
    targets,
  });
}

export function passTopFrame(): BotMove {
  return (controller, bot) => {
    const frame = controller.getState().resolutionStack.at(-1);
    assert.ok(frame, `bot ${bot.playerId} cannot pass without a resolution frame`);
    return { type: 'pass', playerId: bot.playerId, resolutionFrameId: frame.id };
  };
}

export function endPhase(): BotMove {
  return (_controller, bot) => ({ type: 'end_phase', playerId: bot.playerId });
}

function cloneGameState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state));
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
