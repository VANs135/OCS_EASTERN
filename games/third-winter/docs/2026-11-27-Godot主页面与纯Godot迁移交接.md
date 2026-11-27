# Godot 主页面与纯 Godot 迁移交接

制定日期 2026-11-27。仓库 `D:\OCS\OCS_EASTERN`，分支 `main`。本文交接两件事：本轮 Godot 主页面/剧本选择菜单的现状与未完成项；把项目转为纯 Godot 的可行性、推荐路线和首个切片边界。

## 0 推送状态与基线

- 本地与远端 `main` 均为 `d7bf506`，工作树干净，无未提交文件。
- 本轮提交：
  - `cff252e feat(godot): add game mode home and scenario select menu`
  - `d7bf506 docs: record the Godot mode home and scenario menu`
- `git ls-remote origin refs/heads/main` 返回 `d7bf5068a09fb79408ef09297697130c8c49cf53`。
- 全仓门禁 `npm --prefix "D:\OCS\OCS_EASTERN" run check` 为 **629/629**。
- Godot 基线为 `E:\godot\Godot_v4.7.2-stable_win64.exe` / 控制台版；当前是标准版，不是 .NET 版。

## 1 当前入口和模式

正式主场景已改为 `res://menu.tscn`。启动方式：

```powershell
& 'E:\godot\Godot_v4.7.2-stable_win64.exe' --path 'D:\OCS\OCS_EASTERN\games\third-winter\godot'
```

也可以运行 `games/third-winter/godot/run.ps1`。主页面先选游戏模式，再进入剧本选择。五个模式均已列出：

| 模式 | 当前状态 |
| --- | --- |
| 单机 SOLO | 本地热座可用；08 可从菜单进入地图 |
| 联机 PVP | 入口占位，房间/网络协议待接 |
| 联机多人 PVP | 入口占位，多席位服务端待接 |
| 单机 PVE | 入口占位，AI 对手待接 |
| 联机 PVE | 入口占位，协议和 AI 均待接 |

未接通的模式保留入口和“协议待接 / AI 待接”状态，没有伪造可用性。`AppState` 是会话级自动加载，保存 `mode_id`、`mode_label`、`scenario_id`、`scenario_label`；返回主页面后保留本次会话选择，但不写盘。

## 2 剧本选择与地图入口

`menu.gd` 的 `SCENARIOS` 列出 01–09 的日期、回合、地图范围和桥接状态：

- `08-korsun-pocket`：唯一 `interactive`，可选择并“进入检查”。
- `01-dnepr-battles`、`09-kirovograd-armor-defense`：`fixture`，本机夹具存在，Godot 地图未接。
- 02–07：`data`，资料/菜单层已载入，地图桥接待接。

进入 08 后，地图侧栏显示“剧本 · 模式”上下文，例如 `08 · 科尔孙口袋：瓶中之蝎 · 单机 SOLO`，并提供“← 返回主页面”。返回时切回 `menu.tscn`；地图桥接固定复用 08 瓶中蝎桌面控制器，尚未支持 `--scenario`。

主要文件：

- `games/third-winter/godot/menu.tscn`：主场景根 `Control`。
- `games/third-winter/godot/scripts/menu.gd`：主页面、模式卡、剧本列表、详情和进入逻辑。
- `games/third-winter/godot/scripts/app_state.gd`：`AppState` 自动加载。
- `games/third-winter/godot/project.godot`：主场景 `res://menu.tscn`，`AppState="*res://scripts/app_state.gd"`。
- `games/third-winter/godot/scripts/map_view.gd`：地图侧栏上下文、返回按钮和单请求门闩。
- `games/third-winter/godot/bridge/eastern_bridge.mjs`：仍固定调用 `loadLocalScorpion` / `openLocalScorpion`。
- `games/third-winter/godot/bridge.config.json`：Node、资料库、`dist`、存档和种子路径。

为截图检查保留了两个命令行参数：

```powershell
-- --scenarios
-- --scenarios --capture=E:/OCS/工作文件/eastern-scenarios.png
```

`--scenarios` 直接进入剧本页，`--capture` 在渲染一帧后保存视口并退出。它们只用于检查，不替代正常入口。

## 3 已验证边界

- Godot 无头解析通过：`--headless --path ... --quit-after 120`，退出码 0，无 GDScript 解析错误。
- 主页面和剧本页的 1600×900 视口截图已生成并目视核验：`E:\OCS\工作文件\eastern-menu.png`、`eastern-scenarios.png`。
- 实际交互验证：
  - 主页面切换到“联机 PVP”，右侧模式简报和入口状态刷新；
  - 剧本页点击 01，详情切到第聂伯河战役，“进入检查”显示“地图桥接待接”并禁用；
  - 默认选择 08 后，用键盘 Enter 激活“进入检查”按钮，地图和侧栏上下文加载，桥接 bootstrap 为 `3111x1969`；
  - 地图侧栏显示当前剧本/模式和“← 返回主页面”。
- 全仓 `npm run check` 629/629；Godot UI 不进入该 npm 门禁。

未完成的地图交互验收：08 地图进入只验证到 bootstrap 和画面加载，地图内的移动、右键菜单、战斗/补给应答还没有逐项回归。自动化快速操作期间曾出现 `桥接失败：EASTERN 报错：局面已更新，请重新选择`；已在 `map_view.gd` 加入 `_request_pending` 单请求门闩，避免双击/连续点击用旧 revision 发第二个请求，但该修复尚未做完整的双击和连续操作回归。接手时先复测这一项。

## 4 当前限制

- 只有 08 能进入地图；01/09 只有本机夹具，02–07 只有资料/菜单层。
- 联机 PVP、联机多人 PVP、单机 PVE、联机 PVE 没有网络房间或 AI 对手，只有入口占位。
- `AppState` 不持久化，重启客户端回到默认“单机 SOLO + 08”。
- `eastern_bridge.mjs` 没有 `--scenario` 参数；即使 UI 允许 01/09，当前也会进入 08 控制器，因此没有放开 01/09 的进入按钮。
- 08 地图同格多页算子目前只画第一页，分页按钮未接；辅助卡、战斗草稿、撤退路径、补给应答等专用面板尚未全部图形化。
- `map_view.gd` 的单请求门闩牺牲了“双击确认移动”的旧交互；如果恢复双击确认，需要把第二次点击排队到首个响应返回后再发，而不是直接放开发请求。

## 5 纯 Godot 迁移评估

结论：**技术上能做，但这是一次规则引擎迁移，不是把 Node 目录删掉。** 当前 Godot 只占很小一部分：

| 范围 | 规模 |
| --- | ---: |
| Godot 客户端脚本 | 约 1,147 行 |
| 第三冬规则、投影、导入源码 | 约 19,400 行 |
| `packages/series` 通规源码 | 约 3,000 行 |
| 桌面适配层 | 约 3,100 行 |
| 测试 | 约 14,000 行、629 个用例 |
| 仓库数据/图表 | `games/third-winter/data` 约 5.36 MB；`dist` 约 64 MB |

主要维护成本在规则层和 629 个回归用例，不在 Godot 画面。全量重写的最大风险不是翻译代码，而是丢失已经核准的规则边界、错方/越序/过期修订拒绝、骰序和视图投影。

### 5.1 三种路线

| 路线 | 做法 | 评价 |
| --- | --- | --- |
| A. Godot C# 内核 + GDScript UI | 把规则引擎迁到 Godot C#，UI 继续 GDScript；无 Node，单次导出 | 推荐。TypeScript 的类型、集合和异步结构较容易对应；需要安装 Godot 4.7 .NET 版和 .NET SDK |
| B. 全 GDScript | 规则、会话、投影全部重写为 GDScript | 语言最统一，但泛型、类型约束和测试工具较弱，2 万多行规则重写回归风险最高 |
| C. 保留 TypeScript + 打包 Node | 不改规则，把 Node 运行时、`dist` 和资料目录打进 Windows 导出 | 最快解决“启动要装 Node/开控制台”，但不是纯 Godot |

### 5.2 推荐迁移阶段

1. **冻结契约和 golden view**：先不改规则，保存 08 的 bootstrap、开局部署、移动、右键菜单、阶段推进视图快照，作为迁移后的逐项对照。
2. **08 原生纵向切片**：在 Godot 内实现数据加载、08 开局部署、地图投影和基础命令；范围只做 08，不碰 01/09 和全部战斗。Node 继续作为对照 oracle。
3. **按模块迁移 rules**：`packages/series` 与 `src/match` 逐模块迁移；同一组命令分别跑 TS 和 Godot 内核，比较 revision、盘面、库存和视图。差分测试通过才切换入口。
4. **接 01/09 战役**：01/09 目前没有 Godot 地图桥接，纯 Godot 迁移等于顺带补齐这两条链路，属于额外工作量，不混在 UI 迁移里。
5. **删 Node 并做导出**：所有入口切到原生内核、629 个用例迁完或等价覆盖后，移除 `desktop/local`、`bridge` 和 Node 依赖，做 Windows 导出。

首个可验收切片建议限定为：**08 开局部署 + 地图投影 + 基础移动/右键菜单**。不要一开始就做全剧本、战斗、补给和空军；那些是迁移后期的独立门禁。

## 6 接手第一动作

1. 拉取 `main` 到 `d7bf506`，确认工作树干净。
2. 跑 `npm --prefix "D:\OCS\OCS_EASTERN" run check`，再跑 Godot 无头解析。
3. 手动启动主页面，走一遍“单机 SOLO → 08 → 进入检查 → 返回主页面”。
4. 如果继续 UI：先补 01/09 战役桥接和 08 地图内交互回归；如果转纯 Godot：先写迁移设计文档并开独立分支，不要直接在 `main` 上删 Node。
5. 纯 Godot 开工前必须先定：**C# 还是全 GDScript；先 08 还是全剧本一次到位。** 默认建议 C# + 08 先做。

## 7 相关文档

- [第三冬工程交接](2026-11-22-第三冬工程交接.md)
- [当前工作状态与缺口盘点](2026-11-26-当前工作状态与缺口盘点.md)
- [剧本01全机制验收基线](2026-11-27-剧本01全机制验收基线.md)
- [通规专规补全方案](2026-11-26-通规专规补全方案.md)
- [Godot 客户端说明](../godot/README.md)
- [开发规范](../../../AGENTS.md)
