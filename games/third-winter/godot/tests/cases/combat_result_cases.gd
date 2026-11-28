extends RefCounted

## TTW 2.4d / OCS 9.11 — 战果侧栏：合法损失序列 + 多落点残部选择。

const JsonFile := preload("res://scripts/data/json_file.gd")
const CombatResult := preload("res://works/third-winter/rules/combat_result.gd")
const CombatLosses := preload("res://works/third-winter/rules/combat_losses.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")
const ScorpionMatch := preload("res://works/third-winter/scenarios/08-korsun-pocket/scorpion_match.gd")

const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"
const ATTACKER := "setup:land:id:2069:1"
const DEFENDER := "setup:land:id:3967:1"
const TARGET := "s4.11"


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var bundle: Dictionary = _read_json(BUNDLE_REL)
	if bundle.is_empty():
		expect.call(false, "08 初设数据包可读（战果侧栏）")
		return
	var state := _state(bundle)
	var options: Array = CombatResult.resolve_options(state, "axis", bundle)
	expect.call(options.size() >= 2, "198 师被打光时给出两个残部落点行 · " + str(options.size()))
	if options.is_empty():
		return
	for option: Dictionary in options:
		var action: Dictionary = option.get("action", {})
		expect.call(str(action.get("type")) == "resolve-combat", "战果行动作类型正确")
		expect.call(action.get("lossOrder", []) == [DEFENDER, DEFENDER],
			"两点损失按 AR 领导先受、轮转落在同一枚参战师")
	var hexxes := {}
	for option: Dictionary in options:
		for remnant: Dictionary in option.get("remnants", []):
			if str(remnant.get("divisionId", "")) == DEFENDER:
				hexxes[str(remnant.get("hex", ""))] = true
	expect.call(hexxes.has("s2.10") and hexxes.has("s3.10"), "残部候选覆盖 s2.10 与 s3.10")
	var menu: Array = ScorpionView.menu_entries(state, "axis", {}, bundle)
	expect.call(_count_type(menu, "resolve-combat") == options.size(), "侧栏为每个合法分配出一行")
	var titled := false
	for row: Dictionary in menu:
		if str(row.get("label", "")).contains("残部"):
			titled = true
	expect.call(titled, "战果行标注残部去向")
	var chosen: Dictionary = options[0]
	var action: Dictionary = chosen.get("action", {})
	var remnant_hex := ""
	for remnant: Dictionary in chosen.get("remnants", []):
		if str(remnant.get("divisionId", "")) == DEFENDER:
			remnant_hex = str(remnant.get("hex", ""))
			break
	expect.call(remnant_hex != "", "选中行带有残部落点")
	if remnant_hex == "":
		return
	var applied: Dictionary = CombatLosses.apply_losses(state, {DEFENDER: 2}, bundle, null,
		action.get("remnants", []))
	expect.call(applied.ok, "按战果行落地损失与残部 · " + str(applied.get("errorCode", "")))
	if not applied.ok:
		return
	var via_result: Dictionary = CombatResult.resolve(state, "axis", action, bundle)
	expect.call(via_result.ok, "战果行可直接交给战斗结算 · " + str(via_result.get("errorCode", "")))
	if not via_result.ok:
		return
	var next_combat: Variant = via_result.value.state.get("combat")
	expect.call(next_combat == null or str(next_combat.get("step", "")) == "advance",
		"守方清空后进入攻方进击窗口或清战斗")
	var now: Dictionary = applied.value.state
	expect.call(not now.get("units", {}).has(DEFENDER), "198 师从盘面移除")
	var placed := false
	for remnant: Dictionary in applied.value.get("remnants", []):
		if str(remnant.get("divisionId", "")) == DEFENDER:
			placed = str(remnant.get("hex", "")) == remnant_hex \
				and now.get("units", {}).has(str(remnant.get("remnantId", "")))
	expect.call(placed, "残部落在所选格并进入盘面")
	_check_session_pending(expect, bundle)


## 会话层：不带残部选择的 resolve-combat 不丢状态，先生成待决窗口；选中后重放并清窗。
static func _check_session_pending(expect: Callable, bundle: Dictionary) -> void:
	var state := _state(bundle)
	var bare := {"type": "resolve-combat", "lossOrder": [DEFENDER, DEFENDER],
		"optionLosses": 0, "ignoreDefenderOption": false, "retreats": [], "remnants": []}
	var refused: Dictionary = ScorpionMatch._apply(state, "axis", bare, bundle)
	expect.call(refused.ok, "会话把多落点残部失败转成待决窗口 · " + str(refused.get("errorCode", "")))
	if not refused.ok:
		return
	var waiting: Dictionary = refused.value
	expect.call(waiting.get("pendingCombat") is Dictionary, "状态带 pendingCombat")
	expect.call(waiting.get("units", {}).has(DEFENDER), "待决窗口不改盘面")
	var blocked: Dictionary = ScorpionMatch._apply(waiting, "axis", {"type": "pass-alert"}, bundle)
	expect.call(not blocked.ok and str(blocked.get("errorCode", "")) == "combat_pending",
		"待决残部时挡住其它命令")
	var menu: Array = ScorpionView.menu_entries(waiting, "axis", {}, bundle)
	expect.call(_count_type(menu, "resolve-combat") == 2, "待决窗口列出两个落点行")
	var only_remnants := true
	for row: Dictionary in menu:
		for action: Dictionary in row.get("actions", []):
			if str(action.get("type", "")) == "resolve-combat" \
					and (action.get("remnants", []) as Array).is_empty():
				only_remnants = false
	expect.call(only_remnants, "待决窗口只列补落点命令")
	var picked: Dictionary = {}
	for row: Dictionary in menu:
		for action: Dictionary in row.get("actions", []):
			if str(action.get("type", "")) == "resolve-combat" and picked.is_empty():
				picked = action
				break
		if not picked.is_empty():
			break
	expect.call(not picked.is_empty(), "可从待决窗口取一条落点命令")
	if picked.is_empty():
		return
	var done: Dictionary = ScorpionMatch._apply(waiting, "axis", picked, bundle)
	expect.call(done.ok, "待决落点重放可结算 · " + str(done.get("errorCode", "")))
	if not done.ok:
		return
	expect.call(done.value.get("pendingCombat") == null, "结算成功后清待决窗口")
	expect.call(not done.value.get("units", {}).has(DEFENDER), "重放后 198 师出盘")


static func _state(bundle: Dictionary) -> Dictionary:
	var opening: Dictionary = bundle.get("opening", {})
	return {
		"kind": "playing",
		"turn": {"number": 1, "step": {"kind": "player-turn"},
			"weather": {"ground": "freeze", "flight": "clear"}},
		"cursor": {"turn": 1, "phasing": "axis", "phase": "combat"},
		"units": (opening.get("units", {}) as Dictionary).duplicate(true),
		"pieces": (opening.get("pieces", []) as Array).duplicate(true),
		"dumps": (opening.get("dumps", {}) as Dictionary).duplicate(true),
		"railControl": {}, "moved": [], "combatTargets": [], "combatAttackers": [],
		"combat": {"kind": "regular", "step": "defender-result", "attacker": "soviet",
			"target": TARGET, "attackers": [ATTACKER], "defenders": [DEFENDER],
			"attackerLeader": ATTACKER, "defenderLeader": DEFENDER,
			"roll": {"attacker": {"loss": 0, "option": 0},
				"defender": {"loss": 2, "option": 1}, "exploit": null},
			"defenderMayIgnore": false, "terrain": "clear"},
		"barrage": null, "capture": null, "victory": null, "overrunMarch": null,
		"groundActivity": {"airlifted": [], "spent": {}}, "groundCaptureMove": null,
		"barrageHistory": [],
	}


static func _count_type(menu: Array, type_name: String) -> int:
	var count := 0
	for row: Dictionary in menu:
		for action: Dictionary in row.get("actions", []):
			if str(action.get("type", "")) == type_name:
				count += 1
	return count


static func _read_json(relative: String) -> Dictionary:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var read: Dictionary = JsonFile.read((base + "/" + relative).simplify_path())
	if read.get("ok", false):
		return read.value.document
	return {}
