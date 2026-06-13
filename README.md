# 三国杀 Online (Sanguosha)

Browser-based multiplayer card game. No client dependencies — just Chrome.

## Quick Start

```bash
npm start
```

Open `http://localhost:3000` in Chrome. One player creates a room, shares the 4-digit PIN, the other joins.

## Play Against AI

```bash
PORT=8331 node server/index.mjs &
# In another terminal:
AI_TOKEN=$(curl -s -X POST http://localhost:8331/api/action -H 'Content-Type: application/json' -d '{"type":"connect"}' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")
curl -s -X POST http://localhost:8331/api/action -H 'Content-Type: application/json' -d "{\"type\":\"create_room\",\"name\":\"AI\",\"token\":\"$AI_TOKEN\"}" > /dev/null
PIN=$(curl -s "http://localhost:8331/api/poll?token=$AI_TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).messages.find(m=>m.type==='room_created').pin))")
echo "PIN: $PIN"
AI_TOKEN=$AI_TOKEN node bot/ai_bot.mjs
```

Then open `http://localhost:8331` and enter the PIN.

## Features

- 1v1 duel mode
- 5 heroes: 刘备, 曹操, 孙权, 关羽, 甄姬
- Cards: 杀/闪/桃, 决斗/南蛮入侵/万箭齐发/无中生有, 诸葛连弩/±1马
- HTTP polling API (no WebSocket required on client)
- WebSocket also supported
- PIN-based room system
- Server-authoritative game logic
- Verbose debug mode: `VERBOSE=1 node server/src/index.mjs`
- Game manual: `http://localhost:3000/api/manual`

## Tests

```bash
npm test                     # All tests (unit + join + e2e)
npm run test:unit            # Unit tests (game engine)
npm run test:e2e             # End-to-end: 2 AI agents play a full game
npm run test:browser         # Full browser simulation
```

## API

### HTTP Polling

- `POST /api/action` — `{"type":"connect"}` → `{token, playerId}`
- `POST /api/action` — `{token, type, ...}` → sends game actions
- `GET /api/poll?token=xxx` → `{messages: [...]}` queued server messages

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

## Tech Stack

- Node.js (no npm dependencies)
- Custom WebSocket implementation
- Plain HTML/CSS/JS client
