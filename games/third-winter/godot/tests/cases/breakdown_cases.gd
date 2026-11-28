extends RefCounted

## 折分离场（OCS 20.0a/20.0d/20.0f）— 08 实库苏军近卫师。
## 覆盖：开始移动拆出、留最后一步、可拆候选、段末强制吸收窗口、并回返还 ID。
## 入口契约：static func run(ctx: Dictionary) -> void。

const JsonFile := preload("res://scripts/data/json_file.gd")
const ScorpionMatch := preload("res://works/third-winter/scenarios/08-korsun-pocket/scorpion_match.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")
const Breakdown := preload("res://works/third-winter/rules/breakdown.gd")

const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"
const PARENT := "setup:land:id:3064:1"
const COUNTER := "land:id:2575"


static func run(ctx: Dictionary) -> void:
	var bundle := _read_json(BUNDLE_REL)
	if bundle.is_empty():
		ctx.expect.call(false, "08 初设数据包可读")
		return
	_projection(ctx, bundle)
	_detach(ctx, bundle)
	_leave_last_step(ctx, bundle)
	_absorb(ctx, bundle)


static func _state(bundle: Dictionary) -> Dictionary:
	var opening: Dictionary = bundle.get("opening", {})
	return {
		"kind": "playing",
		"turn": {"number": 1},
		"cursor": {"turn": 1, "phasing": "soviet", "phase": "movement", "retention": 0},
		"units": (opening.get("units", {}) as Dictionary).duplicate(true),
		"pieces": (opening.get("pieces", []) as Array).duplicate(true),
		"dumps": (opening.get("dumps", {}) as Dictionary).duplicate(true),
		"moved": [],
		"groundActivity": {"airlifted": [], "spent": {}},
		"capture": null, "victory": null, "overrunMarch": null,
	}


static func _projection(ctx: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var rows: Array = bundle.view.get("breakdownRows", [])
	expect.call(rows.size() == 6, "08 实库投影 6 条拆分池")
	var parents: Dictionary = bundle.view.get("breakdownParents", {})
	expect.call(parents.get("land:id:3064", "") == "soviet:guard", "42 近卫师归入苏军近卫池")
	expect.call(parents.get("land:id:2073", "") == "soviet:regular", "58 师归入苏军普通池")
	expect.call(parents.get("land:id:2478", "") == "", "炮兵师不进入拆分池")
	var state := _state(bundle)
	var options: Array = Breakdown.options(state, "soviet", PARENT, bundle)
	expect.call(options.size() == 1 and str(options[0].definition) == COUNTER,
		"AR3 的 42 近卫师只能拆出 AR3 的 3-3-3")
	var menu: Array = ScorpionView.menu_entries(state, "soviet", {"unitId": PARENT}, bundle)
	expect.call(_count_type(menu, "detach-breakdown") == 1, "侧栏给出拆出条目")


static func _detach(ctx: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var state := _state(bundle)
	var menu: Array = ScorpionView.menu_entries(state, "soviet", {"unitId": PARENT}, bundle)
	var action := _action_of(menu, "detach-breakdown")
	expect.call(not action.is_empty(), "拆出动作存在")
	if action.is_empty():
		return
	var result := _submit(state, bundle, action)
	expect.call(result.ok, "开始移动拆出成功 · " + str(result.get("errorCode", "")))
	if not result.ok:
		return
	var after: Dictionary = result.value.record.state
	var child_id := "breakdown:%s:1" % COUNTER
	expect.call(after.units.has(child_id), "新拆分单位入盘")
	expect.call(int(after.units[PARENT].stepsLost) == 1, "母单位损一步")
	expect.call(str(after.units[child_id].hex) == "s4.12", "拆分单位与母单位同格")
	expect.call(int(after.units[child_id].stepsLost) == 0, "拆分单位满步")
	expect.call(not after.get("moved", []).has(PARENT), "拆出不算已移动")
	var second := _submit(after, bundle, action, 1)
	expect.call(second.ok, "未移动时可继续拆第二枚")
	if second.ok:
		expect.call(int(second.value.record.state.units[PARENT].stepsLost) == 2, "连续拆两步")


static func _leave_last_step(ctx: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var state := _state(bundle)
	state.units[PARENT]["stepsLost"] = 2
	var options: Array = Breakdown.options(state, "soviet", PARENT, bundle)
	expect.call(options.is_empty(), "母单位只剩最后一步时不再列候选")
	var action := {"type": "detach-breakdown", "parentId": PARENT, "definitions": [COUNTER]}
	var result := _submit(state, bundle, action)
	expect.call(not result.ok and result.get("errorCode") == "breakdown_count",
		"只剩最后一步时拆出被拒绝")
	var moved := _state(bundle)
	(moved["moved"] as Array).append(PARENT)
	var moved_result := _submit(moved, bundle, action)
	expect.call(not moved_result.ok and moved_result.get("errorCode") == "breakdown_window",
		"已开始移动后不能再拆")


static func _absorb(ctx: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var state := _state(bundle)
	var action := {"type": "detach-breakdown", "parentId": PARENT, "definitions": [COUNTER]}
	var detached := _submit(state, bundle, action)
	if not detached.ok:
		expect.call(false, "吸收前置拆出失败")
		return
	var after: Dictionary = detached.value.record.state
	var child_id := "breakdown:%s:1" % COUNTER
	var gate := _submit(after, bundle, {"type": "complete-movement"}, 1)
	expect.call(gate.ok, "段末触及待吸收义务时返回成功窗口")
	if not gate.ok:
		return
	var windowed: Dictionary = gate.value.record.state
	expect.call(windowed.get("breakdownAbsorb") is Dictionary, "会话建立拆分吸收窗口")
	expect.call((windowed.breakdownAbsorb.obligations as Array).size() == 1,
		"窗口列出一条母单位义务")
	var menu: Array = ScorpionView.menu_entries(windowed, "soviet", {}, bundle)
	expect.call(_count_type(menu, "absorb-breakdown") == 1, "窗口侧栏只列吸收条目")
	var blocked := _submit(windowed, bundle, {"type": "complete-movement"}, 2)
	expect.call(not blocked.ok and blocked.get("errorCode") == "breakdown_absorb_pending",
		"未吸收前不能结束移动")
	var absorbed := _submit(windowed, bundle, {"type": "absorb-breakdown", "parentId": PARENT,
		"breakdownId": child_id}, 2)
	expect.call(absorbed.ok, "吸收成功 · " + str(absorbed.get("errorCode", "")))
	if not absorbed.ok:
		return
	var final: Dictionary = absorbed.value.record.state
	expect.call(not final.units.has(child_id), "吸收后拆分单位出盘")
	expect.call(int(final.units[PARENT].stepsLost) == 0, "母单位恢复一步")
	expect.call((final.get("breakdownReturns", {}).get(COUNTER, []) as Array).has(child_id),
		"吸收后拆分 ID 记入返还池")
	expect.call(final.get("breakdownAbsorb") == null, "义务清空后窗口关闭")


static func _submit(state: Dictionary, bundle: Dictionary, action: Dictionary, expected_revision: int = 0) -> Dictionary:
	var record := {"state": state.duplicate(true), "revision": expected_revision, "receipts": []}
	return ScorpionMatch.submit(record, "soviet",
		{"id": "breakdown:%s:%s:%d" % [str(action.get("type", "")), str(action.get("parentId", "")), expected_revision],
			"expectedRevision": expected_revision, "action": action}, bundle)


static func _action_of(menu: Array, type_name: String) -> Dictionary:
	for entry: Dictionary in menu:
		for action: Dictionary in entry.get("actions", []):
			if str(action.get("type", "")) == type_name:
				return action.duplicate(true)
	return {}


static func _count_type(menu: Array, type_name: String) -> int:
	var count := 0
	for entry: Dictionary in menu:
		for action: Dictionary in entry.get("actions", []):
			if str(action.get("type", "")) == type_name:
				count += 1
	return count


static func _read_json(relative: String) -> Dictionary:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var read: Dictionary = JsonFile.read((base + "/" + relative).simplify_path())
	if read.get("ok", false):
		return read.value.document
	return {}



