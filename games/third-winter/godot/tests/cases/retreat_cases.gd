extends RefCounted

## 08 守方撤退与工事规则对照用例。期望值全部来自 dist/godot/08-retreat.json
## （scripts/godot-retreat.mjs 用 TS 引擎在同一份伪造局面上跑出：普通撤退、小河格边、
## ZOC 被迫损、歼灭进死人堆、工事等级修正、夺取挂起与续跑拒绝）。
## 入口契约：static func run(ctx: Dictionary) -> void；ctx 提供 expect / compare / reject / state_slice / args。

const JsonFile := preload("res://scripts/data/json_file.gd")
const CombatResult := preload("res://works/third-winter/rules/combat_result.gd")
const Retreat := preload("res://works/third-winter/rules/retreat.gd")
const Hedgehogs := preload("res://works/third-winter/rules/hedgehogs.gd")
const ScorpionMatch := preload("res://works/third-winter/scenarios/08-korsun-pocket/scorpion_match.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")
const Crt := preload("res://scripts/rules/series/crt.gd")

const FIXTURE_REL := "../../../dist/godot/08-retreat.json"
const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"


static func run(ctx: Dictionary) -> void:
	var fixture: Dictionary = _read_json(FIXTURE_REL)
	var bundle: Dictionary = _read_json(BUNDLE_REL)
	if fixture.is_empty() or bundle.is_empty():
		ctx.expect.call(false, "08 撤退对照夹具与初设数据包可读")
		return
	var table: Dictionary = Crt.load_table("").value
	var board: Dictionary = {"table": table}
	for scenario: Dictionary in fixture.get("scenarios", []):
		if str(scenario.get("name", "")) == "suspended":
			_compare_suspended(ctx, scenario, bundle, board)
		else:
			_compare_scenario(ctx, scenario, bundle, board)
	_reject_paths(ctx, bundle, board)
	_hedgehog_unit(ctx, bundle, board)
	_session_retreat_choices(ctx, fixture, bundle, board)


## 会话层撤退选择：空路线先出路线窗口；选 ZOC 路线后再出损步窗口；补选后按 TS 切片落地。
static func _session_retreat_choices(ctx: Dictionary, fixture: Dictionary, bundle: Dictionary,
		board: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var scenario: Dictionary = _scenario_by_name(fixture, "zoc-loss")
	if scenario.is_empty():
		expect.call(false, "会话撤退选择缺少 zoc-loss 场景")
		return
	var state: Dictionary = scenario.get("base", {}).duplicate(true)
	state.combat = scenario.get("steps", [])[0].get("combat", {}).duplicate(true)
	var defender_id: String = str(scenario.get("defenderId", ""))
	var bare := {"type": "resolve-combat", "lossOrder": [], "optionLosses": 0,
		"ignoreDefenderOption": false, "retreats": [], "remnants": []}
	var first: Dictionary = ScorpionMatch._apply(state, "axis", bare, bundle)
	expect.call(first.ok, "空撤退路线转成会话窗口 · " + str(first.get("errorCode", "")))
	if not first.ok:
		return
	var waiting: Dictionary = first.value
	var request: Dictionary = waiting.get("pendingRetreat", {}).get("pending", {})
	expect.call(str(request.get("kind", "")) == "retreat-route", "待决窗口记录路线选择")
	expect.call(waiting.get("units", {}).has(defender_id), "路线选择前盘面不变")
	var endpoints: Array = []
	for path: Array in request.get("options", []):
		if path.size() > 0:
			endpoints.append(str(path[-1]))
	expect.call(_same(endpoints, scenario.get("pathOptions", [])), "路线候选与 TS pathOptions 一致")
	var blocked: Dictionary = ScorpionMatch._apply(waiting, "axis", {"type": "pass-alert"}, bundle)
	expect.call(not blocked.ok and str(blocked.get("errorCode", "")) == "retreat_pending",
		"待决撤退时挡住其它命令")
	var menu: Array = ScorpionView.menu_entries(waiting, "axis", {}, bundle)
	expect.call(_count_retreat_actions(menu) == 3, "路线窗口列出三条合法终点")
	var route_action: Dictionary = _retreat_action(menu, "s2.10")
	expect.call(not route_action.is_empty(), "可从路线窗口取 s2.10 路线")
	if route_action.is_empty():
		return
	var second: Dictionary = ScorpionMatch._apply(waiting, "axis", route_action, bundle)
	expect.call(second.ok, "选定 ZOC 路线后进入损步窗口 · " + str(second.get("errorCode", "")))
	if not second.ok:
		return
	var zoc_state: Dictionary = second.value
	var zoc: Dictionary = zoc_state.get("pendingRetreat", {}).get("pending", {})
	expect.call(str(zoc.get("kind", "")) == "retreat-zoc-loss", "ZOC 格要求选择损步单位")
	expect.call(zoc.get("candidates", []).has(defender_id), "损步候选含 3951")
	var zoc_menu: Array = ScorpionView.menu_entries(zoc_state, "axis", {}, bundle)
	expect.call(_count_retreat_actions(zoc_menu) == 1, "ZOC 窗口列出一条损步行")
	var zoc_action: Dictionary = zoc_menu[0].get("actions", [])[0] if zoc_menu.size() > 0 else {}
	var third: Dictionary = ScorpionMatch._apply(zoc_state, "axis", zoc_action, bundle)
	expect.call(third.ok, "补 ZOC 损步后撤退结算 · " + str(third.get("errorCode", "")))
	if not third.ok:
		return
	var expected: Dictionary = scenario.get("steps", [])[1].get("units", {}).get(defender_id, {})
	expect.call(third.value.get("pendingRetreat") == null, "撤退成功后清空待决窗口")
	expect.call(_same(third.value.get("units", {}).get(defender_id), expected), "撤退落点与 TS 一致（s2.10、损一步）")
	var direct_action: Dictionary = _retreat_action(menu, "s1.09")
	var direct: Dictionary = ScorpionMatch._apply(waiting, "axis", direct_action, bundle)
	expect.call(direct.ok and direct.value.get("pendingRetreat") == null,
		"非 ZOC 路线选定后直接结算 · " + str(direct.get("errorCode", "")))
	if direct.ok:
		expect.call(str(direct.value.get("units", {}).get(defender_id, {}).get("hex", "")) == "s1.09",
			"非 ZOC 路线落到 s1.09")


static func _count_retreat_actions(menu: Array) -> int:
	var count := 0
	for row: Dictionary in menu:
		for action: Dictionary in row.get("actions", []):
			if str(action.get("type", "")) == "resolve-combat" and action.get("retreats", []).size() > 0:
				count += 1
	return count


static func _retreat_action(menu: Array, endpoint: String) -> Dictionary:
	for row: Dictionary in menu:
		for action: Dictionary in row.get("actions", []):
			for route: Dictionary in action.get("retreats", []):
				var path: Array = route.get("path", [])
				if path.size() > 0 and str(path[-1]) == endpoint:
					return action
	return {}


## 普通撤退 / 小河 / ZOC 损步 / 歼灭：回放守方结算并比对算子、死人堆与战斗记录切片。
static func _compare_scenario(ctx: Dictionary, scenario: Dictionary, bundle: Dictionary, board: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var label := str(scenario.get("name", ""))
	var attacker_id: String = str(scenario.get("attackerId", ""))
	var defender_id: String = str(scenario.get("defenderId", ""))
	var involved: Array = [attacker_id, defender_id]
	var steps: Array = scenario.get("steps", [])
	var forge: Dictionary = steps[0]
	var settle: Dictionary = _step(steps, "defender-result")
	if settle.is_empty():
		expect.call(false, "撤退场景 %s 缺少守方结算步" % label)
		return
	var state: Dictionary = scenario.get("base", {}).duplicate(true)
	state.combat = forge.get("combat", {}).duplicate(true)

	# 路径可选格与撤退资格直接对照 TS scorpionRetreatPathOptions / canScorpionRetreat。
	var route := {"origin": str(scenario.get("origin", "")), "units": [defender_id], "path": []}
	var options: Array = Retreat.path_options(state, "axis", route, state.combat, bundle)
	expect.call(_same(options, scenario.get("pathOptions", [])), "%s 撤退可选格" % label)
	var defender: Dictionary = state.get("units", {}).get(defender_id, {})
	expect.call(Retreat.can_retreat(defender, "axis", str(scenario.get("origin", "")), bundle) \
		== bool(scenario.get("canRetreat", false)), "%s 撤退资格" % label)

	var res: Dictionary = CombatResult.resolve(state, "axis", settle.get("action", {}), bundle, board)
	_expect_ok(expect, res, "守方撤退结算 · " + label)
	if not res.ok:
		return
	state = res.value.state
	_compare_step(ctx, state, settle, involved, label)
	expect.call(bool(scenario.get("outcome", {}).get("capturePending", false)) == false,
		"%s 普通撤退无夺取待决" % label)
	expect.call(bool(scenario.get("outcome", {}).get("retreatPending", false)) == false,
		"%s 撤退当场走完无待决路线" % label)


## 夺取挂起：守方撤退进入含苏运输队的格；resolve 挂起待决，continue 入口在夺取未结算时被拒绝。
static func _compare_suspended(ctx: Dictionary, scenario: Dictionary, bundle: Dictionary, board: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var label := str(scenario.get("name", ""))
	var attacker_id: String = str(scenario.get("attackerId", ""))
	var defender_id: String = str(scenario.get("defenderId", ""))
	var destination: String = str(scenario.get("destination", ""))
	var steps: Array = scenario.get("steps", [])
	var forge: Dictionary = steps[0]
	var suspend: Dictionary = _step(steps, "retreat-suspend")
	if suspend.is_empty():
		expect.call(false, "挂起场景 %s 缺少撤退挂起步" % label)
		return
	var state: Dictionary = scenario.get("base", {}).duplicate(true)
	state.combat = forge.get("combat", {}).duplicate(true)
	# 与生成器一致：把首名苏军非战斗运输队 relayed 到撤退格。
	var truck_id := ""
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if str(unit.get("side", "")) == "soviet" and unit.get("combat") != true:
			truck_id = id
			break
	expect.call(not truck_id.is_empty(), "%s 挂起局面存在苏军运输队" % label)
	if truck_id != "":
		var moved_truck: Dictionary = state.units[truck_id].duplicate(true)
		moved_truck["hex"] = destination
		state.units[truck_id] = moved_truck
	var involved: Array = [attacker_id, defender_id, truck_id]

	var res: Dictionary = CombatResult.resolve(state, "axis", suspend.get("action", {}), bundle, board)
	_expect_ok(expect, res, "守方撤退挂起 · " + label)
	if not res.ok:
		return
	state = res.value.state
	expect.call(state.get("capture") != null, "%s 挂起后登记待决夺取" % label)
	# 夺取掷骰分组（transports/aircraft 位移选择）本轮未落地；只对照夺取对象的身份字段。
	var expected_capture: Dictionary = suspend.get("capture", {})
	var actual_capture: Dictionary = state.get("capture", {})
	var capture_match: bool = str(actual_capture.get("hex", "")) == str(expected_capture.get("hex", "")) \
		and str(actual_capture.get("captor", "")) == str(expected_capture.get("captor", "")) \
		and str(actual_capture.get("owner", "")) == str(expected_capture.get("owner", ""))
	expect.call(capture_match, "%s 夺取对象格/夺取方/所有方与 TS 一致" % label)
	var pending: Variant = state.get("combat", {}).get("retreat")
	expect.call(pending != null, "%s 待决撤退进度写回战斗记录" % label)
	_compare_step(ctx, state, suspend, involved, label)

	# 夺取未结算前继续撤退必须被拒绝（resumeScorpionCombatRetreat 的 capture 守卫）。
	var continue_res: Dictionary = CombatResult.continue_retreat(state, "axis", {"routes": []}, bundle, board)
	expect.call(not continue_res.ok and continue_res.get("errorCode") == "capture_pending",
		"%s 待决夺取未结算时拒绝继续撤退" % label)


## 拒绝路径：阶段/顺序/路线合法性/堆叠/重复结算/ZOC 损失选择边界，逐条断言 errorCode。
static func _reject_paths(ctx: Dictionary, bundle: Dictionary, board: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var fixture: Dictionary = _read_json(FIXTURE_REL)
	var scenarios: Array = fixture.get("scenarios", [])
	if scenarios.is_empty():
		expect.call(false, "拒绝路径缺少对照局面")
		return
	var scenario: Dictionary = scenarios[0]
	var attacker_id: String = str(scenario.get("attackerId", ""))
	var defender_id: String = str(scenario.get("defenderId", ""))
	var destination: String = str(scenario.get("destination", ""))

	# 不在战斗结算步：守方在攻方窗口提交结算。
	var wrong_step: Dictionary = scenario.get("base", {}).duplicate(true)
	wrong_step.combat = scenario.get("steps", [])[0].get("combat", {}).duplicate(true)
	wrong_step.combat["step"] = "attacker-result"
	var res: Dictionary = CombatResult.resolve(wrong_step, "axis",
		{"lossOrder": [], "optionLosses": 0, "retreats": [], "remnants": []}, bundle, board)
	expect.call(not res.ok and res.get("errorCode") == "combat_resolve_order", "拒绝非结算窗口提交战斗结果")

	# 撤退格非法：路线终点不是合法相邻格。
	var illegal: Dictionary = scenario.get("base", {}).duplicate(true)
	illegal.combat = scenario.get("steps", [])[0].get("combat", {}).duplicate(true)
	res = CombatResult.resolve(illegal, "axis",
		{"lossOrder": [], "optionLosses": 0, "retreats": [{"group": "group:0",
			"units": [defender_id], "path": ["s99.99"]}], "remnants": []}, bundle, board)
	expect.call(not res.ok and res.get("errorCode") in ["retreat_distance", "retreat_illegal_hex"],
		"拒绝撤退到非法格")

	# 路径中断：撤退距离 1 但路线为空。
	var broken: Dictionary = scenario.get("base", {}).duplicate(true)
	broken.combat = scenario.get("steps", [])[0].get("combat", {}).duplicate(true)
	res = CombatResult.resolve(broken, "axis",
		{"lossOrder": [], "optionLosses": 0, "retreats": [{"group": "group:0",
			"units": [defender_id], "path": []}], "remnants": []}, bundle, board)
	expect.call(not res.ok and res.get("errorCode") == "retreat_distance", "拒绝路径与撤退距离不符")

	# 超堆叠：撤退格已堆一枚 10 RE 本方阵，落地后超出 10 RE 上限。
	var crowded: Dictionary = scenario.get("base", {}).duplicate(true)
	crowded.combat = scenario.get("steps", [])[0].get("combat", {}).duplicate(true)
	var defender_seed: Dictionary = crowded.units[defender_id]
	var extra: Dictionary = defender_seed.duplicate(true)
	extra["id"] = "setup:retreat:extra:1"
	extra["hex"] = destination
	extra["printedRe"] = 10
	extra["stepsLost"] = 0
	crowded.units[extra.id] = extra
	res = CombatResult.resolve(crowded, "axis",
		{"lossOrder": [], "optionLosses": 0, "retreats": [{"group": "group:0",
			"units": [defender_id], "path": [destination]}], "remnants": []}, bundle, board)
	expect.call(not res.ok and res.get("errorCode") == "stacking_limit", "拒绝撤退后超出堆叠上限")

	# 重复结算：同一守方窗口走完后再次提交撤退。
	var replay: Dictionary = scenario.get("base", {}).duplicate(true)
	replay.combat = scenario.get("steps", [])[0].get("combat", {}).duplicate(true)
	var first: Dictionary = CombatResult.resolve(replay, "axis",
		scenario.get("steps", [])[1].get("action", {}), bundle, board)
	if first.ok:
		replay = first.value.state
		var second: Dictionary = CombatResult.resolve(replay, "axis",
			scenario.get("steps", [])[1].get("action", {}), bundle, board)
		expect.call(not second.ok and second.get("errorCode") == "combat_resolve_order",
			"拒绝重复结算同一撤退窗口")
	else:
		expect.call(false, "重复结算前置撤退可建立 · " + str(first.get("errorMessage", "")))

	# ZOC 被迫损选择缺失：DG 战斗单位在敌方 ZOC 内但计划未指定损步（待决选择异常）。
	var zoc: Dictionary = _scenario_by_name(fixture, "zoc-loss")
	if not zoc.is_empty():
		var missing: Dictionary = zoc.get("base", {}).duplicate(true)
		missing.combat = zoc.get("steps", [])[0].get("combat", {}).duplicate(true)
		res = CombatResult.resolve(missing, "axis",
			{"lossOrder": [], "optionLosses": 0, "retreats": [{"group": "group:0",
				"units": [defender_id], "path": [str(zoc.get("destination", ""))]}], "remnants": []},
			bundle, board)
		expect.call(not res.ok and res.get("errorCode") == "retreat_zoc_loss_choice",
			"ZOC 内 DG 单位未指定损步时挂起选择")

	# ZOC 被迫损多余：格内没有 DG 候选却指定损步。
	var river: Dictionary = _scenario_by_name(fixture, "river")
	if not river.is_empty():
		var idle: Dictionary = river.get("base", {}).duplicate(true)
		idle.combat = river.get("steps", [])[0].get("combat", {}).duplicate(true)
		var river_defender: String = str(river.get("defenderId", ""))
		res = CombatResult.resolve(idle, "axis",
			{"lossOrder": [], "optionLosses": 0, "retreats": [{"group": "group:0",
				"units": [river_defender], "path": [str(river.get("destination", ""))],
				"zocLosses": {"0": river_defender}}], "remnants": []}, bundle, board)
		expect.call(not res.ok and res.get("errorCode") == "retreat_zoc_loss_unnecessary",
			"无 DG 候选时拒绝多余 ZOC 损步")


## 工事纯规则口径：等级取值、0–4 合法性、反坦克与炮击移位。
static func _hedgehog_unit(ctx: Dictionary, _bundle: Dictionary, _board: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var state := {"hedgehogs": {"s1.10": {"side": "axis", "level": 1}}}
	expect.call(Hedgehogs.level(state, "s1.10") == 1, "读取盘面工事等级")
	expect.call(Hedgehogs.level(state, "s1.11") == 0, "无工事格回退 0")
	expect.call(Hedgehogs.level(state, "s1.11", func(_hex: String) -> int: return 3) == 3,
		"缺盘面记录时回退调用取值")
	expect.call(Hedgehogs.is_valid_level(0) and Hedgehogs.is_valid_level(4), "工事等级 0–4 合法")
	expect.call(not Hedgehogs.is_valid_level(-1) and not Hedgehogs.is_valid_level(5) \
		and not Hedgehogs.is_valid_level("2"), "越界与非整数等级非法")
	expect.call(Hedgehogs.anti_tank(1) == 2 and Hedgehogs.anti_tank(0) == 0, "工事反坦克口径")
	expect.call(absf(Hedgehogs.barrage_shift(2) + 1.0) <= 1e-9 and Hedgehogs.barrage_shift(0) == 0.0,
		"工事炮击移位口径")


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


static func _compare_step(ctx: Dictionary, state: Dictionary, record: Dictionary, involved: Array, label: String) -> void:
	var expect: Callable = ctx.expect
	_compare_combat(expect, state.get("combat"), record.get("combat"), label + " 战斗记录")
	_compare_units(expect, state.get("units", {}), record.get("units", {}), involved, label + " 算子切片")
	_compare_dumps(expect, state.get("dumps", {}), record.get("dumps", {}), label + " 补给堆切片")
	_compare_pieces(expect, state.get("pieces", []), record.get("pieces", []), involved, label + " 死人堆切片")


static func _compare_combat(expect: Callable, actual: Variant, expected: Variant, label: String) -> void:
	expect.call(_same(actual, expected), label)


static func _compare_units(expect: Callable, actual: Dictionary, expected: Dictionary, involved: Array, label: String) -> void:
	for id: String in involved:
		expect.call(_same(actual.get(id), expected.get(id)), "%s · 算子 %s" % [label, id])


static func _compare_dumps(expect: Callable, actual: Dictionary, expected: Dictionary, label: String) -> void:
	for id: String in expected:
		expect.call(_same(actual.get(id), expected.get(id)), "%s · 补给堆 %s" % [label, id])


static func _compare_pieces(expect: Callable, actual: Array, expected: Array, involved: Array, label: String) -> void:
	var actual_filtered: Array = []
	for piece: Dictionary in actual:
		if involved.has(str(piece.get("id", ""))):
			var clone: Dictionary = piece.duplicate(true)
			clone.erase("counter")
			actual_filtered.append(clone)
	expect.call(_same(actual_filtered, expected), label)


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


static func _expect_ok(expect: Callable, result: Dictionary, label: String) -> void:
	expect.call(result.ok, label + ("" if result.ok else " · " + str(result.get("errorMessage", ""))))
