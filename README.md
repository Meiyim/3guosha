# 三国杀 Online (Sanguosha)

Browser-based multiplayer card game. No client dependencies — just Chrome.

## Quick Start

```bash
npm install
npm start
```

Open `http://localhost:3000` in Chrome. The server creates one room at startup and prints its 4-digit PIN in the server log.

## Game Modes

### Normal Multiplayer

Use the normal URL for human-vs-human play:

```text
http://localhost:3000
```

In normal mode, the page shows the lobby. Enter the current room PIN and a player name to join. The first player waits on the waiting screen; the second player joins with the same PIN. After both players select heroes, the game starts.

Normal mode does not add an AI opponent and does not auto-start a game.

### Developer AI Mode

Use developer mode when working alone:

```text
http://localhost:3000/?dev=1
```

Developer mode creates a fresh 1v1 room for the current browser session, spawns an AI client named `开发对手`, and takes you directly to hero selection. Pick any hero and the game starts against the AI.

Developer mode can also create a local free-for-all table with multiple AI opponents:

```text
http://localhost:3000/?dev=1&players=4
```

`players` is clamped to 2-8 total seats. The first seat is the browser player and the remaining seats are spawned AI clients that join over WebSocket. This is intended as a local stepping stone toward the LLM agent arena.

The default opponent is `bot/ai_bot.ts` using the heuristic baseline agent implemented through the arena adapter interface in `server/arena/agents`. Agents receive an observation, inspect legal actions, and return one action:

```text
observe(playerId) -> legalActions -> act(observation) -> step(action)
```

The baseline currently uses simple deterministic heuristics:

- selects its assigned hero
- responds with 闪/杀 when available
- discards the required number of cards
- plays 桃 when hurt, equipment, 无中生有, 杀, and simple trick cards
- ends its play phase when it has no useful action

Developer mode is intended for local UI and game-flow development. It is not a full-strength Sanguosha AI and is only enabled by the `?dev=1` URL or the developer helper API.

### Live LLM Agent Smoke Test

The arena agent layer also includes an OpenAI-compatible adapter using the Responses API. It reads `OPENAI_API_KEY`/`CODEX_API_KEY` and `OPENAI_MODEL`/`CODEX_MODEL` from the environment, and falls back to local Codex config in `~/.codex/auth.json` and `~/.codex/config.toml`. To verify one live model decision:

```bash
npm run test:llm
```

Optional environment variables:

- `OPENAI_MODEL` or `CODEX_MODEL` — model name, default `gpt-5.5`
- `OPENAI_BASE_URL` — OpenAI-compatible base URL, default `https://api.openai.com/v1`
- `LLM_AGENT_TIMEOUT_MS` — smoke-test timeout, default `60000`

If no API key is available from the environment or Codex config, `npm run test:llm` skips without making a network request.

## Features

- 1v1 duel mode
- Developer free-for-all mode with multiple spawned AI clients
- 5 heroes: 刘备, 曹操, 孙权, 关羽, 甄姬
- Cards: 杀/闪/桃, 决斗/南蛮入侵/万箭齐发/无中生有, 诸葛连弩/±1马
- HTTP polling API (no WebSocket required on client)
- WebSocket also supported
- PIN-based room system
- Server-authoritative game logic
- Verbose debug mode: `VERBOSE=1 npm start`
- Game manual: `http://localhost:3000/api/manual`

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the longer-term plan toward an LLM-agent Sanguosha arena, multi-player matches, and UGC hero skills.

## Tests

```bash
npm test                     # All tests (unit + join + e2e)
npm run test:unit            # Unit tests (game engine)
npm run test:smoke           # HTTP polling smoke tests for normal and dev modes
npm run test:e2e             # End-to-end: 2 AI agents play a full game
npm run test:browser         # Full browser simulation
```

## API

### HTTP Polling

- `POST /api/action` — `{"type":"connect"}` → `{token, playerId}`
- `POST /api/action` — `{token, type, ...}` → sends game actions
- `GET /api/poll?token=xxx` → `{messages: [...]}` queued server messages

The browser client uses HTTP polling so local development works even when WebSocket support is unavailable. The custom WebSocket server is still present for CLI and bot clients.

### Actions

| type | params |
|------|--------|
| `create_room` | `name` |
| `join_room` | `pin`, `name` |
| `select_hero` | `heroId` |
| `play_card` | `cardUid`, `targetId?` |
| `respond` | `cardUid` (or null to pass) |
| `end_play` | — |
| `discard_cards` | `cardUids[]` |
| `zhiheng` | `cardUids[]` |
| `start_dev_game` | developer helper: create a fresh room and spawn AI clients |

## Tech Stack

- Node.js (no npm dependencies)
- Custom WebSocket implementation
- Plain HTML/CSS/JS client
