# 核心算法全 GDScript 迁移方案与 Unity/Godot 对比

制定日期 2026-11-27。仓库 `D:\OCS\OCS_EASTERN`，`main` 基线 `afa29a4`。本文不是实施记录，而是把现有 Node/TypeScript 规则引擎迁入 Godot 的设计基线。

## 0 结论

- 现有项目已经是 **Godot 客户端 + Node/TypeScript 规则引擎**，不是纯 Godot。
- **不迁移到 Unity**。对本项目而言，Unity 的强项（3D、重型资产管线、商业生态）基本用不上，而迁移会同时丢掉现有 Godot UI 和 TypeScript 规则资产。
- 按用户约束，迁移采用 **Godot 4.7 + 全 GDScript**，不保留 Node 运行时，不引入 C# 作为主方案。
- 这是一次规则内核迁移，不是 UI 换皮。现有规则源码约 1.9 万行、通规约 3 千行、测试约 1.4 万行；核心风险是规则与测试基线丢失，不是 GDScript 语法不会写。
- 迁移必须按 **08 纵向切片 → 01/09 战役 → 全模块/全测试** 分阶段推进；在差分测试归零前保留 TypeScript 作为 oracle，不先删 Node。

## 1 现有项目总结

### 1.1 目标与当前形态

项目是 OCS v4.3《第三个冬天》的桌面兵棋。目标形态是可独立安装、可本地热座、后续可联网双人的 Godot 桌面游戏。当前规则、命令校验、回合推进、存档和视图投影全部在 Node/TypeScript 中完成；Godot 只负责画面、输入和桥接。

当前运行链路：

```text
Godot 4.7（menu.tscn / main.tscn）
  → bridge/eastern_bridge.mjs
  → desktop/local/controller.mjs
  → openLocalScorpion / dispatch / projectLocalScorpion
  → Node 规则与存档
```

08 瓶中蝎是唯一接通 Godot 地图的剧本；01/09 只有本机夹具，02–07 只有资料/菜单层。主页面五模式中只有单机 SOLO 为真实可用，联机 PVP、联机多人 PVP、单机 PVE、联机 PVE 都是入口占位。

### 1.2 分层与职责

| 层 | 当前位置 | 职责 |
| --- | --- | --- |
| 通规判定 | `packages/series/src` | OCS v4.3 通用规则、计算、回合阶段、随机、补给搜索 |
| 命令记录 | `packages/match-core/src` | `Command`、`MatchRecord`、修订号、回执去重 |
| 第三冬专规 | `games/third-winter/src/ttw` | 作品例外、天气、姿态、RVGK、Kessel、剧本特定参数 |
| 数据导入 | `games/third-winter/src/import` | 实库 JSON 读取、格号归一、单位/初设/增援装配 |
| 对局会话 | `games/third-winter/src/match` | 命令分派、阶段推进、待决应答、状态写入 |
| 视图投影 | `games/third-winter/src/view` | 按观察方输出地图、算子、动作、辅助卡和待答方 |
| 桌面适配 | `games/third-winter/desktop/local` | 本地控制器、存档、交互菜单、Node 桥接 |
| Godot 画面 | `games/third-winter/godot` | 主页面、剧本菜单、地图绘制、输入转发 |

源码依赖约束来自 [`AGENTS.md`](../../../AGENTS.md)：`series` 不依赖作品、文件读取和 UI；`ttw/import` 不依赖 `match/view`；`match` 不依赖 `view`；源码不反向依赖桌面入口。这条边界是迁移时最值得保留的资产。

### 1.3 规模

| 范围 | 文件 | 行数/大小 |
| --- | ---: | ---: |
| Godot 客户端脚本 | 8 | 约 1,147 行 |
| 第三冬 `src`（规则、导入、投影、对局） | 262 | 约 19,400 行 |
| 其中 `src/match` | 168 | 约 14,800 行 |
| 其中 `src/import` | 24 | 约 1,680 行 |
| 其中 `src/ttw` | 55 | 约 2,040 行 |
| 其中 `src/view` | 14 | 约 823 行 |
| `packages/series/src` | 48 | 约 2,981 行 |
| `desktop/local` | 23 | 约 3,110 行 |
| 测试 | 135 | 约 14,000 行，629 个用例 |
| 实库数据 | 13 个文件 | 约 5.36 MB |
| `dist` 图表/派生数据 | 88 个文件 | 约 64 MB |

外部 npm 依赖只有仓库内 `@ocs-eastern/series` 和 `@ocs-eastern/match-core`，没有第三方规则库。这对 GDScript 迁移是好消息：算法本身不依赖 Node 生态。

### 1.4 核心算法特征

1. **纯函数规则**：状态进、状态出；命令提交后返回新 `MatchRecord`。
2. **命令信封**：`{id, expectedRevision, action}`；同一方同一 `id` 重试会命中去重回执，过期修订被拒绝。
3. **确定性随机**：mulberry32，种子、内部状态和抽取次数入档；禁止 `Math.random`。
4. **分层规则**：通规 `series` → 第三冬专规 `ttw` → 剧本覆盖；高层覆盖低层，低层不反向依赖高层。
5. **按方投影**：`view` 只返回观察方可见信息；地图、算子、动作、待答方由同一状态派生。
6. **数据驱动**：单位、地图、初设、增援、图表从实库 JSON 读入，规则不硬编码印刷值。
7. **高测试密度**：629 个用例覆盖成功、拒绝、邻接规则、骰序、双方视图和重复提交。

## 2 Unity 与 Godot 对比

### 2.1 技术对比

| 维度 | Godot 4.7 | Unity（Unity 6 一类） | 对本项目的影响 |
| --- | --- | --- | --- |
| 授权与费用 | MIT，开源，无版税 | 订阅/许可制，条款随版本和营收变化 | 小团队自用和分发，Godot 更简单 |
| 主语言 | GDScript；另有 C#（.NET 版） | C# | Unity 的 C# 更适合重规则，但会引入新的运行时和重写 |
| 2D/六角格 | 2D、Control、CanvasItem 足够 | 2D 工具成熟，但项目通常按 3D 管线组织 | 本项目是 2D 算子地图，Godot 更轻 |
| UI | Control 节点、主题、场景组合 | uGUI/UI Toolkit，功能多但层级重 | 现有主页面/剧本菜单已在 Godot，迁 Unity 要重做 |
| 编辑器迭代 | 场景启动快，脚本改动即时 | 编译/域重载较慢，工程更重 | 规则调试和 UI 迭代 Godot 更快 |
| 无头测试 | `--headless` 直接跑脚本 | `-batchmode` 可行，但工程和授权环境更重 | Godot 更适合把规则测试放进 CI |
| 资产管线 | 轻量，2D 贴图/字体/JSON 足够 | 强，适合 3D、动画、大型美术 | 本项目没有 3D/动画需求 |
| 生态与插件 | 较小但够用 | Asset Store、商业插件、人才池更大 | 本项目规则自研，外部插件价值低 |
| 导出体积 | 通常较小 | 通常较大，运行时依赖多 | 单机桌面分发 Godot 更合适 |
| 联机 | 高层多人 API，权威服务器仍需自建 | Netcode/第三方方案多 | 两者都不能替代规则服务器，不构成决定因素 |
| 现有迁移成本 | 保留现有 UI，只迁规则 | UI 重做 + 规则迁 C# + 新工程 | Unity 成本明显更高 |

### 2.2 结论

**不迁 Unity。** Unity 的优势集中在 3D、重型资产和商业生态；本项目是回合制六角格兵棋，核心是规则确定性、测试和 2D 地图，Godot 更贴合。迁移到 Unity 还会把“规则迁移”变成“规则迁移 + UI 重做 + 新构建链”，没有必要。

Godot 的短板也要承认：GDScript 的类型系统、重构工具和性能不如 C#。本项目用全 GDScript 时，必须用强类型写法、边界校验、golden 测试和性能基准补足，不能靠动态字典自由生长。

## 3 全 GDScript 目标架构

### 3.1 目录

```text
games/third-winter/godot/
  scripts/
    core/            # 类型、命令、修订、随机、回合、错误、深拷贝
    rules/
      series/        # OCS v4.3 通规
      ttw/           # 第三冬专规
    match/
      scorpion/      # 08 瓶中蝎
      campaign/      # 01/09 等战役
    view/            # 按方投影
    data/            # JSON 读取、归一、指纹
    session/         # 原生对局会话，替代 desktop/local
  tests/
    runner.gd        # 无头测试入口
    vectors/         # 从 TS oracle 导出的命令/视图快照
  data/              # 归一后的运行数据（或 res:// 外部资源）
```

### 3.2 依赖规则

- `core`、`rules`、`match`、`view` 全部继承 `RefCounted`，不挂 `Node`，不依赖 `SceneTree`、UI 和 `FileAccess`。
- 只有 `data/` 和 `session/` 允许碰文件、JSON、`user://`；规则层接收已归一的数据对象。
- `view` 只读状态，不写状态；`match` 不依赖 `view`；`rules` 不依赖 `match`。
- UI 只调用 `session.submit(command)` 和 `session.project(viewer)`，不再拼接 Node 进程和 stdio。
- 规则层不调用 `OS.execute`、不启动子进程；纯 Godot 运行时不再有 Node。

### 3.3 GDScript 写法约束

- 所有公开函数写参数和返回类型；容器尽量用 `Array[T]`、`Dictionary` 加边界 schema 校验。
- 规则核心不使用 `Variant` 作为业务类型；JSON 进入时在 `data` 边界归一。
- 状态以 JSON 兼容的 `Dictionary`/`Array` 为主，便于存档和与 TS golden 对比；关键记录用 `class_name` 封装（`Command`、`MatchRecord`、`RngState`）。
- 不使用全局可变单例保存对局状态；`AppState` 只保存 UI 选择。
- 函数、变量 `snake_case`；保留外部 JSON 的 `camelCase` 字段名，避免迁移时改协议。
- 规则模块不 `print` 调试；错误通过 `Result`/错误码返回，测试用断言。
- 每个规则模块带一个可独立运行的测试入口或向量文件，不依赖 UI 场景。

## 4 核心算法迁移映射

### 4.1 基础primitive

| TS 模块 | GDScript 目标 | 迁移要点 |
| --- | --- | --- |
| `packages/series/src/state-types.ts` | `core/state_types.gd` | `Side` 用枚举/字符串常量；`RngState`、`DiceRoll` 用 `class_name` |
| `packages/series/src/dice.ts` | `core/dice.gd` | 骰面、掷骰结果、拒绝采样辅助 |
| `packages/series/src/rng.ts` | `core/rng.gd` | mulberry32 精确复刻；32 位整数掩码；固定种子测试向量 |
| `packages/series/src/turn.ts` | `core/turn.gd` | 阶段顺序、行动方、`advancePlayerTurn` |
| `packages/series/src/zoc.ts` | `core/zoc.gd` | ZOC 判定，纯函数 |
| `packages/match-core/src/command-log.ts` | `core/command_log.gd` | `Command`、`MatchRecord`、回执去重、过期修订拒绝 |
| `packages/series/src/counter-pool.ts`、`pool-draw.ts` | `core/counter_pool.gd`、`core/pool_draw.gd` | 有限池、无放回抽取、抽取计数 |

### 4.2 通规 `series`

按依赖和风险分四组迁移：

| 组 | 模块 | 目标 |
| --- | --- | --- |
| 移动/地形 | `ground-map`、`ground-terrain`、`ground-movement`、`ground-logistics`、`rail-conversion`、`rail-transport`、`airfield-work`、`hedgehog-work` | `rules/series/movement/*.gd` |
| 战斗/补给 | `combat`、`fire-timing`、`attrition`、`supply-network`、`trace-path`、`trace-targets`、`supply-progress`、`internal-stocks`、`extender-conversion`、`breakdown`、`consolidation`、`rebuild`、`reinforcement`、`reserve`、`breakout`、`cleanup` | `rules/series/combat/*.gd`、`rules/series/supply/*.gd` |
| 空军/特殊 | `air`、`air-mission`、`air-transport`、`airbase`、`fuel`、`trainbusting`、`transport-capture` | `rules/series/air/*.gd`、`rules/series/special/*.gd` |
| 流程/模式 | `modes`、`initiative`、`setup-workflow` | `rules/series/flow/*.gd` |

重点模块：

- `modes.ts`（约 14 KB）：模式合法性、预备释放、阶段可动性、ZOC/运输/工程/刺猬堆叠、战略结束补给的派生。
- `supply-network.ts`（约 11 KB）+ `trace-path.ts`（约 4.3 KB）：补给网络和 Dijkstra/BFS；这是最需要性能验证的算法。
- `combat.ts`（约 8.6 KB）：CRT、炮击、地形倍率、损失分配。
- `air-mission.ts`（约 10 KB）：七步任务、4 机上限、天气/阶段门、拦截、返航。
- `fuel.ts`（约 7.5 KB）、`setup-workflow.ts`（约 7.1 KB）、`extender-conversion.ts`（约 7 KB）、`transport-capture.ts`（约 6.7 KB）：规则多、状态变化多，适合单独切片。

### 4.3 第三冬专规 `ttw`

| 目录 | 目标 | 说明 |
| --- | --- | --- |
| `ttw/scorpion`（15 文件） | `rules/ttw/scorpion/` | 08 天气、初设、到达、地形费用、战斗地形 |
| `ttw/campaign`（24 文件） | `rules/ttw/campaign/` | 01/09 天气、补给配额、增援、胜利、工事、游玩区域 |
| `ttw/air`（2 文件） | `rules/ttw/air/` | 任务许可、空投资格 |
| `ttw/axis`（1 文件） | `rules/ttw/axis/` | Kessel 特例 |
| `ttw/front-posture.ts` 等根文件 | `rules/ttw/*.gd` | 姿态、事件、轨道等作品级规则 |

第三冬专规依赖通规默认，再叠加例外；迁移时保持“调用 series 默认 → 修正/拒绝”的顺序，不在 GDScript 里把例外写回通规。

### 4.4 对局层 `match`

| 范围 | 当前规模 | 目标 | 迁移顺序 |
| --- | ---: | --- | --- |
| 08 瓶中蝎 | 65 文件、约 5,800 行 | `match/scorpion/` | 第 1 个纵向切片 |
| 01/09 战役 | 87 文件、约 7,900 行 | `match/campaign/` | 第 2 个切片 |
| 共享会话辅助 | 16 文件、约 1,100 行 | `match/shared/` | 随 08 一起 |
| 会话入口 | `scorpion-session.ts`、`campaign-match.ts` | `match/scorpion_session.gd`、`match/campaign_match.gd` | 先保持“命令分派只编排” |

关键迁移点：

- `campaign-match.ts` 的 `CampaignTurnContext` 是大量回调集合（`resolveEntry`、`hqKindOf`、`postureBenefitAt`、`railNetwork` 等）。GDScript 不能用 TypeScript 的结构化回调类型，建议定义一个 `RuleContext`/`CampaignContext` 类，字段是 `Callable` 或具体 `RefCounted` 板对象，`null` 表示未注入。测试用合成上下文，生产由 `data/` 装配。
- `CampaignTurnState` 是大型嵌套字典；GDScript 中必须保持序列化形状，避免为了“面向对象”拆碎导致存档不兼容。
- 08 的 `scorpion-session.ts` 已把规则、阶段、待决应答集中编排；迁移时不要把它复制成一个更大的 `scorpion_session.gd`，按机制拆成 `match/scorpion/*.gd`，会话只负责分派。
- 所有命令入口保持 `expectedRevision`、去重和原子性；GDScript 没有异常捕获，使用 `CommandResult`（成功/错误码/新记录）返回，内部规则违规用显式校验分支，不用 `assert` 代替玩家可见拒绝。

### 4.5 视图 `view`

| TS | GDScript |
| --- | --- |
| `campaign-match-view.ts`（约 9.7 KB） | `view/campaign_match_view.gd` |
| `campaign-reinforcement-view.ts`、`campaign-opening-session-view.ts`、`campaign-breakout-view.ts` | `view/campaign_*.gd` |
| `scorpion-boxes.ts`、`scorpion-map-counters.ts`、`scorpion-grid-layout.ts`、`scorpion-barrage-markers.ts`、`scorpion-auxiliary-cards.ts` | `view/scorpion_*.gd` |
| `calibrated-surface.ts`、`hex-counter-layout.ts` | `view/calibration.gd`、`view/layout.gd` |

视图函数保持纯函数，返回当前 JSON 兼容的 `Dictionary`。这样现有 `map_view.gd` 无需重写；只是数据来源从 `engine_bridge.gd` 换成原生 `local_session.gd`。按方可见性是硬约束：投影函数接收 `viewer`，不能把对方隐藏信息放进公共字典。

### 4.6 数据与桌面适配

| TS | GDScript |
| --- | --- |
| `src/import/*`（24 文件） | `data/import/*.gd`；第一阶段可先用已归一 JSON 快照，后补实时导入 |
| `desktop/local/data.mjs` | `data/loader.gd`：`FileAccess`、`JSON.parse_string`、`HashingContext` 指纹 |
| `desktop/local/controller.mjs` | `session/local_session.gd`：命令队列、存档、视图 |
| `desktop/local/actions.mjs`、`interaction.mjs`、`refit.mjs` 等 | `session/actions.gd`、`session/interaction.gd`，或下沉到 `view` |
| `desktop/local/store.mjs` | `session/save_store.gd`：`user://`、原子写入、指纹校验 |

数据迁移建议：

1. 先保留现有归一后的 JSON（`games/third-winter/data` 与 `dist`）作为只读资源，迁规则时直接读，避免同时重写导入器。
2. 第二阶段再决定是否把实时导入迁入 GDScript。若实库更新频率低，可以在构建前用离线脚本生成归一 JSON，运行时不依赖 Node；这仍满足“运行时纯 Godot”。
3. 图片、图表、辅助卡纳入 `res://` 或导出资源；外部 `D:\war game\...` 仅作为开发数据源，不写死进发行包。
4. 存档继续用 JSON，保留 `schemaVersion`、数据指纹和 `record` 结构；迁移期尽量保持与旧档兼容。

## 5 特殊算法迁移说明

### 5.1 RNG

`rng.ts` 是 mulberry32，使用 32 位整数和 `Math.imul`。GDScript 必须：

- 用整数位运算模拟 32 位无符号加法/乘法，所有结果 `& 0xFFFFFFFF`。
- 拒绝采样保持骰面均匀；`drawCount`、`state`、`seed` 原样入档。
- 用 TS 生成的固定序列做 golden 用例；同一 `seed` 前 100 次抽取必须逐项相等。
- 这是迁移的第一块，必须先过，不能等规则写完再补。

### 5.2 命令与不可变状态

TS 的 `apply` 返回新状态，拒绝命令不改变状态。GDScript 的 `Dictionary`/`Array` 是引用，容易在拒绝路径上误写。方案：

- `MatchRecord` 只通过 `submit()` 修改；提交前对状态做 `duplicate(true)` 或显式 `clone_state()`。
- 规则函数只接收只读副本，返回新状态；成功后才提交，失败丢弃副本。
- 914 枚计数器级别的状态深拷贝先做基准；如果单命令超过可接受阈值，再引入按模块的 copy-on-write，而不是一开始写复杂事务框架。
- 重复提交同一 `id`、错方、过期修订、非法目标都必须在副本上失败，`revision` 和 RNG 不变。

### 5.3 错误模型

GDScript 没有 `try/catch`。建议：

- 对外命令返回 `CommandResult`：`ok`、`error_code`、`error_message`、`record`、`view`。
- 规则内部用 `can_*`/`validate_*` 显式判断，拒绝路径返回 `Result`，不改状态。
- 开发者错误（数据缺字段、未知枚举）用 `push_error` + 测试失败；玩家可见错误不用 `assert`。
- 保留现有中文错误语义，例如“局面已更新，请重新选择”“请选择当前一方的算子”，不要因为迁移改写 UI 文案。

### 5.4 联合类型与游标

TS 的 `CampaignCursor`、`CampaignTurnAction` 是判别联合。GDScript 没有联合类型：

- 用 `Dictionary` + 必填 `phase`/`segment`/`type` 字段，进入时由 schema 校验。
- 会话分派用 `match action.type`，每个分支先校验必需字段，再调用机制模块。
- 不要把所有字段塞进一个万能类；按 `type` 保持“扁平字典 + 边界校验”最简单。
- `null` 与“字段不存在”要区分：用 `dict.has(key)`，不要只判断 `null`。

### 5.5 地图与补给搜索

`supply-network.ts`、`trace-path.ts`、`ground-map.ts` 是算法热点：

- 六角格键保持字符串 `D14.3`/`s5.16`，不转浮点坐标；像素只给 UI 标定。
- 邻接、边费用、铁路网络使用 `Dictionary` + `PackedStringArray`/`Array[String]`，避免每格建对象。
- 二叉堆、反向搜索、按阵营缓存照 TS 实现移植；先保证结果一致，再优化 GDScript 常数。
- 用现有合成大盘面（8,000 格、80 HQ、1,600 查询位置）做基准；以“结果完全一致 + 单次查询可接受”为门槛。若 GDScript 慢于 TS，先优化容器/缓存，不直接改算法语义。

### 5.6 JSON、日期与整数

- Godot `JSON.parse_string` 的数字默认是 `float`；在 `data` 边界按 schema 转 `int`，特别是修订号、RNG、回合、骰面、库存。
- 时间不要依赖本地时区；用 `Time.get_unix_time_from_datetime_string` 或直接存 `YYYY-MM-DD` 并做 UTC 日期比较。
- 对象键顺序不稳定，golden 对比要先规范化；数组顺序必须保持规则语义。
- `undefined` 在 TS 里表示缺字段，GDScript 用 `null` + `has`；序列化时不要写入无意义空键。

### 5.7 性能

全 GDScript 的主要风险是深拷贝、视图投影和补给搜索。迁移时设置三个基准：

1. 08 开局：加载、初设、首视图。
2. 01 全景：914 枚计数器、首回合烟测。
3. 补给网络合成盘：与 TS 基线结果一致并记录耗时。

优化顺序：减少深拷贝 → 缓存纯函数结果 → 用 `Packed*Array`/字典 → 最后才考虑局部 GDExtension。不要把 C# 重新引入主方案，除非用户重新裁定。

## 6 测试迁移

现有 629 个 Node 用例是最大资产，不能靠“迁完再补测试”。

### 6.1 迁移方法

1. **先做 oracle 快照**：在 Node 侧运行现有测试/固定命令序列，输出规范化 JSON（状态、视图、错误码、RNG 序列）。
2. **GDScript 测试 runner**：`godot --headless --path ... --script res://tests/runner.gd`，读取 `tests/vectors/*.json`，执行同一命令，比较规范化结果。
3. **规则模块自带小用例**：每个 `rules/series/*.gd` 至少覆盖成功、拒绝和一个邻接规则；不从 TS 测试逐行抄，而是复用其输入/期望。
4. **UI 只做冒烟**：主页面、剧本选择、08 地图加载不进入规则单测；用固定截图和启动检查。

### 6.2 必测类别

- RNG 固定序列、骰面、抽取计数。
- 命令去重、错方、过期修订、拒绝后状态不变。
- 08 初设、移动、右键菜单、战斗/补给待决。
- 01 初设 914 计数器、首回合烟测。
- 09 初设、固定补给、铁路轨距。
- 双方视图隐藏信息。
- 存档 roundtrip、指纹不匹配拒绝。
- 视图字段与当前 JSON 协议一致。

### 6.3 验收门槛

- 08 切片：固定命令序列的 view/状态差分 **0 处**；RNG 序列一致；命令拒绝路径一致。
- 01/09：开局、首回合、关键机制序列差分 0；现有 629 用例对应向量全部通过。
- 全量：629/629 等价通过，或每个未迁移用例有明确豁免和替代测试；才能删除 Node。
- 性能：08/01 首视图和补给合成盘达到可接受阈值，且结果与 TS 完全一致。

## 7 分阶段计划

| 阶段 | 范围 | 交付 | 验收 |
| --- | --- | --- | --- |
| 0. 基线冻结 | 无代码迁移 | `core/rng.gd`、`core/command_log.gd`、GDScript test runner、08 命令/视图 golden 向量 | RNG 前 100 抽一致；重复/过期命令拒绝一致 |
| 1. 08 纵向切片 | data loader + series 子集 + ttw/scorpion + match/scorpion + view | Godot 内原生 08 开局、地图、基础移动/右键；功能开关切换，Node 仍可回退 | 08 固定序列 view 差分 0；地图/存档 roundtrip |
| 2. 01/09 战役 | campaign 规则、会话、视图、初设/补给/战斗/空军 | 01/09 从菜单进入原生战役；01 914 计数器、09 固定补给/轨距 | 01 首回合烟测、09 开局；关键序列差分 0 |
| 3. 全模块与全测试 | 全部 series/ttw/match/view；02–07 入口；629 用例迁移 | 无 Node 的纯 Godot 运行；旧 Node 只作 oracle | 629/629 等价；所有菜单入口真实可用或明确禁用 |
| 4. 清理与发布 | 删除 bridge、desktop/local、npm；导出 | Windows 导出包；数据/图片打包；性能记录 | 干净机器启动、存档、返回菜单、无 Node 依赖 |

### 7.1 第一阶段的具体文件

建议首个分支 `migration/gdscript-core` 只做：

```text
scripts/core/rng.gd
scripts/core/command_log.gd
scripts/core/state_types.gd
scripts/core/result.gd
scripts/core/deep_copy.gd
tests/runner.gd
tests/vectors/rng.json
tests/vectors/command_log.json
```

不要在第一阶段改 `menu.gd`/`map_view.gd`，先把规则地基和测试入口做出来。08 地图切换放在第二阶段，用 `LocalSession` 替换 `EngineBridge`，保留旧桥接作为回退。

### 7.2 第二阶段接线

- 新增 `scripts/session/local_session.gd`，提供 `open_scenario()`、`submit(command)`、`project(viewer)`、`save()`。
- `map_view.gd` 不再依赖 `bridge`，改为 `session`；`engine_bridge.gd` 先保留但不再作为主路径。
- `menu.gd` 的 08 入口改为加载原生 08；其他剧本仍显示待接。
- 一旦 08 原生通过 golden，删除 `engine_bridge.gd` 的调用，不删除 Node 文件本身，保留回退分支。

## 8 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 规则语义漂移 | 高 | 先做 oracle 快照；逐命令差分；不按“看起来对”验收 |
| GDScript 弱类型 | 高 | 全量类型标注；边界 schema；关键记录 `class_name` |
| 深拷贝性能 | 中 | 先基准；按模块 copy-on-write；不引入全局可变状态 |
| 错误模型改写 | 中 | 统一 `CommandResult`；保玩家文案；拒绝路径测试 |
| 补给搜索变慢 | 中 | 先结果一致；容器优化；合成大盘基准 |
| 数据和图片授权/体积 | 中 | 运行数据归一；发行包只带必要资源；外部资料不入仓库 |
| 01/09 没有现成桥接 | 高 | 把 01/09 作为第二阶段独立范围，不与 08 UI 迁移混在一起 |
| 629 测试迁移量大 | 高 | 先迁移测试向量，不逐行抄测试代码；保留 oracle 直到归零 |
| 全 GDScript 工具链弱 | 中 | 无头 runner + 静态检查 + 统一命名；不依赖 IDE 重构 |

## 9 不建议的做法

- 不要先删 `desktop/local`、`bridge` 和 `node_modules`，再开始写 GDScript；没有 oracle 无法判断规则是否等价。
- 不要一次性把 20 个模块并行重写；先 08，再 01/09，再全量。
- 不要把规则塞进 `Node` 场景脚本；规则层必须能脱离场景树在 `--headless` 下跑。
- 不要用无类型 `Dictionary` 传遍所有层；至少给命令、状态、视图加 schema 校验。
- 不要为了“纯 Godot”把数据导入器和 UI 一起改；先读归一 JSON，后补导入器。
- 不要在 GDScript 里用 `assert` 处理玩家可见拒绝；拒绝必须是可恢复的 `CommandResult`。
- 不要在没有差分测试的情况下改 RNG、日期、整数转换或地图键。

## 10 最终建议

按用户约束，**不迁 Unity，采用 Godot 4.7 + 全 GDScript**。先做 `core`/RNG/命令记录和 08 的纵向切片，把“纯 Godot 能跑 08 且视图差分归零”作为第一个 go/no-go；通过后再接 01/09，最后才全量替换 Node。这样即使中途失败，现有 Node 版本和 629 个用例仍然可用，不会把主线锁死在一次大重写里。

相关文档：

- [第三冬工程交接](2026-11-22-第三冬工程交接.md)
- [当前工作状态与缺口盘点](2026-11-26-当前工作状态与缺口盘点.md)
- [Godot 主页面与纯 Godot 迁移交接](2026-11-27-Godot主页面与纯Godot迁移交接.md)
- [Godot 客户端说明](../godot/README.md)
- [开发规范](../../../AGENTS.md)
