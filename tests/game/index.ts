import { runScenario } from './harness.ts';
import { scenarios } from './scenarios.ts';

const args = process.argv.slice(2);
const logRoot = readOption(args, '--log-dir');
let passed = 0;
let failed = 0;

console.log('\n=== Game Scenario Tests ===\n');

for (const scenario of scenarios) {
  try {
    runScenario(scenario, { logRoot });
    passed++;
    console.log(`  ✓ ${scenario.name}`);
    if (logRoot) console.log(`    log: ${logRoot}/${scenario.id}`);
  } catch (error: any) {
    failed++;
    console.log(`  ✗ ${scenario.name}: ${error.message}`);
  }
}

console.log(`\n=== Game Scenario Results: ${passed} passed, ${failed} failed ===\n`);
process.exitCode = failed > 0 ? 1 : 0;

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}
