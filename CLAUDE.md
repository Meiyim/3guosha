# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run server (reads config.yaml)
npm start

# Type check (server + bot)
npm run typecheck

# All tests (unit + join + e2e)
npm test

# Single test suites
npm run test:unit          # game engine logic
npm run test:e2e           # 2 AI agents play a full game with replay verification

# Run any .ts file directly
node --experimental-transform-types <file.ts>

# TUI client (connect to running server or mock)
node --experimental-transform-types cli/tui.ts --port 8331 --join any --name "Player"

# Mock server for TUI testing (no game rules, random cards)
node --experimental-transform-types tests/mock_server.ts --port 9999

# Replay inspector
node --experimental-transform-types scripts/inspect.ts logs/states/
```

## Critical Constraints

- **WebSocket only.** No HTTP polling. All clients (browser, CLI, bot, tests) use WebSocket exclusively.
- **No npm ws.** WebSocket is implemented from scratch in `server/ws.ts`.
- **`--experimental-transform-types` required** (not `--strip-types`) because the codebase uses TypeScript enums.
- `shared/game-client.js` is UMD. The `.cjs` copy exists for Node `require()` since package.json has `"type": "module"`.

## Architecture

```
server/index.ts        Entry point: loads config.yaml, serves static files, inits room
server/ws.ts           Custom WebSocket server (MinimalWebSocketServer/MinimalWebSocket)
server/room.ts         Single room management, broadcasts PublicGameState + PrivateGameState per player
server/config.ts       Loads config.yaml → ServerConfig
server/logger.ts       createLogger(prefix) → server-0.log / game-0.log (4GB rotation)

server/game/
  types.ts             All types + enums (WaitingType, ResolverType, TargetType, etc.)
  engine.ts            Game class — state machine, resolution stack, action history, state dump
  cards/index.ts       Card registry + deck builder; registerCard(id, handler)
  cards/basic.ts       杀/闪/桃
  cards/tricks.ts      决斗/南蛮/万箭/无中生有
  cards/equip.ts       诸葛连弩/+1马/-1马
  heroes/index.ts      Hero + skill registry; registerHero(), registerSkill()
  heroes/{wei,shu,wu}.ts   Hero plugins with SkillHandler implementations

shared/game-client.js  UMD state machine shared by browser + CLI (no DOM, no Node APIs)
shared/ws-client.ts    WsClient class for tests/bots

cli/tui.ts             Full TUI: 3-zone layout, card boxes, target selection mode
cli/interactive.ts     Simpler readline-based fallback
bot/ai_bot.ts          AI opponent via WebSocket
```

## Key Patterns

**Plugin system:** Cards and heroes self-register via side-effect imports in `engine.ts`. To add a card: create a `CardHandler` with `targetType` and `onPlay()`, call `registerCard(id, handler)`. Heroes: `registerHero(def)` + `registerSkill(handler)`.

**Resolution stack:** Nested card/skill responses (杀→闪, 决斗 back-and-forth) use `resolutionStack` in GameState. The engine's `waitingFor` getter reads from stack top for backward compatibility.

**State split:** Server sends `game_update` (PublicGameState with hand counts, no card details) to all players, and `private_update` (PrivateGameState with actual hand cards) to each player individually.

**State dump:** Every turn end writes `logs/states/turn_N.json` + `actions_turn_N.json`. `turn_0.json` is the initial state. Used by replay verification in e2e tests.

**TargetType on cards:** `SINGLE` = needs target selection (杀, 决斗), `ALL_OTHERS` = auto-targets everyone else (南蛮, 万箭), `SELF` = no target needed (桃, 无中, equipment).

## Pre-commit Hook

Runs: TypeScript type check → trailing whitespace check → unit tests. All must pass.
