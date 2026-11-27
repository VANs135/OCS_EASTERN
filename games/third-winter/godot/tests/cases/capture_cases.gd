extends RefCounted

## 08 进格夺取规则对照用例。期望值来自 dist/godot/08-capture.json
## （scripts/godot-capture.mjs 用 TS 引擎在同一份伪造局面上跑 resolveScorpionEntry /
## settleScorpionCapture：补给堆夺取骰、刺猬降级、机场翻面、停机飞机位移、运输队窗口与
## 明确的配属结算、预备单位夺取拒绝）。
## 入口契约：static func run(ctx: Dictionary) -> void；ctx 提供 expect / compare / reject / state_slice / args。

const JsonFile := preload("res://scripts/data/json_file.gd")
const Capture := preload("res://works/third-winter/rules/capture.gd")
const ScorpionMatch := preload("res://works/third-winter/scenarios/08-korsun-pocket/scorpion_match.gd")

const FIXTURE_REL := "../../../dist/godot/08-capture.json"
const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"


static func run(ctx: Dictionary) -> void:
	var fixture: Dictionary = _read_json(FIXTURE_REL)
	var bundle: Dictionary = _read_json(BUNDLE_REL)
	if fixture.is_empty() or bundle.is_empty():
		ctx.expect.call(false, "08 进格夺取对照夹具与初设数据包可读")
		return
	for scenario: Dictionary in fixture.get("scenarios", []):
		_compare_scenario(ctx, scenario, bundle)
	_unit_tables(ctx)
	_settle_rejections(ctx, fixture, bundle)
	_session_guard(ctx, fixture, bundle)


## 逐场景回放：entry 一步（无窗口则等于终局），有 settle 步再回放配属结算。
static func _compare_scenario(ctx: Dictionary, scenario: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var label := str(scenario.get("name", ""))
	var steps: Array = scenario.get("steps", [])
	var state: Dictionary = scenario.get("base", {}).duplicate(true)
	var entrants: Array = scenario.get("entrants", [])
	var side := str(scenario.get("outcome", {}).get("captorSide", ""))
	if side == "":
		side = "soviet" if label == "airbase-flip" else "axis"
	var res: Dictionary = Capture.resolve_entry(state, side, str(scenario.get("hex", "")), entrants,
		bundle, false)
	if steps.is_empty():
		expect.call(not res.ok and res.get("errorCode") == "capture_attack_capable",
			"%s 预备单位独自进格被拒绝" % label)
		return
	expect.call(res.ok, "进格夺取 · " + label + ("" if res.ok else " · " + str(res.get("errorMessage", ""))))
	if not res.ok:
		return
	state = res.value
	_compare_state(ctx, state, steps[0].get("state", {}), label + " entry")
	var settle: Dictionary = _step(steps, "settle")
	if settle.is_empty():
		return
	var owner := str((state.get("capture", {}) as Dictionary).get("owner", side))
	var settled: Dictionary = Capture.settle(state, owner, settle.get("action", {}), bundle)
	expect.call(settled.ok, "夺取结算 · " + label + ("" if settled.ok else " · " + str(settled.get("errorMessage", ""))))
	if not settled.ok:
		return
	_compare_state(ctx, settled.value, settle.get("state", {}), label + " settle")


## 状态切片：算子（含夺得算子）、补给堆、机场、刺猬、飞机、控制、窗口与历史逐项对照。
static func _compare_state(ctx: Dictionary, state: Dictionary, expected: Dictionary, label: String) -> void:
	var expect: Callable = ctx.expect
	# 夹具只切出相关算子（进格单位、被夺取运输队与夺得算子），盘面其余算子不参与对照。
	var units: Dictionary = state.get("units", {})
	var unit_ok := true
	for key: Variant in expected.get("units", {}):
		if not units.has(key) or not _same(units[key], expected.units[key]):
			unit_ok = false
			break
	expect.call(unit_ok, label + " 算子切片")
	expect.call(_same(state.get("dumps", {}), expected.get("dumps", {})), label + " 补给堆")
	expect.call(_same(state.get("airBases", []), expected.get("airBases", [])), label + " 机场")
	expect.call(_same(state.get("hedgehogs", {}), expected.get("hedgehogs", {})), label + " 刺猬")
	expect.call(_same(state.get("pieces", []), expected.get("pieces", [])), label + " 飞机与死人堆")
	expect.call(_same(state.get("railControl", {}), expected.get("railControl", {})), label + " 地面控制")
	expect.call(_same(state.get("capture"), expected.get("capture")), label + " 夺取窗口")
	expect.call(_same(state.get("captureHistory", []), expected.get("captureHistory", [])),
		label + " 夺取历史")
	expect.call(_same(state.get("rng", {}), expected.get("rng", {})), label + " 掷骰进度")
	expect.call(_same(state.get("moved", []), expected.get("moved", [])), label + " 已动算子")


## 纯表口径：夺取百分比（含四舍五入）、机场损失判定、运输队位移射程。
static func _unit_tables(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	expect.call(Capture.captured_amount(6, "dump", 2) == 2, "补给堆夺取 25% 取整")
	expect.call(Capture.captured_amount(6, "dump", 3) == 2, "补给堆夺取 25% 半值向上取整")
	expect.call(Capture.captured_amount(6, "dump", 6) == 5, "补给堆夺取 75% 取整")
	expect.call(Capture.captured_amount(4, "trucks", 1) == 0, "卡车骰面 1 不夺取")
	expect.call(Capture.captured_amount(4, "wagons", 6) == 4, "车队骰面 6 全夺")
	expect.call(Capture.captured_amount(3, "wagons", 4) == 2, "车队 50% 半值向上取整")
	expect.call(Capture.air_base_capture_loss(2, false, false), "机场损失骰 2 ≤ 6 即损失")
	expect.call(not Capture.air_base_capture_loss(7, false, false), "机场损失骰 7 不损失")
	expect.call(Capture.air_base_capture_loss(3, true, false), "在场飞机 +2 后仍损失")
	expect.call(not Capture.air_base_capture_loss(4, true, true), "在场且战后 +4 的骰面 4 不损失")


## 结算拒绝：非原属方、缺分配、越界点数、非法位移格。
static func _settle_rejections(ctx: Dictionary, fixture: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var scenario: Dictionary = _scenario_by_name(fixture, "transports")
	if scenario.is_empty():
		expect.call(false, "拒绝路径缺少运输队对照局面")
		return
	var entrants: Array = scenario.get("entrants", [])
	var entry: Dictionary = Capture.resolve_entry(scenario.get("base", {}).duplicate(true), "axis",
		str(scenario.get("hex", "")), entrants, bundle, false)
	expect.call(entry.ok and entry.value.get("capture") != null, "运输队窗口按手动策略挂起")
	if not entry.ok or entry.value.get("capture") == null:
		return
	var state: Dictionary = entry.value
	var capture: Dictionary = state.capture
	var member: Dictionary = (capture.transports[0] as Dictionary).members[0]
	# 非原属方提交。
	var wrong: Dictionary = Capture.settle(state, "axis", {"aircraft": [], "transports": []}, bundle)
	expect.call(not wrong.ok and wrong.get("errorCode") == "capture_settle_owner",
		"非原属方不能分配夺取对象")
	# 缺分配。
	var missing: Dictionary = Capture.settle(state, "soviet", {"aircraft": [], "transports": []}, bundle)
	expect.call(not missing.ok and missing.get("errorCode") == "capture_settle_choice",
		"缺少运输队分配时拒绝")
	# 越界点数。
	var overflow: Dictionary = Capture.settle(state, "soviet",
		{"aircraft": [], "transports": [{"id": str(member.get("id", "")),
			"takenPoints": int(member.get("points", 0)) + 1,
			"takenTokens": int(capture.transports[0].get("tokens", 0))}]}, bundle)
	expect.call(not overflow.ok and overflow.get("errorCode") == "capture_settle_choice",
		"夺取点数超出印刷运力时拒绝")
	# 非法位移格：余量存在却给本格或射程外。
	var group_points := int(capture.transports[0].get("points", 0))
	var group_tokens := int(capture.transports[0].get("tokens", 0))
	if group_points < int(member.get("points", 0)) or group_tokens < int(member.get("tokens", 0)):
		var same_hex: Dictionary = Capture.settle(state, "soviet",
			{"aircraft": [], "transports": [{"id": str(member.get("id", "")),
				"takenPoints": group_points, "takenTokens": group_tokens,
				"displacedTo": str(capture.get("hex", ""))}]}, bundle)
		expect.call(not same_hex.ok and same_hex.get("errorCode") == "capture_settle_displacement",
			"剩余运输队不能留在原格")
		var too_far: Dictionary = Capture.settle(state, "soviet",
			{"aircraft": [], "transports": [{"id": str(member.get("id", "")),
				"takenPoints": group_points, "takenTokens": group_tokens,
				"displacedTo": "s21.10"}]}, bundle)
		expect.call(not too_far.ok and too_far.get("errorCode") in ["capture_settle_displacement"],
			"剩余运输队不能位移到射程外")


## 会话守卫：夺取窗口未结算时其它命令一律被拒，settle-capture 交给规则层。
static func _session_guard(ctx: Dictionary, fixture: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var scenario: Dictionary = _scenario_by_name(fixture, "transports")
	if scenario.is_empty():
		return
	var state: Dictionary = scenario.get("base", {}).duplicate(true)
	var entry: Dictionary = Capture.resolve_entry(state, "axis", str(scenario.get("hex", "")),
		scenario.get("entrants", []), bundle, false)
	if not entry.ok:
		expect.call(false, "守卫用例前置夺取窗口可建立")
		return
	var pending: Dictionary = entry.value
	var blocked: Dictionary = _submit(pending, "axis", {"type": "end-phase"}, bundle)
	expect.call(not blocked.ok and blocked.get("errorCode") == "capture_pending",
		"夺取窗口待决时拒绝其它命令")
	var settle_wrong_seat: Dictionary = _submit(pending, "axis",
		{"type": "settle-capture", "aircraft": [], "transports": []}, bundle)
	expect.call(not settle_wrong_seat.ok and settle_wrong_seat.get("errorCode") == "capture_settle_owner",
		"settle-capture 分派到规则层并校验原属方")
	var no_window: Dictionary = pending.duplicate(true)
	no_window.erase("capture")
	var idle: Dictionary = _submit(no_window, "soviet",
		{"type": "settle-capture", "aircraft": [], "transports": []}, bundle)
	expect.call(not idle.ok and idle.get("errorCode") == "capture_missing",
		"无窗口时 settle-capture 明确失败")


static func _submit(state: Dictionary, seat: String, action: Dictionary, bundle: Dictionary) -> Dictionary:
	var record := {"state": state.duplicate(true), "revision": 0, "receipts": []}
	return ScorpionMatch.submit(record, seat,
		{"id": "capture:" + str(action.get("type", "")), "expectedRevision": 0, "action": action}, bundle)


static func _scenario_by_name(fixture: Dictionary, name: String) -> Dictionary:
	for scenario: Dictionary in fixture.get("scenarios", []):
		if str(scenario.get("name", "")) == name:
			return scenario
	return {}


static func _step(steps: Array, name: String) -> Dictionary:
	for step: Dictionary in steps:
		if str(step.get("step", "")) == name:
			return step
	return {}


static func _read_json(relative: String) -> Dictionary:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var path: String = (base + "/" + relative).simplify_path()
	var read: Dictionary = JsonFile.read(path)
	if not read.get("ok", false):
		return {}
	return read.value.document


static func _same(actual: Variant, expected: Variant) -> bool:
	if expected == null:
		return actual == null
	if actual is bool or expected is bool:
		return actual is bool and expected is bool and actual == expected
	if actual is int or actual is float or expected is int or expected is float:
		if not (actual is int or actual is float) or not (expected is int or expected is float):
			return false
		return absf(float(actual) - float(expected)) <= 1e-9
	if actual is String or expected is String:
		return actual is String and expected is String and actual == expected
	if actual is Array and expected is Array:
		if actual.size() != expected.size():
			return false
		for index: int in actual.size():
			if not _same(actual[index], expected[index]):
				return false
		return true
	if actual is Dictionary and expected is Dictionary:
		if actual.size() != expected.size():
			return false
		for key: Variant in expected:
			if not actual.has(key) or not _same(actual[key], expected[key]):
				return false
		return true
	return actual == expected
