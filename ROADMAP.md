# Sanguosha Agent Arena Roadmap

This project is moving from a small 1v1 browser demo toward a Sanguosha arena for LLM agents, heuristic bots, and UGC heroes.

## Phase 0 - Demo Stabilization

- [x] Add browser developer mode with a built-in AI opponent.
- [x] Add configurable multi-bot developer mode for local free-for-all testing.
- [x] Keep normal multiplayer mode separate from developer mode.
- [x] Add HTTP polling client path for environments where WebSocket is unavailable.
- [x] Fix basic duel-mode rules for self-targeting, horse distance, and discard counts.
- [x] Align README, scripts, and runtime with the current TypeScript entrypoints.
- [x] Improve 1v1 board visual hierarchy and card interaction polish.
- [ ] Fix remaining obvious standard-rule gaps in the current 1v1 demo.
- [x] Add reliable smoke tests for normal mode and `?dev=1` mode.

## Phase 1 - Arena-Ready Engine API

- [ ] Split the game engine from room, transport, and UI concerns.
- [ ] Add deterministic game seeds for reproducible matches.
- [x] Add `observe(playerId)` for private player observations.
- [x] Add `legalActions(playerId)` so agents choose only from legal moves.
- [x] Add `step(action)` as the single authoritative state transition API.
- [ ] Add structured public logs for replay and agent context.
- [ ] Ensure hidden information stays hidden from each player/agent.
- [ ] Save full replays with seed, players, observations, actions, and final result.

## Phase 2 - Multi-Player Support

- [ ] Replace 1v1 assumptions with N-player seat management.
- [x] Implement circular distance calculation for N players.
- [x] Support turn order, death, skipped dead players, and game-over detection for N players.
- [ ] Make room creation support configurable player counts.
- [ ] Update UI to show multiple opponents and current turn order.
- [x] Add engine tests for 2, 3, and 4 player counts.

## Phase 3 - LLM Agent Protocol

- [x] Define an agent adapter interface: `observe -> legalActions -> act`.
- [ ] Add timeout handling and fallback actions.
- [ ] Track illegal actions, parse failures, and retries as arena metrics.
- [x] Add a heuristic baseline bot for regression testing.
- [ ] Add a local/mock LLM agent for offline development.
- [x] Add OpenAI-compatible agent configuration without coupling the engine to one provider.
- [ ] Store prompts, model names, temperature, and tool settings in match metadata.

## Phase 4 - Tournament Arena

- [ ] Add a match runner for bot-vs-bot and LLM-vs-LLM games.
- [ ] Add batch tournaments with configurable player pools.
- [ ] Compute win rate, average placement, illegal-action rate, timeout rate, and game length.
- [ ] Add Elo or TrueSkill ratings.
- [ ] Add replay inspection tools for failed or surprising matches.
- [ ] Add CLI commands for running arena jobs.
- [ ] Add a simple leaderboard page.

## Phase 5 - Rules Expansion

- [x] Implement dying state and 桃 rescue flow.
- [x] Fix 曹操「奸雄」to obtain the actual damage card.
- [x] Add a written standard-rules audit for current implemented cards and skills.
- [ ] Implement 刘备「仁德」.
- [ ] Add more standard cards and equipment.
- [ ] Add delayed tricks and judgment flow.
- [ ] Add 无懈可击 and response windows.
- [ ] Expand hero skill coverage with tests.
- [ ] Add rule-version metadata for replay compatibility.

## Phase 6 - UGC Hero Skills

- [ ] Design a safe skill DSL instead of executing generated code.
- [ ] Add LLM-assisted natural-language-to-DSL generation.
- [ ] Validate generated skills against a whitelist of triggers, conditions, and effects.
- [ ] Add loop prevention, per-turn limits, and effect budgets.
- [ ] Add automatic skill explanation text.
- [ ] Add simulation-based balance checks against baseline bots.
- [ ] Add import/export for custom heroes.
- [ ] Add a review UI for generated skills before they enter the arena.

## Phase 7 - Product Polish

- [ ] Improve mobile and desktop board layout for multi-player games.
- [ ] Add match setup UI for human, bot, and LLM seats.
- [ ] Add replay viewer.
- [ ] Add arena run history.
- [ ] Add error surfaces for agent failures.
- [ ] Add documentation for writing agents and UGC skills.
