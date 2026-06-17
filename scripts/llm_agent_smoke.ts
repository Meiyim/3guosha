import { createOpenAIAgent, hasOpenAIAgentCredentials } from '../server/arena/agents/openai.ts';
import { Game } from '../server/game/engine.ts';

async function main() {
  if (!hasOpenAIAgentCredentials()) {
    console.log('SKIP: set OPENAI_API_KEY/CODEX_API_KEY or configure ~/.codex/auth.json to run the live LLM agent smoke test.');
    return;
  }

  const game = new Game([
    { id: 'p1', name: 'LLM', heroId: 'caocao' },
    { id: 'p2', name: 'Heuristic', heroId: 'liubei' },
  ]);
  game.startTurn();
  const obs = game.observe(game.currentPlayer.id);
  if (!obs) throw new Error('missing observation');

  const agent = createOpenAIAgent({ timeoutMs: Number(process.env.LLM_AGENT_TIMEOUT_MS || 60000) });
  const action = await agent.act(obs);
  if (!action) throw new Error('LLM agent returned no action');
  if (!game.legalActions(obs.privateState.myId).some(legal => JSON.stringify(legal) === JSON.stringify(action))) {
    throw new Error(`LLM agent returned illegal action: ${JSON.stringify(action)}`);
  }
  console.log(JSON.stringify({ ok: true, agent: agent.id, action }, null, 2));
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
