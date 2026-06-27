import type { CompiledRuleModule } from '../core/rule_module.ts';
import type { CardRuleAst, EffectAst } from './ast.ts';
import type { CardInstructionIr, CardRuleIr } from './ir.ts';

export type RuleGraphView = 'ast' | 'ir' | 'both';

export function renderRuleModuleMermaid(module: CompiledRuleModule, view: RuleGraphView = 'both'): string {
  const graphs: string[] = [];
  if ((view === 'ast' || view === 'both') && module.ast) {
    graphs.push(renderCardAstMermaid(module.ast));
  }
  if ((view === 'ir' || view === 'both') && module.ir) {
    graphs.push(renderCardIrMermaid(module.ir));
  }
  return graphs.join('\n\n');
}

export function renderCardAstMermaid(ast: CardRuleAst): string {
  const graph = new MermaidGraph('AST');
  const root = graph.node(`CardRuleAst: ${ast.name}`);

  graph.edge(root, graph.node(`id: ${ast.id}`));
  if (ast.cardType) graph.edge(root, graph.node(`cardType: ${ast.cardType}`));
  graph.edge(root, graph.node(`TimingAst: ${ast.timing.kind}`));
  graph.edge(root, graph.node(`TargetAst: ${ast.target.kind}`));

  const effects = graph.node('effects');
  graph.edge(root, effects);
  for (const effect of ast.effects) {
    const effectNode = graph.node(effectLabel(effect));
    graph.edge(effects, effectNode);
  }

  if (ast.notes.length > 0) {
    const notes = graph.node('notes');
    graph.edge(root, notes);
    for (const note of ast.notes) {
      graph.edge(notes, graph.node(note));
    }
  }

  return graph.render();
}

export function renderCardIrMermaid(ir: CardRuleIr): string {
  const graph = new MermaidGraph('IR');
  const root = graph.node(`CardRuleIr: ${ir.id}`);

  graph.edge(root, graph.node(`name: ${ir.name}`));
  graph.edge(root, graph.node(`timing: ${ir.timing.op}`));
  graph.edge(root, graph.node(`target: ${ir.target.op}`));
  graph.edge(root, graph.node(`playCost.discardPlayedCard: ${ir.playCost.discardPlayedCard}`));

  const instructions = graph.node('instructions');
  graph.edge(root, instructions);
  for (const instruction of ir.instructions) {
    graph.edge(instructions, graph.node(instructionLabel(instruction)));
  }

  return graph.render();
}

function effectLabel(effect: EffectAst): string {
  switch (effect.kind) {
    case 'damage_target':
      return `EffectAst: damage_target amount=${effect.amount}`;
    case 'heal_self':
      return `EffectAst: heal_self amount=${effect.amount}`;
    case 'cancel_sha_resolution':
      return 'EffectAst: cancel_sha_resolution';
    case 'unknown':
      return `EffectAst: unknown ${effect.text}`;
  }
}

function instructionLabel(instruction: CardInstructionIr): string {
  switch (instruction.op) {
    case 'open_sha_response_frame':
      return `open_sha_response_frame damageAmount=${instruction.damageAmount}`;
    case 'emit_heal_self_action':
      return `emit_heal_self_action amount=${instruction.amount}`;
    case 'emit_cancel_sha_resolution_action':
      return 'emit_cancel_sha_resolution_action';
  }
}

class MermaidGraph {
  private nextId = 0;
  private lines: string[] = ['graph TD'];

  constructor(private readonly prefix: string) {}

  node(label: string): string {
    const id = `${this.prefix}_${this.nextId++}`;
    this.lines.push(`  ${id}["${escapeMermaidLabel(label)}"]`);
    return id;
  }

  edge(from: string, to: string): void {
    this.lines.push(`  ${from} --> ${to}`);
  }

  render(): string {
    return this.lines.join('\n');
  }
}

function escapeMermaidLabel(label: string): string {
  return label
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ');
}
