extends RefCounted

## 会话接线用例：撤退续跑与刺猬作业经 `ScorpionMatch.submit` 的真实入口、以及侧栏菜单条目。
## 局面来自 08 撤退夹具（`suspended` 挂起场景）与 08 初设数据包（`s15.01` 轴心补给堆 16T、
## 两枚轴心战斗单位 `setup:land:id:4114:1` / `4072:1`）。
## 入口契约：static func run(ctx: Dictionary) -> void；ctx 提供 expect / compare / reject / state_slice / args。

const JsonFile := preload("res://scripts/data/json_file.gd")
const ScorpionMatch := preload("res://works/third-winter/scenarios/08-korsun-pocket/scorpion_match.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")
const CombatResult := preload("res://works/third-winter/rules/combat_result.gd")
const Crt := preload("res://scripts/rules/series/crt.gd")

const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"
const RETREAT_REL := "../../../dist/godot/08-retreat.json"
const WORKER := "setup:land:id:4114:1"
const BUILD_HEX := "s15.01"
const BUILD_DUMP := "axis:hex:s15.01"


static func run(ctx: Dictionary) -> void:
	var bundle := _read_json(BUNDLE_REL)
	if bundle.is_empty():
		ctx.expect.call(false, "08 初设数据包可读")
		return
	var fixture := _read_json(RETREAT_REL)
	if fixture.is_empty():
		ctx.expect.call(false, "08 撤退夹具可读")
	else:
		_continue_retreat(ctx, fixture, bundle)
	_hedgehog(ctx, bundle)


## 挂起撤退续跑：经会话入口先被夺取守卫拒绝；座位与无战斗两种拒绝也要走到规则层。
static func _continue_retreat(ctx: Dictionary, fixture: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var scenario := _scenario(fixture, "suspended")
	if scenario.is_empty():
		expect.call(false, "08 撤退夹具含挂起场景")
		return
	var steps: Array = scenario.get("steps", [])
	var suspend := _step(steps, "retreat-suspend")
	if suspend.is_empty():
		expect.call(false, "挂起场景缺少撤退挂起步")
		return
	var state: Dictionary = scenario.get("base", {}).duplicate(true)
	state["combat"] = steps[0].get("combat", {}).duplicate(true)
	var destination := str(scenario.get("destination", ""))
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if str(unit.get("side", "")) == "soviet" and unit.get("combat") != true:
			var truck: Dictionary = unit.duplicate(true)
			truck["hex"] = destination
			state.units[id] = truck
			break
	var board := {"table": Crt.load_table("").value}
	var resolved: Dictionary = CombatResult.resolve(state, "axis", suspend.get("action", {}), bundle, board)
	expect.call(bool(resolved.get("ok", false)), "挂起撤退局面可由规则层建立")
	if not resolved.get("ok", false):
		return
	var pending: Dictionary = resolved.value.state
	expect.call(pending.get("combat", {}).get("retreat") != null, "挂起局面带待决撤退进度")
	var guarded := _submit(pending, bundle, "continue-combat-retreat", {})
	expect.call(not guarded.ok and guarded.get("errorCode") == "capture_pending",
		"continue-combat-retreat 经会话入口被夺取守卫拒绝")
	var wrong_seat := _submit(pending, bundle, "continue-combat-retreat", {}, "soviet")
	expect.call(not wrong_seat.ok and wrong_seat.get("errorCode") == "combat_retreat_actor",
		"continue-combat-retreat 只认挂起撤退的一方")
	var bare: Dictionary = pending.duplicate(true)
	bare.erase("combat")
	var none := _submit(bare, bundle, "continue-combat-retreat", {})
	expect.call(not none.ok and none.get("errorCode") == "combat_missing",
		"无战斗局面经会话入口拒绝继续撤退")
	var menu: Array = ScorpionView.menu_entries(pending, "axis", {}, bundle)
	expect.call(_has_action(menu, "continue-combat-retreat"), "侧栏给出继续撤退条目")


## 刺猬作业：菜单条目直接作为命令载荷提交；首格 16T 支 8T 立 1 级刺猬。
static func _hedgehog(ctx: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var opening: Dictionary = bundle.get("opening", {})
	var state := {
		"kind": "playing",
		"turn": {"number": 1},
		"cursor": {"turn": 1, "phasing": "axis", "phase": "movement", "retention": 0},
		"units": (opening.get("units", {}) as Dictionary).duplicate(true),
		"dumps": (opening.get("dumps", {}) as Dictionary).duplicate(true),
		"pieces": [],
		"moved": [],
		"hedgehogs": {},
	}
	var units: Dictionary = state.units
	if not units.has(WORKER):
		expect.call(false, "初设数据包含刺猬作业单位 %s" % WORKER)
		return
	var menu: Array = ScorpionView.menu_entries(state, "axis", {"unitId": WORKER, "hex": BUILD_HEX}, bundle)
	var build := _action_of(menu, "work-hedgehog", "build")
	expect.call(not build.is_empty(), "侧栏在移动阶段给出构筑刺猬条目")
	if build.is_empty():
		return
	expect.call(str(build.get("hex", "")) == BUILD_HEX
		and (build.get("payments", []) as Array).size() == 1, "构筑条目带目标格与一条 8T 支付")
	var res := _submit(state, bundle, "work-hedgehog", build)
	expect.call(bool(res.get("ok", false)), "work-hedgehog 经会话入口构筑成功 · "
		+ str(res.get("errorCode", "")))
	if not res.get("ok", false):
		return
	var next: Dictionary = res.value.record.state
	var hedgehog: Dictionary = next.get("hedgehogs", {}).get(BUILD_HEX, {})
	expect.call(str(hedgehog.get("side", "")) == "axis" and int(hedgehog.get("level", 0)) == 1,
		"构筑后 s15.01 立起 1 级刺猬")
	expect.call(int(next.get("dumps", {}).get(BUILD_DUMP, {}).get("tokens", 0)) == 8,
		"支走 8T 后补给堆剩 8T")
	expect.call(next.get("moved", []).has(WORKER), "作业单位计入已动")
	var again := _submit(next, bundle, "work-hedgehog", build)
	expect.call(not again.ok and again.get("errorCode") == "hedgehog_once_per_turn",
		"同回合同格不得再次作业")
	var reduce := {"type": "work-hedgehog", "operation": "reduce", "hex": BUILD_HEX,
		"unitIds": [WORKER], "payments": []}
	var wrong_phase: Dictionary = state.duplicate(true)
	(wrong_phase["cursor"] as Dictionary)["phase"] = "combat"
	var rejected := _submit(wrong_phase, bundle, "work-hedgehog", reduce)
	expect.call(not rejected.ok and rejected.get("errorCode") == "hedgehog_phase",
		"非移动阶段经会话入口拒绝刺猬作业")
	var rejected_menu: Array = ScorpionView.menu_entries(wrong_phase, "axis",
		{"unitId": WORKER, "hex": BUILD_HEX}, bundle)
	expect.call(not _has_group(rejected_menu, "刺猬"), "非移动阶段侧栏不列刺猬作业")


static func _submit(state: Dictionary, bundle: Dictionary, action_type: String, extra: Dictionary,
		seat: String = "axis") -> Dictionary:
	var action := {"type": action_type}
	action.merge(extra, true)
	var record := {"state": state.duplicate(true), "revision": 0, "receipts": []}
	var res := ScorpionMatch.submit(record, seat,
		{"id": "wire:" + action_type, "expectedRevision": 0, "action": action}, bundle)
	return res


static func _has_action(menu: Array, action_type: String) -> bool:
	for entry: Dictionary in menu:
		for act: Dictionary in entry.get("actions", []):
			if str(act.get("type", "")) == action_type:
				return true
	return false


static func _action_of(menu: Array, action_type: String, operation: String) -> Dictionary:
	for entry: Dictionary in menu:
		for act: Dictionary in entry.get("actions", []):
			if str(act.get("type", "")) == action_type and str(act.get("operation", "")) == operation:
				return act
	return {}


static func _has_group(menu: Array, group: String) -> bool:
	for entry: Dictionary in menu:
		if str(entry.get("group", "")) == group:
			return true
	return false


static func _scenario(fixture: Dictionary, name: String) -> Dictionary:
	for scenario: Dictionary in fixture.get("scenarios", []):
		if str(scenario.get("name", "")) == name:
			return scenario
	return {}


static func _step(steps: Array, step: String) -> Dictionary:
	for entry: Dictionary in steps:
		if str(entry.get("step", "")) == step:
			return entry
	return {}


static func _read_json(relative: String) -> Dictionary:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var path: String = (base + "/" + relative).simplify_path()
	var read: Dictionary = JsonFile.read(path)
	if not read.get("ok", false):
		return {}
	return read.value.document
