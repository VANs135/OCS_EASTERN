extends RefCounted

## 第三冬地面炮兵炮击对照用例（src/match/scorpion-barrage.ts）。
## 期望值全部来自 dist/godot/08-barrage.json（由 scripts/godot-barrage.mjs 用 TS 函数算出）。
## 入口契约：static func run(ctx: Dictionary) -> void。
## 覆盖：声明 → 选地形 → 分配损失成功路径；无观察者（地面炮击不守卫观察者，仅 -3 修正）；
## 拒绝路径：补给不足、补给不可追溯、超射程、阶段不允许、同格重复、分配重复、损失超额。

const JsonFile := preload("res://scripts/data/json_file.gd")
const Barrage := preload("res://works/third-winter/rules/barrage.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")

const FIXTURE_REL := "../../../dist/godot/08-barrage.json"
const EPSILON := 1e-9


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var fixture_path: String = _fixture_path()
	var read: Dictionary = JsonFile.read(fixture_path)
	if not read.get("ok", false):
		expect.call(false, "08 地面炮击对照夹具可读 · " + str(read.get("errorMessage", fixture_path)))
		return
	var fixture: Dictionary = read.value.document
	var data := _build_data(fixture)

	for case: Dictionary in fixture.get("cases", []):
		var case_id := str(case.get("id", ""))
		var state: Dictionary = case.get("state", {}).duplicate(true)
		var actions: Array = case.get("actions", [])
		var reject: Variant = case.get("reject")
		if reject != null:
			_check_reject(ctx, state, data, actions[0], reject, case_id)
		else:
			_check_accepted(ctx, state, data, actions, case.get("steps", []), case_id)
			_check_menu_payment(ctx, state, data, actions[0], case_id)


static func _build_data(fixture: Dictionary) -> Dictionary:
	var data_slice: Dictionary = fixture.get("data", {})
	var view: Dictionary = data_slice.get("view", {})
	return {
		"view": {
			"mapGraph": view.get("mapGraph", {}),
			"catalog": view.get("catalog", {}),
			"supplySources": view.get("supplySources", {}),
			"firstTurn": view.get("firstTurn", {}),
		},
		"deployment": data_slice.get("deployment", {}),
		"barrageTable": fixture.get("barrageTable", {}),
	}


static func _check_accepted(ctx: Dictionary, state: Dictionary, data: Dictionary, actions: Array,
		steps: Array, case_id: String) -> void:
	var expect: Callable = ctx.expect
	for index in actions.size():
		var action: Dictionary = actions[index]
		var actor := _actor_for(state, action)
		var result: Dictionary = Barrage.apply(state, actor, action, data)
		expect.call(result.ok, "08 炮击 %s 第 %d 步被接受 · %s" % [
			case_id, index + 1, str(result.get("errorMessage", ""))])
		if not result.ok:
			return
		state = result.value
		var after: Dictionary = steps[index].get("after", {})
		_compare_slice(ctx, state, after, "%s 第 %d 步" % [case_id, index + 1])


static func _check_menu_payment(ctx: Dictionary, state: Dictionary, data: Dictionary,
		action: Dictionary, case_id: String) -> void:
	var expect: Callable = ctx.expect
	if str(action.get("type", "")) != "declare-artillery-barrage":
		return
	var target := str(action.get("target", ""))
	var menu: Array = ScorpionView.menu_entries(state, "soviet", {"hex": target}, data)
	var row: Dictionary = {}
	for candidate: Dictionary in menu:
		for entry: Dictionary in candidate.get("actions", []):
			if str(entry.get("type", "")) == "declare-artillery-barrage":
				row = entry
				break
		if not row.is_empty():
			break
	expect.call(not row.is_empty(), "08 炮击 %s 侧栏给出炮击条目" % case_id)
	if row.is_empty():
		return
	var preview: Dictionary = Barrage.volley_preview(state, "soviet",
		{"target": target, "batteries": row.get("batteries", [])}, data)
	if preview.get("ok", false) != true:
		expect.call(false, "08 炮击 %s 侧栏齐射可预演 · %s" % [case_id, str(preview.get("errorMessage", ""))])
		return
	var cost := int(preview.value.get("cost", 0))
	var total := 0
	for payment: Dictionary in row.get("supply", {}).get("payments", []):
		total += int(payment.get("tokens", 0))
	expect.call(total == cost and cost > 0,
		"08 炮击 %s 侧栏按整轮齐射费用支付（%d/%dT）" % [case_id, total, cost])
	var hq_row: Dictionary = {}
	for candidate: Dictionary in menu:
		for entry: Dictionary in candidate.get("actions", []):
			if str(entry.get("type", "")) == "declare-artillery-barrage" \
					and str(entry.get("supply", {}).get("kind", "")) == "hq":
				hq_row = entry
				break
		if not hq_row.is_empty():
			break
	expect.call(not hq_row.is_empty(), "08 炮击 %s 侧栏给出经共同司令部支付行" % case_id)
	if not hq_row.is_empty():
		var paid: Dictionary = Barrage.apply(state.duplicate(true), "soviet", hq_row, data)
		expect.call(paid.ok, "08 炮击 %s 共同司令部支付可宣告 · %s" % [case_id, str(paid.get("errorCode", ""))])


static func _check_reject(ctx: Dictionary, state: Dictionary, data: Dictionary, action: Dictionary,
		reject: Dictionary, case_id: String) -> void:
	var expect: Callable = ctx.expect
	var actor := _actor_for(state, action)
	var result: Dictionary = Barrage.apply(state, actor, action, data)
	var expected_code := str(reject.get("code", ""))
	expect.call(not result.ok and str(result.get("errorCode", "")) == expected_code,
		"08 炮击 %s 拒绝 · %s（实际 %s / %s）" % [
			case_id, expected_code, str(result.get("errorCode", "")), str(result.get("errorMessage", ""))])
	# 拒绝不得改动盘面：炮击台账与待决炮击保持原状。
	var before: Dictionary = reject.get("state", {})
	if before.is_empty():
		return
	_compare_slice(ctx, state, before, case_id + " 拒绝保持盘面")


static func _actor_for(state: Dictionary, action: Dictionary) -> String:
	if str(action.get("type")) == "declare-artillery-barrage":
		# 夹具所有进攻方均为苏军；应答方由待决炮击的 defender 字段给出。
		return "soviet"
	var barrage: Variant = state.get("barrage")
	if barrage != null and barrage is Dictionary:
		return str(barrage.get("defender", "axis"))
	return "axis"


static func _compare_slice(ctx: Dictionary, state: Dictionary, after: Dictionary, label: String) -> void:
	var expect: Callable = ctx.expect
	var expected_units: Dictionary = after.get("units", {})
	var actual_units := {}
	for id: String in expected_units:
		actual_units[id] = _project_unit(state.get("units", {}).get(id, null))
	var actual_dumps := {}
	for dump_id: String in state.get("dumps", {}):
		var dump: Dictionary = state.get("dumps", {}).get(dump_id, {})
		actual_dumps[dump_id] = {
			"side": str(dump.get("side", "")), "location": str(dump.get("location", "")),
			"tokens": int(dump.get("tokens", 0)),
		}
	var actual := {
		"units": actual_units, "dumps": actual_dumps,
		"barrage": state.get("barrage", null),
		"barrageHistory": state.get("barrageHistory", []),
	}
	var expected_dumps := {}
	for dump_id: String in after.get("dumps", {}):
		var dump: Dictionary = after.get("dumps", {}).get(dump_id, {})
		expected_dumps[dump_id] = {
			"side": str(dump.get("side", "")), "location": str(dump.get("location", "")),
			"tokens": int(dump.get("tokens", 0)),
		}
	var expected := {
		"units": expected_units, "dumps": expected_dumps,
		"barrage": after.get("barrage", null),
		"barrageHistory": after.get("barrageHistory", []),
	}
	expect.call(_same(actual, expected), label)


## 与生成器 sliceUnit 对齐的单位投影：只保留盘上持久字段，剔除派生面数值，缺省补齐标记位。
static func _project_unit(unit: Variant) -> Variant:
	if unit == null:
		return null
	var source: Dictionary = unit
	var artillery: Variant = source.get("artillery")
	var art: Variant = null
	if artillery is Dictionary:
		art = {
			"strength": int(artillery.get("strength", 0)),
			"range": int(artillery.get("range", 0)),
			"independentRe": artillery.get("independentRe") == true,
		}
	return {
		"side": str(source.get("side", "")), "hex": str(source.get("hex", "")),
		"definition": str(source.get("definition", "")), "combat": source.get("combat", false) == true,
		"artillery": art, "printedRe": int(source.get("printedRe", 0)),
		"stepsLost": int(source.get("stepsLost", 0)), "formation": source.get("formation", null),
		"reserve": source.get("reserve", null),
		"disorganized": source.get("disorganized", false) == true,
		"released": source.get("released", false) == true,
		"exploit": source.get("exploit", false) == true,
		"moveMode": source.get("moveMode", false) == true,
	}


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


static func _fixture_path() -> String:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	return (base + "/" + FIXTURE_REL).simplify_path()
