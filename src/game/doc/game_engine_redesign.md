# 游戏引擎重构设计草案

## 1. 设计目标

本设计的核心目标是把游戏引擎重构为一个清晰的有限状态机：

```text
GameState + Action -> GameController -> ActionResolutionResult -> Effect[] -> GameState'
```

游戏过程中，`GameState` 是唯一的状态事实来源。所有玩家操作、卡牌规则、技能规则和结算流程，最终都必须表现为对 `GameState` 的一次或多次状态转移。当 `GameState` 到达某个终止状态时，游戏结束。

引擎本身不关心 HTTP、WebSocket、TUI、GUI 或浏览器渲染。客户端只向服务端发送 `Action`，服务端只向客户端广播新的 `GameState` 或从 `GameState` 派生出的玩家视图。

## 2. 核心概念

### 2.1 GameState

`GameState` 是游戏的完整状态快照，应包含所有影响规则判断和后续状态转移的信息。

建议结构：

```ts
interface GameState {
  id: string;
  mode: GameMode;
  phase: GamePhase;
  turn: TurnState;
  players: PlayerState[];
  deck: CardInstance[];
  discardPile: CardInstance[];
  resolutionStack: ResolutionFrame[];
  actionLog: ActionRecord[];
  winner: WinnerState | null;
  metadata: GameMetadata;
}
```

关键原则：

- `GameState` 不能依赖外部连接对象、请求对象或 UI 状态。
- `GameState` 可以被序列化、存档、回放和测试。
- `GameState` 中的 `resolutionStack` 是当前未完成结算的唯一权威来源。
- `winner !== null` 或 `phase === "ended"` 表示进入终止状态。

### 2.2 GameController

`GameController` 是游戏模式控制器和 host runtime。它负责接收 `Action`、持有 `GameState`、调度结算栈、应用 `Effect`、推进 turn / phase，并把卡牌和技能规则的解释工作委托给 `RuleInterpreter`。

不同模式通过不同 Controller 实现：

- `DualGameController`：1v1 对战。
- `IdentityGameController`：身份局。
- `OneVsThreeGameController`：1v3 模式。
- `TestController`：测试专用，可控制牌堆、座位、初始状态和随机性。

当前设计中，`GameRNG` 只用于牌堆洗牌。洗牌 seed 由 `GameController` 配置和控制，不需要在卡牌结算、技能结算或 `Effect` 应用阶段引入全局随机数。

建议使用抽象基类加子类扩展：

```ts
interface GameControllerOptions {
  shuffleSeed: string;
}

abstract class GameController {
  constructor(
    protected state: GameState,
    protected options: GameControllerOptions,
    protected interpreter: RuleInterpreter,
  ) {}

  abstract isEndState(state: GameState): WinnerState | null;
  abstract getLegalActions(playerId: string): Action[];
  resolveAction(action: Action): ActionResolutionResult;
  abstract resolvePrimitiveAction(action: Action): Effect[];

  dispatch(action: Action): DispatchResult;
  protected applyEffects(effects: Effect[]): void;
}
```

原则：

- 初始牌堆生成或洗牌时使用 `shuffleSeed`。
- `shuffleSeed` 应记录在 `GameState.metadata` 或对局创建配置中，方便回放。
- Action 解析和 Effect 应用默认不消费随机数。
- 如果未来某张牌或技能真的需要随机性，再单独扩展 RNG 使用边界。

Controller 的职责：

- 判断当前 `Action` 是否允许。
- 调用 `RuleInterpreter`，把高层 `Action` 解析成后续 `Action` 或结算帧。
- 把底层原子 `Action` 解析成一个或多个 `Effect`。
- 管理结算栈（英文代码名：`ResolutionStack`）的推进、暂停、恢复和弹出。
- 判断是否进入终止状态。
- 对外提供合法行动列表。

Controller 不负责：

- 网络通信。
- 客户端渲染。
- 机器人策略。
- 直接生成 UI 文案。
- 直接理解每张卡牌或武将技能的 3gs 文本。

### 2.3 Action

`Action` 是玩家、系统或结算流程提出的“意图”。它本身不直接修改 `GameState`。

示例：

```ts
type Action =
  | CardPlayAction
  | CardRespondAction
  | SkillUseAction
  | EndPhaseAction
  | DiscardAction
  | CancelShaResolutionAction
  | DamageAction
  | SystemAction;
```

玩家客户端只能提交玩家可触发的 `Action`，例如：

- `CardPlayAction`
- `CardRespondAction`
- `SkillUseAction`
- `EndPhaseAction`
- `DiscardAction`

内部结算可以产生系统级 `Action`，例如：

- `DamageAction`
- `HealAction`
- `CardDiscardAction`
- `DrawCardAction`
- `EnterDyingAction`

### 2.3.1 使用 与 打出

设计中必须严格区分中文规则语义里的“使用”和“打出”：

- **使用**：按照卡牌自身描述发动卡牌效果。此时必须调用该牌的 `CardRule.onPlay`。
- **打出**：为了响应某个 `ResolutionFrame` 的要求而交出/展示一张牌。此时该牌的牌面描述不生效，不调用该牌的 `CardRule.onPlay`。

建议命名：

```ts
interface CardPlayAction {
  type: 'card_play';
  playerId: string;
  cardInstanceId: string;
  cardId: string;
  targets: string[];
}

interface CardRespondAction {
  type: 'card_respond';
  playerId: string;
  cardInstanceId: string;
  cardId: string;
  resolutionFrameId: string;
}
```

`CardPlayAction` 对应“使用”。例如：

- 出牌阶段使用 `桃`。
- 出牌阶段使用 `杀` 指定目标。
- 响应 `杀` 时使用 `闪`，因为 `闪` 的规则文本就是抵消 `杀`。

`CardRespondAction` 对应“打出”。例如：

- 响应 `南蛮入侵` 时打出 `杀`。
- 响应 `决斗` 时打出 `杀`。
- 如果未来某个效果要求“打出一张红桃牌”，也应使用 `CardRespondAction`。

关键约束：

```text
CardPlayAction   -> 调用对应 CardRule.onPlay
CardRespondAction -> 不调用对应 CardRule.onPlay，只交给当前 ResolutionCriterion 判断
```

因此，响应 `南蛮入侵` 打出的 `杀` 不会运行 `杀.onPlay`，也不会再次打开要求对方出 `闪` 的窗口。它只用于满足 `南蛮入侵` 当前 frame 的 criterion。

设计原则：

- `Action` 描述“发生了什么意图”。
- `Action` 可以继续被解析为其他 `Action`。
- 一个 `Action` 可以解析出多个后续 `Action`。
- 所有 `Action` 最终必须解析为 `Effect[]`；如果某次合法结算没有后续 Action，也没有状态变化，返回空数组即可。

### 2.4 Effect

`Effect` 是对 `GameState` 的最小状态转移 delta。

示例：

```ts
type Effect =
  | HealEffect
  | DamageEffect
  | CardMoveEffect
  | DrawCardEffect
  | NextPhaseEffect
  | NextTurnEffect
  | SetWinnerEffect
  | NoEffect;
```

`Effect` 的职责很窄：

- `HealEffect(playerId, amount)`：修改玩家体力。
- `CardMoveEffect(cardId, from, to)`：移动卡牌位置。
- `NextPhaseEffect`：进入下一个阶段。
- `NextTurnEffect`：进入下一个玩家回合。
- `SetWinnerEffect(winner)`：设置游戏终止结果。
- `NoEffect`：表示结算合法完成，但不会改变 `GameState`。

设计原则：

- `Effect` 是唯一真正改变 `GameState` 的单位。
- `Effect` 是最基础的 `GameState` delta，不允许作为规则分支失败。
- `Effect` 应尽量小、可测试、可回放。
- `Effect` 不做复杂规则判断。
- 复杂规则判断属于 `Action` 解析或卡牌/技能规则。
- 所有可能失败的条件都必须在 Action 合法性检查或 Action 解析阶段被拦截；一旦生成 `Effect`，应用它应当是确定性的。
- 如果 `applyEffect(effect)` 发现前置条件不满足，应视为引擎内部错误或断言失败，而不是玩家可触发的正常失败路径。
- `NoEffect` 只属于底层 Effect 语义，不能出现在 `Action[]` 中；大多数情况下空数组比显式 `NoEffect` 更清楚。

`PushResolution`、`PopResolution` 和 frame queue 调度不属于领域 `Effect`。它们虽然会改变 `GameState.resolutionStack`，但本质是 Controller 的内部调度机制，而不是玩家可感知的游戏语义。这样可以避免把“等待响应的实现方式”和“游戏事实变化”混在同一个 Effect taxonomy 里。

## 3. 有限状态机模型

游戏引擎遵循有限状态机协议：

```text
State(S0)
  -- Action(A1) -->
active RuleLayer accepts A1
  -- ActionResolutionResult / frame result -->
Controller resolves follow-up actions
  -- Effect[] -->
State(S1)
  -- checkEndState -->
State(S1) 或 EndState
```

每次 `dispatch(action)` 的标准流程：

1. 读取当前 `GameState`。
2. 校验 `Action` 是否符合当前状态。
3. 解析 `Action`，得到 `ActionResolutionResult`。
4. 递归解析 `ActionResolutionResult.actions` 中的后续 Action。
5. 如果 `ActionResolutionResult.frames` 非空，由 Controller 调度响应窗口。
6. 优先推进栈顶 `ResolutionFrame`。
7. 栈顶结算完成后，返回新的 `ActionResolutionResult`。
8. 顺序应用解析得到的领域 `Effect`。
9. 检查是否进入终止状态。

这个模型保证：

- 状态转移路径明确。
- 嵌套响应有统一机制。
- 测试可以从任意 `GameState + Action` 开始验证结果。
- 回放只需要重放初始状态和 `ActionLog`。

## 4. 结算栈（ResolutionStack）设计

术语说明：本文中文统一使用“结算栈”。英文代码命名建议保留 `ResolutionStack`，因为它准确表达了嵌套响应的 LIFO 结构，也方便和常见 engine / rules terminology 对齐。

### 4.1 设计目的

结算栈（`ResolutionStack`）用于表达“当前 Action 的结算需要临时切换到一个更小的规则上下文，并等待指定玩家或额外条件完成”。

典型场景：

- `杀` 等待目标使用 `闪`，并产生 `CancelShaResolutionAction`。
- `决斗` 等待双方轮流打出 `杀`。
- 濒死状态等待玩家按顺序出 `桃`。
- 群体锦囊按座位顺序逐个结算响应。

### 4.2 ResolutionFrame

`ResolutionFrame` 表示结算栈中的一个尚未完成的响应窗口。它不应该保存可执行函数实例，因为 `GameState` 必须可序列化、可存档、可回放。

从统一模型看，`ResolutionFrame` 可以理解成一个临时规则层。它临时改变：

- 当前允许行动的玩家集合。
- 当前玩家可执行的“阶段”或动作类型。
- 当前完成/失败判断标准。
- 当前完成后返回到上一层规则的结果 Action。

基础对局规则可以看作 stack 0，也就是没有额外 frame 时的默认规则层。结算栈顶 frame 是 stack N，拥有比 stack 0 更高的行动优先级。

注意：这里的“完成条件”不是整局游戏的胜利条件。stack 0 的终局条件是 `GameController.isEndState`，例如一方死亡或某阵营获胜；stack N 的完成条件只是该临时规则层的退出条件，例如“目标玩家是否使用了 `闪`”。

建议结构：

```ts
interface ResolutionFrame {
  id: string;
  sourceAction: Action;
  participants: ResolutionParticipant[];
  cursor: number;
  criterion: ResolutionCriterion;
  result: ResolutionResultActions;
  context: Record<string, unknown>;
}

interface ResolutionResultActions {
  success: Action[];
  failure: Action[];
  always: Action[];
}
```

字段说明：

- `sourceAction`：触发该结算帧的原始 Action。
- `participants`：参与结算的玩家和顺序。
- `cursor`：当前等待哪一名玩家；单人响应窗口可固定为 `0`。
- `criterion`：判断该结算是否满足的标准。
- `result.success`：条件满足时返回的 Action。
- `result.failure`：条件失败时返回的 Action。
- `result.always`：无论成功失败都必须返回的 Action，例如弃置已打出的牌。
- `context`：卡牌、目标、伤害来源等上下文。

不再需要 `expectedActions` 字段。可提交的响应 Action 应由 `criterion` 和当前 `GameState` 推导出来；最终返回的 Action 已经由 `success`、`failure`、`always` 三组结果表达。

### 4.3 ResolutionCriterion

`ResolutionCriterion` 不建议做成普通 enum，也不建议做成 class 实例。

- 只用 enum 太弱，无法携带目标玩家、要求卡牌、是否允许放弃等上下文。
- 用 class 会破坏 `GameState` 的纯数据结构，不利于序列化、回放和日志。

推荐使用“可序列化的判别联合类型 + Controller 侧 evaluator registry”：

```ts
type ResolutionCriterion =
  | CardRespondCriterion
  | ActionResponseCriterion
  | CardJudgementCriterion;

interface CardRespondCriterion {
  type: 'card_respond';
  cardIds: string[];
  passAllowed: boolean;
  successWhen: 'responded' | 'not_responded';
  requiredCount?: number;
  respondedCount?: number;
  failureWhen?: 'current_player_passed' | 'all_participants_passed';
}

interface ActionResponseCriterion {
  type: 'action_response';
  playerId: string;
  actionTypes: string[];
  passAllowed: boolean;
  successWhen: 'responded' | 'not_responded';
}

interface CardJudgementCriterion {
  type: 'card_judgement';
  reason: string;
  judgePlayerId: string;
  cardPattern: CardPattern;
}

```

初始设计只需要覆盖少数标准响应窗口，不追求一次定义完整三国杀规则全集：

- `CardRespondCriterion`：要求当前响应者提交指定牌。例如 `南蛮入侵` 要求提交 `杀`，`万箭齐发` 要求提交 `闪`，`决斗` 要求提交 `杀`。满足该 criterion 时不调用卡牌 `onPlay`。
- `ActionResponseCriterion`：要求某个玩家提交特定 Action。例如响应 `杀` 时使用 `闪`，`闪.onPlay` 产生 `CancelShaResolutionAction`，该 Action 满足当前 frame。
- `CardJudgementCriterion`：处理“判定”。推荐英文命名暂定为 `Judgement`，因为它表达的是翻开一张判定牌并检查花色/颜色/点数/牌名的流程；如果项目更偏好美式拼写，也可以统一改为 `Judgment`。

濒死求桃不需要独立的 `DyingRescueCriterion`。它可以建模为一个 pending 的 `CardRespondCriterion`：

```ts
const dyingRescueCriterion: CardRespondCriterion = {
  type: 'card_respond',
  cardIds: ['tao'],
  passAllowed: true,
  successWhen: 'responded',
  requiredCount: Math.max(1 - dyingPlayer.hp, 1),
  respondedCount: 0,
  failureWhen: 'all_participants_passed',
};
```

对应 `ResolutionFrame.context` 记录濒死目标：

```ts
context: {
  dyingPlayerId,
  rescueHpThreshold: 1,
}
```

每响应一张 `桃`，criterion 的 evaluator 返回 `HealAction(dyingPlayerId, 1)` 和弃置该桃的 Action，并递增 `respondedCount`。如果 `respondedCount >= requiredCount`，frame `completed`；否则更新 `cursor` 继续询问下一名响应者，返回 `pending`。如果所有参与者都放弃且 `respondedCount < requiredCount`，frame `completed` 并进入死亡相关 Action。

这几个类型不是最终全集。后续新增复杂锦囊、装备或武将技能时，可以继续扩展新的 criterion type，但必须保持 `ResolutionCriterion` 是纯数据，不能把函数或 class 实例塞进 `GameState`。

Controller 根据 `criterion.type` 找到对应 evaluator：

```ts
type CriterionResult =
  | {
      status: 'pending';
      frame: ResolutionFrame;
      actions: Action[];
    }
  | {
      status: 'completed';
      actions: Action[];
    };
```

`completed` 表示该 frame 已完成，可以弹栈。`pending` 表示当前响应已被接受，但该 frame 还没结束，需要用更新后的 frame 继续等待后续响应。

通常只有真正共享同一个流程游标的结算才需要 `pending`。例如濒死求桃要按响应顺序依次询问玩家，直到被救回或所有人都放弃。

### 4.4 栈的运行规则

当一个 `ResolutionFrame` 被压栈：

1. 当前 Action 解析暂停。
2. Controller 只接受栈顶帧允许的玩家 Action。
3. 玩家提交响应 Action。
4. Controller 用响应 Action 更新该帧的判断状态。
5. 如果该帧仍未完成，继续等待下一名玩家或下一轮响应。
6. 如果该帧完成，弹栈并返回一个或多个确定 Action。
7. 返回的 Action 继续被普通 Action 解析流程处理。

栈顶优先原则：

```text
只有 resolutionStack[resolutionStack.length - 1] 可以被推进。
```

这样可以支持嵌套结算。例如 `杀` 触发响应，响应中又可能触发技能或其他窗口，新窗口压栈后先完成，再回到原来的 `杀` 结算。

### 4.5 单人 frame 与 pending frame

使用规则：

```text
一个玩家、一个响应窗口 -> 单个 frame，响应后立刻 completed。
多个目标、但每个目标独立响应 -> 多个单人 frame。
一个共享流程、内部需要游标推进 -> 一个 pending frame。
```

`杀` 是单人 frame：目标玩家使用 `闪` 或放弃后，frame 立即完成。

`南蛮入侵` 和 `万箭齐发` 不应建成一个包含所有目标的大 frame。它们应该由卡牌 `onPlay` 方法按目标生成多个独立 frame，每个目标一个。这样更适合未来加入 `无懈可击`，因为每个目标的锦囊响应窗口都可以独立被取消或继续。

这些 frame 要求的是“打出”响应，而不是“使用”卡牌：

- 响应 `南蛮入侵` 时打出 `杀`，不调用 `杀.onPlay`。
- 响应 `万箭齐发` 时打出 `闪`，不调用 `闪.onPlay`。
- 响应 `决斗` 时打出 `杀`，不调用 `杀.onPlay`。

这些牌只用于满足当前 `ResolutionCriterion`，其牌面描述不生效。

为了保证座位顺序，不建议一次性把多个 frame 全部压入 LIFO 栈。采用 Option B：不引入 `QueueResolutionAction`，而是让 `ActionResolutionResult.frames` 自身表示一个按数组顺序执行的 frame queue。

```text
ActionResolutionResult.frames = [frameForB, frameForC, frameForD]
```

Controller 调度 `ActionResolutionResult.frames` 时，只把第一个 frame 压栈。当前 frame 完成后，再把下一个 frame 压栈。这样可以保持：

```text
南蛮入侵 -> B 响应 -> C 响应 -> D 响应
```

而不是因为栈的 LIFO 特性变成倒序。

这个设计保持了边界清晰：

- `Action` 表示玩家或规则意图。
- `Effect` 表示状态 delta。
- `ResolutionFrame` 表示临时规则层。
- `ActionResolutionResult.frames` 表示按顺序调度的响应窗口队列。
- Controller 负责把队列中的 frame 逐个压入结算栈。

濒死求桃是 pending frame：它不是多个彼此独立的窗口，而是同一个濒死流程。每名响应者放弃后，frame 更新 `cursor` 并返回 `pending`；每响应一张 `桃`，frame 更新 `criterion.respondedCount`。当 `respondedCount >= requiredCount` 时返回 `completed`；如果所有人都放弃且仍未达到 required count，也返回 `completed` 并产生死亡相关 Action。

### 4.6 结算栈作为临时规则层

结算栈可以被理解为“临时改变游戏规则和参与玩家的一层子规则”。这个视角可以简化规则模型：

```text
stack 0: 基础对局规则
stack 1: 当前卡牌/技能打开的响应规则
stack 2: 响应过程中再次打开的更高优先级规则
...
```

也可以把它理解为一个规则层栈：

```text
RuleLayerStack = [BaseGameRuleLayer, ...ResolutionFrameRuleLayer[]]
activeRuleLayer = RuleLayerStack.top()
```

当结算栈为空时，游戏运行在 stack 0：

- 当前玩家由回合和阶段决定。
- 合法行动由出牌阶段、弃牌阶段、当前模式等基础规则决定。
- 胜利条件由当前 `GameController` 决定，例如 1v1、身份局、1v3。

当结算栈非空时，栈顶 frame 临时覆盖 stack 0 的部分规则：

- 当前可行动玩家改为 frame 指定的参与者。
- 当前“阶段”可简化为该 frame 的单一响应阶段。
- 合法行动改为 frame 的 `criterion` 所允许的 Action。
- 退出条件改为 frame 的 `criterion` 是否满足或失败。
- 完成后的结果改为 frame 的 `result.success/failure/always`。

因此，普通对局和结算窗口可以使用同一个查询入口：

```ts
function getActiveRuleLayer(state: GameState): RuleLayer {
  const top = state.resolutionStack[state.resolutionStack.length - 1];
  return top ? frameToRuleLayer(top) : baseGameToRuleLayer(state);
}
```

`getLegalActions(playerId)` 不必到处判断特殊情况，而是先取当前活动规则层：

```text
activeRuleLayer = 栈顶 frame ? 栈顶临时规则层 : stack 0 基础规则层
legalActions = activeRuleLayer.legalActions(playerId, state)
```

这个发现可以简化设计，但不应该把 `ResolutionFrame` 完全等同于 `GameController`：

- `GameController` 仍负责模式级规则、终局判断、回合推进、Effect 应用和结算栈调度。
- `ResolutionFrame` 是可序列化数据，只描述一个局部响应窗口的临时规则。
- `ResolutionFrameRuleLayer` 是运行期适配器，负责把 frame 数据解释成合法行动与退出条件。
- stack 0 是完整游戏规则层；stack N 是局部临时规则层。

推荐抽象：

```ts
interface RuleLayer {
  participants: string[];
  legalActions(playerId: string, state: GameState): Action[];
  accept(action: Action, state: GameState): RuleLayerAcceptResult;
}

type RuleLayerAcceptResult =
  | {
      type: 'base_action';
      result: ActionResolutionResult;
    }
  | {
      type: 'frame_pending';
      frame: ResolutionFrame;
      actions: Action[];
    }
  | {
      type: 'frame_completed';
      actions: Action[];
    };
```

基础规则和结算帧都可以适配成 `RuleLayer`：

```text
BaseGameRuleLayer          -> stack 0
ResolutionFrameRuleLayer   -> stack N
```

这样统一了两个问题：

- “现在谁能行动？”
- “这个 Action 在当前规则下意味着什么？”

但终局判断仍由 `GameController.isEndState` 负责。结算帧里的完成条件不是整局游戏的胜利条件，而是该临时规则层的退出条件。

对 `dispatch(action)` 来说，这个模型也能减少分支：

```text
1. activeRuleLayer = getActiveRuleLayer(state)
2. 确认 action 属于 activeRuleLayer.legalActions(...)
3. activeRuleLayer.accept(action, state)
4. 如果 activeRuleLayer 是 stack N：
   - frame_pending: 更新栈顶 frame，继续等待
   - frame_completed: 弹出 frame，把返回 actions 交给普通 Action 解析
5. 如果 activeRuleLayer 是 stack 0：
   - base_action: 把 result 交给普通 Action 解析流程
6. 递归解析后续 actions，最终应用 effects
7. 由 GameController 检查整局 EndState
```

所以，这个发现真正简化的是“合法行动”和“响应窗口推进”的统一入口，而不是取消 Controller。Controller 仍是整局游戏的调度者；结算栈只是让某个局部规则短暂成为当前最高优先级规则。

### 4.7 ActionResolutionResult

`ActionResolutionResult` 是解析一个 `Action` 后得到的结果。它不是未来计划，所以不命名为 `ResolutionPlan`。

建议结构：

```ts
interface ActionResolutionResult {
  actions: Action[];
  frames: ResolutionFrame[];
}
```

含义：

- `actions`：需要立刻继续解析的后续 Action。
- `frames`：当前 Action 打开的响应窗口，需要由 Controller 调度。

`ActionResolutionResult` 不包含 `effects`。卡牌 `onPlay` 和高层 Action 解析只表达游戏意图和响应窗口；Controller 的底层原子 Action 解析可以直接返回 `Effect[]`。

因此不需要额外引入 `PrimitiveActionResolutionResult`。如果一个类型只是包了一层 `effects: Effect[]`，而没有携带错误、日志、延迟执行等额外语义，它会让模型更绕。建议保持简单：

```text
High-level Action -> ActionResolutionResult
Primitive Action  -> Effect[]
```

例如 `桃.onPlay` 返回 `HealAction` 和 `CardDiscardAction`；随后 Controller 把 `HealAction` 解析为 `HealEffect`，把 `CardDiscardAction` 解析为 `CardMoveEffect`。这样仍然能避免卡牌规则直接修改状态，也能避免 `Action[]` 中混入 `Effect`。

`frames` 非空的条件是：当前 Action 无法在不询问其他玩家的情况下完成结算。

典型例子：

- `杀`：产生一个要求目标使用 `闪` 并返回 `CancelShaResolutionAction` 的 frame。
- `决斗`：产生一个轮流要求双方打出 `杀` 的 frame。
- `南蛮入侵`：按目标产生多个要求打出 `杀` 的单人 frame。
- `万箭齐发`：按目标产生多个要求打出 `闪` 的单人 frame。
- 濒死求桃：产生一个共享流程游标的 pending frame。
- 未来的 `无懈可击`：产生询问可响应玩家是否抵消锦囊的 frame。

不需要 frame 的例子：

- `桃`：返回 `HealAction` 和 `CardDiscardAction`。
- 装备牌：返回装备相关 Action 和卡牌移动 Action。
- `无中生有`：返回 `DrawCardAction` 和 `CardDiscardAction`。
- 结束出牌：返回 `NextPhaseAction`。
- 弃牌：返回一个或多个 `CardDiscardAction`。

`ResolvableAction` 不再作为独立抽象。过去它想表达“这个 Action 现在无法完成，需要等待响应”，但这个语义已经由 `ResolutionFrame` 承担。更准确的关系是：

```text
Action 解析结果 -> ActionResolutionResult
ActionResolutionResult.frames -> 需要等待的 ResolutionFrame
```

而不是：

```text
Action -> ResolvableAction -> PushResolutionEffect
```

## 5. 3gs 规则语言与解释器模型

三国杀规则可以进一步理解为一个解释器系统：

```text
基础游戏规则 = GameController host runtime / VM
规则解释 = RuleInterpreter
卡牌与武将技能 = importable 3gs rule resources
玩家 Action = 对已导入规则函数的调用
解释过程 emit Action / ResolutionFrame / Effect
Effect 应用后改变 GameState
```

这里暂时把这门规则语言称为 `3gs`。它不是为了替代 TypeScript 写完整应用逻辑，而是为了用规范、可审查、可测试、可导入的形式描述卡面和武将牌面的规则。

### 5.1 GameController、RuleInterpreter 与 3gs Resource

基础游戏规则仍由 `GameController` 和 core engine 负责：

- turn / phase 流转。
- 当前谁可以行动。
- `GameState` 存储和更新。
- 结算栈调度。
- `Effect` 应用。
- 终局判断。

`RuleInterpreter` 负责规则资源的解释：

- import cards / heroes 的 3gs source。
- parse 成 AST。
- validate AST。
- compile 成 executable rule functions。
- 根据 `Action` 或 timing event 找到对应函数。
- 执行函数，返回 `ActionResolutionResult`。

卡牌、装备、锦囊和武将技能则作为外部规则资源导入：

```text
resources/cards/basic/sha.3gs
resources/cards/basic/shan.3gs
resources/cards/basic/tao.3gs
resources/heroes/wei/caocao.3gs
resources/heroes/shu/guanyu.3gs
```

在游戏开始时，Controller 根据模式和配置创建 `RuleInterpreter`，并导入需要的 3gs resource：

```text
GameController boot
  -> RuleInterpreter.load(base card resources)
  -> RuleInterpreter.load(selected hero resources)
  -> RuleInterpreter.parse / validate / compile
  -> RuleInterpreter registers exported functions / callbacks
  -> start game loop
```

推荐接口：

```ts
interface RuleInterpreter {
  getLegalActions(ctx: RuleRuntimeContext, playerId: string): Action[];

  interpretPlayerAction(
    ctx: RuleRuntimeContext,
    action: PlayerAction,
  ): ActionResolutionResult;

  interpretTimingWindow(
    ctx: RuleRuntimeContext,
    event: TimingEvent,
  ): ResolutionFrame[];
}

interface RuleRuntimeContext {
  state: GameState;
  controller: GameController;
  activeFrame?: ResolutionFrame;
}
```

### 5.2 Action 作为函数调用

当用户使用一张牌时，客户端发送的仍然是结构化 `Action`：

```ts
CardPlayAction {
  type: 'card_play',
  playerId: 'p1',
  cardInstanceId: 'c_sha',
  cardId: 'sha',
  targets: ['p2'],
}
```

从解释器角度看，这相当于一次函数调用：

```text
RuleInterpreter.call(imported.cards.sha.onPlay, ctx, action)
```

也就是说：

```text
CardPlayAction("sha")
  -> lookup resource "sha"
  -> RuleInterpreter calls exported fn onPlay
  -> RuleInterpreter executes compiled 3gs function
  -> emit ActionResolutionResult
```

`CardRespondAction` 仍然不同。它表示“打出”来满足当前 `ResolutionCriterion`，不调用该牌的 `onPlay` 函数。

### 5.3 3gs 函数的输出

3gs 函数不直接修改 `GameState`。它只能 emit 以下内容：

```text
Action
ResolutionFrame
Effect emit request
```

更精确地说，卡牌/技能函数优先 emit 高层 `Action` 和 `ResolutionFrame`：

```text
3gs function -> ActionResolutionResult
```

底层 primitive action 再由 host interpreter 解析成 `Effect[]`：

```text
DamageAction -> DamageEffect
HealAction -> HealEffect
CardDiscardAction -> CardMoveEffect
```

这样可以保持边界：

- 3gs 描述规则意图。
- host runtime 控制状态转移。
- 只有 `Effect` 真正修改 `GameState`。

### 5.4 3gs 与 AST

3gs resource 应被解析成可序列化或可检查的 AST / IR，而不是在 `GameState` 里保存函数实例。

推荐流程：

```text
3gs source
  -> parse
  -> RuleAst
  -> validate
  -> RuleModule
  -> interpreter executes RuleModule exports
```

示意：

```ts
interface RuleModule {
  id: string;
  kind: 'card' | 'hero';
  exports: Record<string, RuleFunctionAst>;
  timingFunctions: TimingRuleFunctionAst[];
}

interface RuleFunctionAst {
  name: string;
  params: RuleParam[];
  body: RuleStatementAst[];
}
```

编译后的 registry 可以长这样：

```ts
interface CompiledRuleModule {
  id: string;
  kind: 'card' | 'hero';
  functions: {
    canPlay?: RuleFunction;
    onPlay?: RuleFunction;
  };
  timingFunctions: TimingRuleFunction[];
}

interface TimingRuleFunction {
  timing: TimingEventType;
  canUse: RuleFunction;
  onUse: RuleFunction;
}
```

短期实现可以继续用 TypeScript `CardRule` 作为 host adapter；中长期目标是让 `CardRule.onPlay` 只负责调用对应的 3gs exported function。

```text
当前阶段:
  CardRule.onPlay = TypeScript handwritten rule

目标阶段:
  CardRule.onPlay = run3gs(resource.exports.onPlay, ctx, action)
```

`杀` 和 `闪` 会被解释成不同类型的函数：

```text
杀:
  onPlay(ctx, action) -> ActionResolutionResult

闪:
  timing function onShaResolutionStarted(ctx, event) -> ActionResolutionResult
```

也就是说，`杀` 是主动使用函数；`闪` 是某个 timing window 中可被调用的响应函数。

### 5.5 3gs 中的控制流与结算栈

3gs 需要表达“等待其他玩家响应”的控制流。这个控制流不应该用普通函数阻塞实现，而应 emit `ResolutionFrame`：

```text
sha.onPlay:
  emit frame {
    participants: [target]
    criterion: ActionResponseCriterion(cancel_sha_resolution)
    success: [DamageAction(target, 1)]
    failure: []
    always: [CardDiscardAction(sha)]
  }
```

从语言角度看，`ResolutionFrame` 类似一个 suspended continuation：

```text
await response {
  success -> ...
  failure -> ...
  always -> ...
}
```

但在实现上它必须是纯数据，因为它要进入 `GameState.resolutionStack`，支持网络等待、存档和回放。

### 5.6 3gs 与技能触发

武将技能也应作为 3gs resource 导入。技能不是直接订阅一个全局 event bus，而是导出明确的 callback：

```text
export onBeforeDamageTaken(ctx, action)
export onAfterDamageTaken(ctx, effect)
export onAfterCardDiscarded(ctx, effect)
```

Controller 在解释对应 Action / Effect 前后通知 `RuleInterpreter` 打开 timing window。`RuleInterpreter` 找到匹配的 exported callbacks 并执行。callback 的返回值仍然是 `ActionResolutionResult`，由 `GameController` 继续调度和应用。

### 5.7 设计原则

- `3gs` 是规则描述语言，不是网络协议。
- `3gs` resource 是可导入模块，不直接拥有 `GameState`。
- `3gs` 函数通过 emit 表达意图，不直接 mutate state。
- `GameController` 是 host runtime / VM。
- `RuleInterpreter` 是 3gs evaluator。
- `GameState` 是 VM state。
- `ResolutionFrame` 是可序列化的 suspended continuation frame。
- `Effect` 是唯一提交到 `GameState` 的状态 delta。
- 短期允许 TypeScript handwritten `CardRule`，但接口要朝 3gs interpreter adapter 收敛。

## 6. 卡牌规则委托

卡牌规则应该放在卡牌相关代码中，而不是散落在 Controller 中。

建议接口：

```ts
interface CardRule {
  id: string;
  onPlay(ctx: CardRuleContext, action: CardPlayAction): ActionResolutionResult;
  canPlay(ctx: CardRuleContext, action: CardPlayAction): boolean;
}
```

Controller 收到 `CardPlayAction` 后：

1. 根据 `cardId` 找到对应 `CardRule`。
2. 调用 `cardRule.canPlay(...)` 验证基础合法性。
3. 调用 `cardRule.onPlay(...)` 得到 `ActionResolutionResult`。
4. Controller 负责继续解析其中的 `actions`，并调度其中的 `frames`。

Controller 保留的职责：

- 管理状态机。
- 管理栈。
- 应用 Effect。
- 提供模式相关判断，例如胜利条件、座位顺序、身份阵营。

CardRule 保留的职责：

- 定义卡牌如何被使用。
- 定义卡牌需要什么响应。
- 定义卡牌结算成功或失败后产生什么 Action。
- 定义卡牌无论成功失败都需要产生的后续 Action。
- 定义卡牌是否打开新的响应窗口。

## 7. 示例：桃

玩家使用 `桃`：

```text
Client -> CardPlayAction(playerId, cardId: "tao", cardInstanceId)
```

Controller 流程：

1. 收到 `CardPlayAction`。
2. 找到 `桃` 的 `CardRule`。
3. `桃.onPlay(...)` 返回 `ActionResolutionResult`：

```text
actions:
  - HealAction(playerId, 1)
  - CardDiscardAction(cardInstanceId)
frames: []
```

4. Controller 继续解析这两个 Action。
5. 得到两个 Effect：

```text
HealEffect(playerId, 1)
CardMoveEffect(cardInstanceId, hand -> discardPile)
```

6. 依次应用 Effect。
7. 检查终止状态。
8. 广播新的 `GameState`。

这个例子没有压入结算栈（`ResolutionStack`），因为它不需要等待其他玩家响应。

## 8. 示例：杀

玩家使用 `杀`：

```text
Client -> CardPlayAction(playerId, cardId: "sha", targetId)
```

Controller 流程：

1. 收到 `CardPlayAction`。
2. 找到 `杀` 的 `CardRule`。
3. `杀.onPlay(...)` 返回 `ActionResolutionResult`。
4. 该结果包含一个 `ResolutionFrame`，要求目标玩家使用 `闪` 来产生 `CancelShaResolutionAction`，或者放弃响应。
5. Controller 调度这个 `ResolutionFrame`：

```text
participants: [targetId]
criterion:
  type: action_response
  playerId: targetId
  actionTypes: ["cancel_sha_resolution"]
  passAllowed: true
  successWhen: not_responded
result:
  success: [DamageAction(targetId, sourcePlayerId, 1)]
  failure: []
  always: [CardDiscardAction(shaCardInstanceId)]
```

6. 当前 `杀` 的解析暂停。
7. 目标玩家响应：

- 如果使用 `闪`，`闪.onPlay(...)` 返回 `CancelShaResolutionAction`，该 frame 返回空的 `failure` actions。
- 如果放弃，解析为 `DamageAction`。

8. 无论目标是否使用 `闪`，`CardDiscardAction(shaCardInstanceId)` 都会继续解析。
9. Controller 对结果 Action 继续解析：

```text
CardDiscardAction -> CardMoveEffect
DamageAction -> DamageEffect
```

10. 依次应用所有 Effect。

最终结果：

```text
杀 + 未闪 -> 弃置杀 + 目标受伤
杀 + 闪   -> 弃置杀 + 无伤害
```

## 9. Action 解析模型

建议将 Action 解析拆成两层：

### 9.1 High-level Action

玩家或规则表达的动作：

- 使用卡牌。
- 打出卡牌。
- 发动技能。
- 结束阶段。
- 造成伤害。
- 进入濒死。

### 9.2 Primitive Action

更接近 Effect 的动作：

- 移动卡牌。
- 增减体力。
- 抽牌。
- 改变阶段。
- 设置获胜者。

High-level Action 可以递归解析成 High-level Action 或 Primitive Action。Primitive Action 最终解析为 Effect。

```text
CardPlayAction("sha")
  -> ActionResolutionResult
    actions: []
    frames: [requireShanFrame]

requireShanFrame completed
  -> ActionResolutionResult
    actions: [DamageAction 或无伤害 Action, CardDiscardAction]
    frames: []

DamageAction -> DamageEffect
CardDiscardAction -> CardMoveEffect
```

## 10. 技能触发 callback

三国杀中很多武将技能会在特定时机触发，例如伤害前、受到伤害后、弃牌后、回合开始时。新引擎需要支持这些时机，但不需要先引入复杂的通用事件总线。推荐设计为由 Controller 在解析特定 Action 时调用已注册的技能 callback。

技能 callback 的核心原则：

- callback 不直接修改 `GameState`。
- callback 返回额外的 `ActionResolutionResult`。
- callback 产生的 Action 或 frame 仍然走统一的 Action 解析和结算栈流程。
- callback 执行完成后，原 Action 再继续解析为 `Effect[]`。

建议接口：

```ts
interface SkillTriggerHandler {
  skillId: string;
  ownerId: string;

  onBeforeDamageTaken?(
    ctx: SkillTriggerContext,
    action: DamageAction,
  ): ActionResolutionResult;

  onAfterDamageTaken?(
    ctx: SkillTriggerContext,
    effect: DamageEffect,
  ): ActionResolutionResult;

  onAfterCardDiscarded?(
    ctx: SkillTriggerContext,
    effect: CardMoveEffect,
  ): ActionResolutionResult;
}
```

以受到伤害为例：

```text
resolve DamageAction(targetId, sourceId, amount)
  -> collect target player's onBeforeDamageTaken callbacks
  -> run callback(s), get extra ActionResolutionResult
  -> resolve extra actions / frames first
  -> DamageAction -> DamageEffect
  -> apply DamageEffect
  -> run onAfterDamageTaken callbacks
  -> resolve extra actions / frames
```

例如某个技能在“受到伤害前”触发，Controller 解析 `DamageAction(playerId)` 时应先调用该玩家注册的 `onBeforeDamageTaken` callback。如果 callback 弹出新的 Action 或结算帧，Controller 先完成这些新结算，再继续把原 `DamageAction` 解析为 `DamageEffect` 并应用。

这个设计保留了 Action/Effect 的边界：

- 技能触发时机由 Controller 调度。
- 技能效果仍表达为 Action。
- 真正改变状态的仍然只有 Effect。
- 如果技能打开响应窗口，仍然通过结算栈处理。

如果未来需要更通用的事件系统，可以把这些 callback 视为一组强类型事件入口；但当前设计优先使用明确 callback，而不是字符串事件名加全局 pub/sub。

## 11. 终止状态判断

终止状态判断由具体 `GameController` 决定。

### DualGameController

```text
任意一方死亡 -> 另一方获胜
```

### IdentityGameController

未来可实现：

```text
主公死亡且反贼/内奸条件满足
反贼全部死亡且内奸条件满足
```

### OneVsThreeGameController

未来可实现：

```text
1 方死亡 -> 3 方获胜
3 方全部死亡 -> 1 方获胜
```

### TestController

测试控制器可以允许：

- 禁用自动胜利。
- 指定固定胜利判断。
- 在任意状态直接终止。

## 12. 客户端/服务端协议边界

引擎层协议应非常简单：

```text
Client -> Action
Server -> GameState
```

这里的 “Server” 指运行在服务端的整体游戏服务，不等同于核心规则引擎。核心规则引擎只产出完整 `GameState`；玩家可见视图由核心规则引擎之外的 View Projection / Presenter 层派生。

推荐边界：

```ts
GameController.dispatch(action): GameState

projectPublicGameState(state: GameState): PublicGameView
projectPlayerGameState(state: GameState, playerId: string): PlayerGameView
```

服务端职责：

- 接收 HTTP/WebSocket/TUI/机器人发来的 Action。
- 调用 `GameController.dispatch(action)`。
- 保存完整 `GameState`。
- 调用 View Projection / Presenter 层，根据玩家身份裁剪公开视图和私有视图。
- 广播裁剪后的玩家视图。

引擎职责：

- 不知道 Action 来自 HTTP、WebSocket 还是测试。
- 不知道页面如何渲染。
- 不知道 TUI 如何选择卡牌。
- 不直接管理 AI 策略。
- 不直接生成 `PublicGameView` 或 `PlayerGameView`。
- 只维护完整、权威、包含隐藏信息的 `GameState`。

客户端职责：

- 读取 `GameState`。
- 展示当前状态。
- 只提交用户选择的 `Action`。
- 不自行推导隐藏信息。

## 13. 合法行动

每个 Controller 应提供：

```ts
getLegalActions(playerId: string): Action[]
```

它应先取得当前活动规则上下文，再生成合法行动：

- 如果没有结算栈，活动上下文是 stack 0 基础规则，当前回合玩家可以做出当前阶段允许的行动。
- 如果有结算栈，活动上下文是栈顶 frame，只有 frame 指定的玩家可以提交该 frame 允许的 Action。
- 非当前玩家不能提交无关行动。
- 死亡玩家不能行动，除非特殊规则允许。

AI、TUI、浏览器都应该只从 `getLegalActions` 中选择行动。

## 14. 回放与测试

重构后的引擎应该天然支持回放：

```text
InitialGameState + ActionLog -> FinalGameState
```

推荐测试维度：

- 单个 Effect 应用测试。
- 单个 Action 解析测试。
- 卡牌规则测试。
- 结算栈推进测试。
- Controller 终止状态测试。
- 完整对局回放测试。
- 非法 Action 拒绝测试。

每个测试都应尽量固定初始 `GameState`，避免依赖随机牌堆。

## 15. 推荐模块结构

建议新引擎放在独立目录，避免和现有实现互相污染：

```text
src/game/
  core/
    state.ts
    action.ts
    effect.ts
    controller.ts
    resolution.ts
    interpreter.ts
    rule_module.ts
    rule_registry.ts
  controllers/
    dual.ts
    identity.ts
    one_vs_three.ts
    test.ts
  language/
    ast.ts
    parser.ts
    validator.ts
    module.ts
  resources/
    cards/
      basic/
        sha.3gs
        shan.3gs
        tao.3gs
      tricks/
      equip/
    heroes/
      wei/
      shu/
      wu/
  cards/
    index.ts
    basic/
      sha.ts
      shan.ts
      tao.ts
    tricks/
    equip/
  skills/
  doc/
    game_engine_redesign.md
```

迁移时可以让旧 `server/game` façade 继续运行，新 `src/game` 先通过测试验证，再逐步替换服务端接入。

## 16. 设计约束

- 所有状态变化必须通过 `Effect`。
- 所有玩家输入必须表现为 `Action`。
- 所有等待响应必须通过结算栈（`ResolutionStack`）。
- 卡牌和武将规则最终应收敛为可导入的 3gs resource。
- 3gs resource 只能 emit Action / ResolutionFrame，不能直接修改 `GameState`。
- 技能触发通过 Controller 调用强类型 callback 或 3gs exported callback，callback 返回 Action，不直接修改 `GameState`。
- Controller 只做 host runtime、模式规则、状态机推进、Effect 应用和结算调度。
- RuleInterpreter 负责解释 3gs resource，不负责直接修改 `GameState`。
- 引擎不依赖网络层、UI 层或机器人实现。
- `GameState` 必须可序列化。
- `ActionLog` 必须足以支持回放。

## 17. 待进一步打磨的问题

以下问题需要后续继续细化：

- 3gs 的最小语法、类型系统和 AST 结构。
- 卡牌和技能的时机窗口如何统一表达为 3gs exported callback。
