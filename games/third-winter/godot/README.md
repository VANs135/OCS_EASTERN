# EASTERN OCS · Godot 客户端

这是 `D:\OCS\OCS_EASTERN` 仓库内的正式 Godot 客户端目录。规则、命令校验、回合推进和存档全部由仓库内的 Node/TypeScript 引擎完成；Godot 不复制任何规则。

当前桥接复用 **08 瓶中蝎** 桌面控制器（`openLocalScorpion`），所以画面是 Scorpion 地图/初设，不是 09 基洛沃格勒战役。09 的 `campaign-match` 桥接尚未建立；规则补全不影响这个显示层。

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

默认存档为 `user://eastern-godot-save.json`（Godot 用户目录），不会写进仓库。

Godot AI 插件不再随仓库 vendored。需要编辑期 AI 时，单独把 4.4.2 插件放进 `addons/godot_ai` 并在编辑器启用；游戏运行不依赖它。

## 已实现

- 真实地图 `Scorpion-Map-200929.png`、地图盒区、当前地图堆叠和算子图。
- 左键格/算子选择，右键打开动作菜单，中键拖动，滚轮缩放。
- 侧栏显示当前阶段、修订号、当前视图的 `actions` / `menu` / `stack` / 前 24 枚 `roster`。
- 侧栏按钮提交 `apply`，单位按钮提交 `select-unit`；提交后由引擎返回新视图。
- 地图变化、行动方切换、部署阶段推进都随 `view` 刷新。

## 当前限制

- 同格多页算子目前只画第一页；分页按钮未接。
- 辅助卡、战斗草稿、撤退路径、补给应答等专用面板尚未全部图形化；当前通过 `actions` / `menu` 转发。
- 相机初始适配全图；点击侧栏动作后相机可能因输入事件偏移，尚未做“重置视图”按钮。
- 未接联网对局、服务端席位和持久化网关。

## 下一步

1. 建立 09 战役 `campaign-match` 桥接（当前仍是 08 瓶中蝎控制器），再谈正式 UI。
2. 为 `combatDecision`、`airDecision`、`supplyDecision` 做专用应答面板，而不是只依赖通用按钮。
3. 增加堆叠分页、辅助卡页签和“新局/重置视图”控制。
4. 做 Windows 导出并把 Node 运行时、`dist` 和资料目录一起纳入安装包。
