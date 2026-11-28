extends RefCounted

## OCS 12.7d–f / TTW 3.6 — 延补队崩溃：玩家选落点、翻回普通运输队、清空载货并记已行动；
## 被夺取时按 TS scorpion-capture 同序先算落点，有落点的挂夺取窗口，无落点的原地翻回。

const JsonFile := preload("res://scripts/data/json_file.gd")
const Extender := preload("res://works/third-winter/rules/extender.gd")
const Capture := preload("res://works/third-winter/rules/capture.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")

const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var bundle: Dictionary = _read_json(BUNDLE_REL)
	if bundle.is_empty():
		expect.call(false, "08 初设数据包可读")
		return
	var state: Dictionary = _base_state(bundle)
	var extender_id := "test:extender:1"
	state.units[extender_id] = {
		"id": extender_id, "side": "axis", "definition": "test:extender", "hex": "s13.11",
		"combat": false, "mobility": "truck", "allowance": 10, "stepsLost": 0,
		"transportCargoTokens": 2, "extender": {"range": 20, "asset": "test"},
	}
	var plan: Dictionary = Extender.displacements(state, "axis", [extender_id], bundle)[0]
	expect.call((plan.get("destinations", []) as Array).size() > 0, "延补队在射程内找到有补给的崩溃落点")
	if (plan.get("destinations", []) as Array).is_empty():
		return
	var destination: String = plan.destinations[0]

	var collapsed: Dictionary = Extender.collapse(state, "axis",
		{"unitId": extender_id, "destination": destination}, bundle)
	expect.call(collapsed.ok, "延补队可崩溃到射程内有补给的格 · " + str(collapsed.get("errorCode", "")))
	if not collapsed.ok:
		return
	var unit: Dictionary = collapsed.value.units[extender_id]
	expect.call(str(unit.get("hex", "")) == destination, "崩溃后延补队落到选择格")
	expect.call(unit.get("extender") == null, "崩溃后清除延补标记")
	expect.call(int(unit.get("transportCargoTokens", -1)) == 0, "崩溃后清空运输载货")
	expect.call((collapsed.value.moved as Array).has(extender_id), "崩溃记入本阶段已行动")
	expect.call(Extender.collapse(state, "soviet",
		{"unitId": extender_id, "destination": destination}, bundle).get("errorCode") == "extender_window",
		"敌方不能崩溃本方延补队")
	var wrong_phase: Dictionary = state.duplicate(true)
	wrong_phase.cursor.phase = "combat"
	expect.call(Extender.collapse(wrong_phase, "axis",
		{"unitId": extender_id, "destination": destination}, bundle).get("errorCode") == "extender_window",
		"非移动阶段拒绝崩溃")
	expect.call(Extender.collapse(state, "axis",
		{"unitId": extender_id, "destination": "s99.99"}, bundle).get("errorCode") == "extender_destination",
		"射程外或没有补给的落点拒绝崩溃")
	expect.call(Extender.collapse(collapsed.value, "axis",
		{"unitId": extender_id, "destination": destination}, bundle).get("errorCode") == "extender_unit",
		"已翻回运输队的算子不再是延补队")

	# 夺取：敌方延补队在本方进格时先算崩溃落点，挂成待选窗口。
	var capture_state: Dictionary = _base_state(bundle)
	capture_state.units[extender_id] = {
		"id": extender_id, "side": "axis", "definition": "test:extender", "hex": "s1.10",
		"combat": false, "mobility": "truck", "allowance": 10, "stepsLost": 0,
		"transportCargoTokens": 2, "extender": {"range": 20, "asset": "test"},
	}
	var captured: Dictionary = Capture.resolve_entry(capture_state, "soviet", "s1.10",
		["setup:land:id:2073:1"], bundle)
	expect.call(captured.ok, "进格夺取接住敌方延补队 · " + str(captured.get("errorCode", "")))
	if not captured.ok:
		return
	var pending: Variant = captured.value.get("capture")
	expect.call(pending is Dictionary and not (pending.get("extenders", []) as Array).is_empty(),
		"有落点的延补队进入夺取窗口")
	if not (pending is Dictionary) or (pending.get("extenders", []) as Array).is_empty():
		return
	expect.call(Capture.needs_choice(pending), "延补队夺取需要玩家选崩溃落点")
	var offered: Array = pending.extenders[0].destinations
	var chosen: String = offered[0]
	var menu: Array = ScorpionView.menu_entries(captured.value, "axis", {}, bundle)
	var offered_row := false
	for row: Dictionary in menu:
		var actions: Array = row.get("actions", [])
		if not str(row.get("label", "")).contains("延补队") or actions.is_empty():
			continue
		var action: Dictionary = actions[0]
		if action.get("type") == "settle-capture" and not (action.get("extenders", []) as Array).is_empty():
			offered_row = true
			break
	expect.call(offered_row, "夺取侧栏把延补队落点写进结算载荷")
	var settled: Dictionary = Capture.settle(captured.value, "axis",
		{"extenders": [{"id": extender_id, "destination": chosen}]}, bundle)
	expect.call(settled.ok, "延补队夺取可按落点结算 · " + str(settled.get("errorCode", "")))
	if not settled.ok:
		return
	var after: Dictionary = settled.value.units[extender_id]
	expect.call(str(after.get("hex", "")) == chosen, "夺取后延补队崩溃到选择格")
	expect.call(after.get("extender") == null, "夺取后翻回普通运输队")
	expect.call(settled.value.get("capture") == null, "延补队结算后关闭夺取窗口")
	var latest: Dictionary = (settled.value.captureHistory as Array)[-1]
	expect.call(not (latest.get("extenders", []) as Array).is_empty()
		and str(latest.extenders[0].get("displacedTo", "")) == chosen, "夺取历史记录延补队崩溃落点")
	expect.call(Capture.settle(captured.value, "axis",
		{"extenders": [{"id": extender_id, "destination": "s99.99"}]}, bundle).get("errorCode") == "capture_settle_extender",
		"夺取窗口拒绝窗口外的崩溃落点")


static func _base_state(bundle: Dictionary) -> Dictionary:
	return {
		"kind": "playing",
		"turn": {"number": 1, "weather": {"ground": "freeze"},
			"step": {"kind": "player-turn", "first": "soviet", "retention": "soviet"}},
		"cursor": {"turn": 1, "first": "soviet", "phasing": "axis", "phase": "movement",
			"retention": "soviet"},
		"units": bundle.get("opening", {}).get("units", {}).duplicate(true),
		"dumps": bundle.get("opening", {}).get("dumps", {}).duplicate(true),
		"pieces": bundle.get("opening", {}).get("pieces", []).duplicate(true),
		"railControl": bundle.get("opening", {}).get("railControl", {}).duplicate(true),
		"moved": [], "combat": null, "combatTargets": [], "barrage": null,
		"captureHistory": [],
	}


static func _read_json(relative: String) -> Dictionary:
	var read: Dictionary = JsonFile.read(relative)
	return read.value.document if read.ok else {}
