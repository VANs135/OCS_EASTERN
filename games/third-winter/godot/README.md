# EASTERN OCS · Godot 客户端

这是 `D:\OCS\OCS_EASTERN` 仓库内的正式 Godot 客户端目录。地图入口在迁移期间仍由 Node/TypeScript 引擎结算。原生 GDScript 已覆盖 08 开局的会话与投影：印刷初设、Alert 抽取、双方部署、进入首回合飞机整备的命令由 `scripts/session/local_session.gd` 结算，地图与侧栏视图由 `scripts/view/scorpion_view.gd` 生成，并用 TypeScript 交互序列逐步对照。

工程分层、作品包接入和迁移阶段见 [Godot 纯 GDScript 架构方案](../../../docs/Godot纯GDScript架构方案.md)。三层规则、五种模式、Linux 无头 AI、LLM 指挥和 Android 适配的开发要求见 [Godot 项目约束](../../../docs/Godot项目约束.md)。

正式入口现在是 `menu.tscn`：主页面选择游戏模式，再进入剧本选择；只有 **08 瓶中蝎** 接通 Godot 地图。地图侧栏显示“剧本 · 模式”，并提供“← 返回主页面”。当前桥接复用 **08 瓶中蝎** 桌面控制器（`openLocalScorpion`），所以画面是 Scorpion 地图/初设，不是 09 基洛沃格勒战役。09 的 `campaign-match` 桥接尚未建立；规则补全不影响这个显示层。

## 入口与模式

`menu.gd` 只维护入口元数据和状态，不复制规则。模式定义如下：

| 模式 | 当前状态 |
| --- | --- |
| 单机 SOLO | 本地热座可用；08 可从菜单进入地图 |
| 联机 PVP | 入口占位，房间/网络协议待接 |
| 联机多人 PVP | 入口占位，多席位服务端待接 |
| 单机 PVE | 入口占位，AI 对手待接 |
| 联机 PVE | 入口占位，协议与 AI 均待接 |

剧本页列出 01–09 的日期、回合、地图范围与桥接状态：`08-korsun-pocket` 可进入；01、09 标为“夹具就绪”（本机夹具存在，Godot 地图未接）；02–07 标为“桥接待接”。未接通的入口只保留位置和状态，不伪造可玩性。

`AppState`（`scripts/app_state.gd`）是会话级自动加载，保存 `mode_id` / `mode_label` / `scenario_id` / `scenario_label`；返回主页面后保留本次会话选择，但不写盘。

## 链路

```
Godot 4.7（games/third-winter/godot）
  → bridge/eastern_bridge.mjs
  → games/third-winter/desktop/local/controller.mjs
  → openLocalScorpion / controller.dispatch / projectLocalScorpion
```

桥接只使用现有的 `protocolVersion: 1` 桌面 UI 接口：首行返回 `model + view`，之后逐行收发 `board-left`、`board-menu`、`select-unit`、`apply`、`view` 等请求。规则数据仍来自：

- `D:/war game/OCS各作数据库/OCS第三个冬天`
- 仓库根目录的 `dist/` v4.3 图表（由 `bridge.config.json` 的 `../../../dist` 推导）

## 运行

用 Godot 4.7.2 打开本目录的 `project.godot`，或：

```powershell
& 'E:\godot\Godot_v4.7.2-stable_win64_console.exe' --editor --path 'D:\OCS\OCS_EASTERN\games\third-winter\godot'
```

也可以直接用目录内脚本（默认读 `OCS_GODOT`，未设时用本机 4.7.2 控制台版）：

```powershell
& 'D:\OCS\OCS_EASTERN\games\third-winter\godot\run.ps1'
& 'D:\OCS\OCS_EASTERN\games\third-winter\godot\run.ps1' -Editor
& 'D:\OCS\OCS_EASTERN\games\third-winter\godot\run.ps1' -Headless
```

无头自检（只验证场景启动，不验证画面）：

```powershell
& 'E:\godot\Godot_v4.7.2-stable_win64_console.exe' --headless --path 'D:\OCS\OCS_EASTERN\games\third-winter\godot' --quit-after 120
```

`bridge.config.json` 的仓库内路径都是相对的（`engine_dir`、`tables`、`bridge_script`）。外部路径可用环境变量覆盖：

- `OCS_NODE`：Node 可执行文件
- `OCS_DATA_ROOT`：第三冬资料库根
- `OCS_TABLES`：`dist` 图表目录
- `OCS_SAVE`：存档文件
- `OCS_NATIVE`：`1` 时菜单进入 `main-native.tscn`
- `OCS_NATIVE_DATA`：原生开局数据包路径

08 入口由 `bridge.config.json` 的 `native` 开关决定：`true` 时菜单进入 `main-native.tscn`，由 `native_bridge.gd` 直接加载 `dist/godot/08-opening-data.json` 并投影，不再启动 Node；改为 `false` 回落到 `main.tscn` 的 Node 桥。直接跑原生地图并截图：

```powershell
& 'E:\godot\Godot_v4.7.2-stable_win64_console.exe' --path 'D:\OCS\OCS_EASTERN\games\third-winter\godot' main-native.tscn -- --capture=E:/OCS/工作文件/native-08-open.png
```

默认存档为 `user://eastern-godot-save.json`（Godot 用户目录），不会写进仓库。

Godot AI 插件不再随仓库 vendored。需要编辑期 AI 时，单独把 4.4.2 插件放进 `addons/godot_ai` 并在编辑器启用；游戏运行不依赖它。

## 原生迁移回归

从仓库根目录运行。`godot` 指向 Godot 4.7.2 标准版的命令行程序。随机数、命令回执和库存测试使用随仓库提交的向量。

```powershell
npm run check:godot-vectors --workspace=@ocs-eastern/third-winter
godot --headless --path games/third-winter/godot --script res://tests/runner.gd
```

08 实库验收先生成初设数据和 TypeScript 交互对照。生成器默认使用仓库 `dist` 图表，也可用第三个位置参数指定图表目录。对照包含开局、部署、右键菜单、移动、拒绝、续档及行动方切换。使用现有缓存时重新生成初设文件以取得机场、Alert 档案、控制点、地图拓扑以及视图所需的算子名/面/标记素材。无头测试读取两个同指纹文件，逐步重放修订 0 至 31，核对盘面、骰序、回执，并用同一交互序列驱动原生会话逐视图对照修订 0–30 的地图与侧栏投影；再结算 `complete-refit`、逐条重放四条增援命令，并把修订 32–37 的增援面板逐字段对照（headline、roster、动作文案、盒子、回合轨、Pax）。移动、交互投影和续档的原生对照仍待接入。

```powershell
$ttwData = 'D:\war game\OCS各作数据库\OCS第三个冬天'
node --experimental-strip-types games/third-winter/scripts/godot-scorpion-opening-data.mjs $ttwData
node --experimental-strip-types games/third-winter/scripts/godot-scorpion-vector.mjs $ttwData
node --experimental-strip-types games/third-winter/scripts/godot-scorpion-supply.mjs $ttwData
node --experimental-strip-types games/third-winter/scripts/godot-scorpion-terrain.mjs $ttwData
node --experimental-strip-types games/third-winter/scripts/godot-scorpion-trace.mjs $ttwData
godot --headless --path games/third-winter/godot --script res://tests/runner.gd -- `
    (Resolve-Path 'dist/godot/08-opening-data.json').Path `
    (Resolve-Path 'dist/godot/08-scorpion.json').Path `
    (Resolve-Path 'dist/godot/08-supply.json').Path `
    (Resolve-Path 'dist/godot/08-terrain.json').Path `
    (Resolve-Path 'dist/godot/08-trace.json').Path
```

第三到五个参数可选：补给态势对照核对双方 ZOC 与态势字典；格边取费对照核对 1045 条印刷边双向、三种机动、封冻/解冻共 12540 条 trace 取费与 6270 条干地取费；补给 trace 对照核对双方 374 格 × 两套机动的选项列表与覆盖集。

视图对照覆盖 `revision`、`actor`、`headline`、`phase`、`phaseId`、`roster`、`actions`（标签与动作类型）、当前选择、`frame.mapStacks`、盒内清单、回合轨、辅助卡、`transportStock` 与 `breakdownStock`（含印面额 `inUse` 与拆分副本 `availableIds`）。`menu` 字段不参与对照，新增的界面入口只能落在 `menu`。详见 [08 原生会话与开局投影](../docs/2026-11-27-08原生会话与开局投影.md)。

本轮各数值层与命令层都带独立夹具：`godot-combat-terrain.mjs`（967 条）、`godot-mode-commands.mjs`（78 行）、`godot-barrage.mjs`（9 例）、`godot-combat.mjs`（6 场景 43 步）、`godot-remnant-gen.mjs`（5 场景 6 步）、`godot-retreat.mjs`（6 场景 12 步）、`godot-capture.mjs`（6 场景 7 步）；用例放在 `tests/cases/<名>_cases.gd`，由 `tests/runner.gd` 扫描目录自动加载（每个文件暴露 `static func run(ctx)`，`ctx` 给出 `expect`/`compare`/`reject`/`state_slice` 与 `args`）。当前基线：六参数 **3075/3075**、两参数 **3047/3047**。战斗掷骰已回本局 `state.rng`（`combat_rolls.gd`，对照 TS `scorpionRolls`）：`surprise` 2 枚 → `surprise-shift` 1 枚（仅极端时）→ `combat` 2 枚，`offer` 只服务重掷回放与对照夹具。

## 已实现

- 原生开局会话与投影：`local_session.gd` 处理席位、修订、预演与命令；`scorpion_view.gd` 生成开局算子清单、合法动作、地图堆叠、回合轨、盒区清单、辅助卡、炮击标记、印刷运输面额与拆分库存；无头测试用 TS 交互序列逐步对照。
- 飞机整备收束：`works/third-winter/rules/stacking.gd` 与 `reinforcement.gd` 结算 `complete-refit`——先查 10 RE 堆叠，再推进到增援阶段并按剧本固定补给表开出增援窗口。该阶段只有记录状态对照，视图仍未迁。
- 补给态势：`works/third-winter/rules/supply_position.gd` 复现敌方 ZOC、控制点归属、补给源、可卸货设施与 HQ/延补队；地图邻接与格边轨距随数据包导出，用 `08-supply.json` 与 TypeScript 逐字段对照。
- 格边取费：`scripts/rules/series/ground_terrain.gd` 与 `works/third-winter/rules/terrain_cost.gd` 复现 OCS 6.2 地形/格边选择和 TTW TEC 三列代价，含封冻取小与路线取费；`view.mapGraph.terrains` 随数据包导出，用 `08-terrain.json` 全边对照。
- 补给 trace：`scripts/rules/series/{trace_targets,trace_path,supply_network}.gd` 复现 12.3/12.6/12.7 的图算法（铁路连通、延补队接力、5 MP 抽补、HQ 投送、Kessel 自足、覆盖集），`works/third-winter/rules/supply_trace.gd` 装配印刷轨距/卸货点/TTW 取费，用 `08-trace.json` 逐格对照。增援板（13.6 落点 + Alert 落点）由 `works/third-winter/rules/reinforcement_board.gd` 原生实现，用第六个夹具 `08-arrivals.json` 对照全编目 103 条抵达与 2 枚 Alert。四条增援命令已接入（`works/third-winter/rules/reinforcement.gd` 的 `apply`，算子克隆自 `view.catalog.counters`），runner 用 `records[33..38]` 逐条比对整本增援账本；增援阶段的视图投影（`scorpion_view.gd` 的 `project_playing`/`reinforcement_choices`）与 TS 的 `render` 逐字段一致。警戒营的放置/放弃（`place-alert`/`pass-alert`）已原生，08 首回合不抽 Alert，用注入 Alert 的夹具做本地校验。地面移动 `ground-move` 由 `works/third-winter/rules/ground_move.gd` 按 OCS 6.1 与 14.8c 实现，runner 用 oracle 的第一步行军逐块比对 `units`/`moved`/`groundActivity`。
- 规则模块（数值层与命令层）：`scripts/rules/series/modes.gd`（模式数值与合法性）、`crt.gd`（CRT 取表）、`works/third-winter/rules/combat_terrain.gd`（TTW 战斗地形/强度/行动值）、`ground_mode_actions.gd`（换面）、`reserves.gd`（预备三命令）、`barrage.gd`（地面炮兵炮击）、`combat.gd`/`combat_supply.gd`/`combat_losses.gd`/`combat_result.gd`（正规战斗七步、战损含残部生成、撤退结算与续跑）、`retreat.gd`（守方撤退）、`hedgehogs.gd`（刺猬）、`capture.gd`（进格夺取：地面控制、补给堆、机场、停机飞机、刺猬与运输队窗口/配属）、`remnants.gd`（残部生成与重建）。换面/预备/炮击/战斗七步已接会话路由与右键菜单（`scorpion_match.gd`、`scorpion_view.gd` 的 `menu` 层），撤退、`continue-combat-retreat`、刺猬作业已接；进格夺取窗口已有临时侧栏结算入口（窗口待决时只列结算夺取）。逐面数值由数据包的 `view.faces` 提供（251 条，15 条无移动面），机型印刷航程由 `definitions` 的 `range`/`rangeMove` 提供，夺得运输队的一点算子模板由 `view.catalog.capturedTransports` 提供。
- 原生桥与入口：`scripts/session/native_bridge.gd` 与 `engine_bridge.gd` 同信号契约，`bootstrap` 取数据包 `view.model` 并把地图解析成绝对路径；`main-native.tscn` 由 `bridge.config.json` 的 `native` 开关启用，08 开局不再启动 Node 进程。
- 主页面五模式入口、模式简报、当前唯一桥接提示；深色战术底纹、卡片选中态和不可用状态。
- 剧本选择页 01–09 列表、滚动、详情面板、桥接状态与“进入检查”门禁。
- 地图场景侧栏显示当前“剧本 · 模式”上下文，并可返回主页面。
- 真实地图 `Scorpion-Map-200929.png`、地图盒区、当前地图堆叠和算子图。
- 左键格/算子选择，右键打开动作菜单，中键拖动，滚轮缩放。
- 侧栏显示当前阶段、修订号、当前视图的 `actions` / `menu` / `stack` / 前 24 枚 `roster`。
- 侧栏按钮提交 `apply`，单位按钮提交 `select-unit`；提交后由引擎返回新视图。
- 地图变化、行动方切换、部署阶段推进都随 `view` 刷新。

## 当前限制

- 只有 08 可以进入地图；01/09 只有本机夹具，02–07 只有资料/菜单层。
- 联机 PVP、联机多人 PVP、单机 PVE、联机 PVE 仅保留入口和状态，没有网络房间或 AI 对手。
- `AppState` 不持久化；重启客户端后回到默认“单机 SOLO + 08”。
- 同格多页算子目前只画第一页；分页按钮未接。
- 辅助卡、战斗草稿、撤退路径、补给应答等专用面板尚未全部图形化；当前通过 `actions` / `menu` 转发。

## 下一步

1. 移动至清理阶段：`ground-move`、`complete-movement`、补给/断补（含 `choose-formation-trace` 编队追溯来源、`assign-attrition` 步损分配与 `feed-units` 具象补给支付，见 `supply_phase.gd`、`sp_payment.gd` 与 `scripts/rules/series/step_loss.gd`）、反应/战斗/进击/清理收尾已原生（`phase_flow.gd`），同回合换手可用；第二方清理后的回合换手与主动权应答（天气、突死、扣分、`retain-initiative`/`roll-initiative`/`choose-first`）已原生（`round.gd`），应答期间的侧栏仍留空。阶段侧栏给出的是可执行的完整动作（`ScorpionView.playing_choices`），按键能回到同一张表。
   撤退续跑（`continue-combat-retreat`，`retreat.gd` + `combat_result.gd` 的 `continue_retreat`）与刺猬作业（`work-hedgehog`，`hedgehogs.gd`）已接会话分派与侧栏：侧栏按选中的静止战斗单位给出「构筑刺猬 · 格 X（8T · <补给源>）」与「拆除刺猬」；8T 可由多堆拼付，侧栏列单源与 2–3 源组合（总量仍按 `payments` 复核），挂起撤退时给出「继续撤退 · 原地续跑」。仍缺的是改走其它格的续跑后缀与逐格 `remnantHexes`/`zocLosses` 选择；残部生成的落点选择需要随 `resolve-combat` 的 `remnants` 透传。数据包已补逐面数值（`view.faces`，251 条，15 条无移动面）。
   仍未移植：折分离场（breakdown）、与 Extender 崩塌位移、超越行军（overrun）；Kessel 司令部入盒/移除、被毁返还与特规行军（`kessel-move`）已接；加油尚未开始；卸货点数的「本阶段不可再装」溯源（`scorpionUnloadedTokens`）与内部补给回收（`internalStocks`）仍缺。进格夺取本身已原生（`capture.gd`，`08-capture.json` 8 场景 9 步）；残部落点候选已公开（`Remnants.destinations`/`destinations_from`，战损结算挂起时 `pending.candidates` 带名单），但战斗面板还没有落点选择器；移动阶段侧栏已能走子（点邻格出 `ground-move` 行，`ground_move.check` 与落地同源），机械化战斗面单枚付油已接（`fuel.gd`，`fuelDumpId` 随 `ground-move` 一起付 1T），暂驻运输队付油、编队/司令部批量油、已加油司令部向独立单位投送与运输点重新打包（`transport_points.gd`）也已接，运输分母的库存上限已按 `transportRows[].limit` 校验，有货载运输也逐种分盒装法出行（≤24 条）；移动进格夺取已接（`ground_move` 逐格走 `Capture.resolve_entry`），夺取归属即时结算（控制/机场/补给/刺猬不等确认），窗口只在出现真实位移选择时挂起（player 默认 / manual 夹具 / auto AI 代选）；多机多落点时按候选组合逐套成行（≤8 套）；战斗/进击阶段的攻击行已接（_append_engage_menu，付弹药或动用部队储备两路）；地面炮击已接（地面目标、整轮炮组费用与共同司令部投送支付；机场/设施目标表未迁），飞机任务同样未接。
2. 存档与续档：`schemaVersion`、数据指纹、原子写入与恢复。
3. 通过同一会话接入双人和多人 PVP、单人和多人 PVE、Linux 无头 AI 与可选 LLM 指挥适配器。
4. 验证 Windows 独立导出以及 Linux 无头会话。
