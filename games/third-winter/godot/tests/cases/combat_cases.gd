extends RefCounted

## 08 正规战斗七步状态机对照用例。期望值全部来自 dist/godot/08-combat.json
## （scripts/godot-combat.mjs 用 TS 链路在同一份伪造局面上跑出）。
## 入口契约：static func run(ctx: Dictionary) -> void；ctx 提供 expect / compare / reject / state_slice / args。

const JsonFile := preload("res://scripts/data/json_file.gd")
const Combat := preload("res://works/third-winter/rules/combat.gd")
const CombatResult := preload("res://works/third-winter/rules/combat_result.gd")
const CombatRolls := preload("res://works/third-winter/rules/combat_rolls.gd")
const Crt := preload("res://scripts/rules/series/crt.gd")

const FIXTURE_REL := "../../../dist/godot/08-combat.json"
const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"


static func run(ctx: Dictionary) -> void:
	var fixture: Dictionary = _read_json(FIXTURE_REL)
	var bundle: Dictionary = _read_json(BUNDLE_REL)
	if fixture.is_empty() or bundle.is_empty():
		ctx.expect.call(false, "08 正规战斗对照夹具与初设数据包可读")
		return
	var table: Dictionary = Crt.load_table("").value
	var board: Dictionary = {"table": table}
	for scenario: Dictionary in fixture.get("scenarios", []):
		_run_scenario(ctx, scenario, bundle, board)
	_check_fractional_odds(ctx, table)
	_check_hedgehog_null(ctx, fixture, bundle, board)
	_reject_paths(ctx, bundle, board)


static func _run_scenario(ctx: Dictionary, scenario: Dictionary, bundle: Dictionary, board: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var attacker_id: String = str(scenario.get("attackerId", ""))
	var defender_id: String = str(scenario.get("defenderId", ""))
	var involved: Array = [attacker_id, defender_id]
	var state: Dictionary = scenario.get("base", {}).duplicate(true)

	var steps: Array = scenario.get("steps", [])
	var declare_step: Dictionary = steps[0] if steps.size() > 0 else {}
	var res: Dictionary = Combat.declare(state, "soviet", declare_step.get("action", {}), bundle, board)
	_expect_ok(expect, res, "宣告战斗 · " + str(scenario.get("name", "")))
	if not res.ok:
		return
	state = res.value
	_compare_step(ctx, state, declare_step, involved, "宣告")

	var defend_step: Dictionary = _step(steps, "defend")
	res = Combat.defend(state, "axis", defend_step.get("action", {}), bundle)
	_expect_ok(expect, res, "守方补给 · " + str(scenario.get("name", "")))
	if not res.ok:
		return
	state = res.value
	_compare_step(ctx, state, defend_step, involved, "守方补给")

	var attacker_rating: Dictionary = _step(steps, "attacker-rating")
	res = Combat.select_rating(state, "soviet", attacker_id)
	_expect_ok(expect, res, "攻方选行动值 · " + str(scenario.get("name", "")))
	if not res.ok:
		return
	state = res.value
	_compare_step(ctx, state, attacker_rating, involved, "攻方行动值")

	var defender_rating: Dictionary = _step(steps, "defender-rating")
	res = Combat.select_rating(state, "axis", defender_id)
	_expect_ok(expect, res, "守方选行动值 · " + str(scenario.get("name", "")))
	if not res.ok:
		return
	state = res.value
	_compare_step(ctx, state, defender_rating, involved, "守方行动值")

	var terrain_step: Dictionary = _step(steps, "defender-terrain")
	var roll: Dictionary = terrain_step.get("roll", {})
	var offer := _offer_of(scenario)
	var draws_before: int = int(state.get("rng", {}).get("drawCount", 0))
	res = Combat.choose_terrain(state, "axis", terrain_step.get("action", {}), bundle, board, offer)
	_expect_ok(expect, res, "守方选地形 · " + str(scenario.get("name", "")))
	if not res.ok:
		return
	state = res.value
	# 默认从本局 rng 自掷：surprise 2 枚 → shift 1 枚（仅极端时）→ combat 2 枚，按骰数推进 drawCount。
	# 夹具用 offer 固定骰面的场景（TS 侧 offer 分支同样不推进 rng）应为 0。
	var expected_draws: int = 0 if not offer.is_empty() else (5 if int(roll.get("shift", 0)) != 0 else 4)
	expect.call(int(state.get("rng", {}).get("drawCount", 0)) == draws_before + expected_draws,
		"掷骰消耗随机数 %d 次 · %s" % [expected_draws, str(scenario.get("name", ""))])
	_compare_step(ctx, state, terrain_step, involved, "守方地形")

	var attacker_result: Dictionary = _step(steps, "attacker-result")
	res = CombatResult.resolve(state, "soviet", attacker_result.get("action", {}), bundle, board)
	_expect_ok(expect, res, "攻方结算 · " + str(scenario.get("name", "")))
	if not res.ok:
		return
	state = res.value.state
	_compare_step(ctx, state, attacker_result, involved, "攻方结算")

	var defender_result: Dictionary = _step(steps, "defender-result")
	if not defender_result.is_empty():
		res = CombatResult.resolve(state, "axis", defender_result.get("action", {}), bundle, board)
		_expect_ok(expect, res, "守方结算 · " + str(scenario.get("name", "")))
		if not res.ok:
			return
		state = res.value.state
		_compare_step(ctx, state, defender_result, involved, "守方结算")

	var advance_step: Dictionary = _step(steps, "advance")
	if not advance_step.is_empty():
		var entrants: Array = advance_step.get("entrants", [])
		res = CombatResult.advance(state, "soviet", entrants, bundle, board, [])
		_expect_ok(expect, res, "进击 · " + str(scenario.get("name", "")))
		if not res.ok:
			return
		state = res.value.state
		_compare_step(ctx, state, advance_step, involved, "进击")


## 半强度取列：OCS 9.7–9.9 先把比值四舍五入再取列，不能先各自取整（2.5:2 应取 1:1 而非 2:1）。
static func _check_fractional_odds(ctx: Dictionary, table: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var columns: Array = table.get("terrainColumns", {}).get("Open", [])
	var one_to_one := -1
	for index: int in columns.size():
		if str(columns[index]) == "1:1":
			one_to_one = index
	var rolls := CombatRolls.new({"seed": 19440126, "state": 3682571752, "drawCount": 2})
	var res: Dictionary = CombatResult.roll_combat(table, "Open", 2.5, 2.0, 0, 0, rolls, false)
	expect.call(res.ok, "半强度掷骰可结算 · %s" % str(res.get("errorMessage", "")))
	if res.ok:
		expect.call(int(res.value.get("initialColumn", -1)) == one_to_one,
			"半强度按原始比值取列（2.5:2 → 1:1）")


## 工事 0 级在盘上是 null 条目（削平后保留键），不得当字典取 level。
static func _check_hedgehog_null(ctx: Dictionary, fixture: Dictionary, bundle: Dictionary, board: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var scenario: Dictionary = fixture.get("scenarios", [])[0] if fixture.get("scenarios", []).size() > 0 else {}
	if scenario.is_empty():
		return
	var state: Dictionary = scenario.get("base", {}).duplicate(true)
	var target := str(scenario.get("target", ""))
	state["hedgehogs"] = {target: null}
	var declare_step: Dictionary = _step(scenario.get("steps", []), "declare")
	var res: Dictionary = Combat.declare(state, "soviet", declare_step.get("action", {}), bundle, board)
	expect.call(res.ok, "工事 0 级 null 条目可宣告战斗 · %s" % str(res.get("errorMessage", "")))
	if res.ok:
		expect.call(int(res.value.get("combat", {}).get("hedgehog", -1)) == 0,
			"工事 null 条目按 0 级参战")


static func _step(steps: Array, name: String) -> Dictionary:
	for step: Dictionary in steps:
		if str(step.get("step", "")) == name:
			return step
	return {}


## 夹具里注入骰面的场景（TS 走 offer 分支，不推进 rng），原生按同一键重放。
static func _offer_of(scenario: Dictionary) -> Dictionary:
	var offered: Variant = scenario.get("offer")
	if not (offered is Dictionary):
		return {}
	return {"surprise": offered.get("surprise", []), "surprise-shift": offered.get("shift", []),
		"combat": offered.get("combat", [])}


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
			# 原生残部生成依赖整块算子快照；TS 夹具不落该字段，比对时剥离。
			clone.erase("counter")
			actual_filtered.append(clone)
	expect.call(_same(actual_filtered, expected), label)


## 拒绝路径：阶段/资格/补给/顺序/选项分配的合法性边界，逐条断言 errorCode。
static func _reject_paths(ctx: Dictionary, bundle: Dictionary, board: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var scenario: Dictionary = _read_json(FIXTURE_REL).get("scenarios", [])[0]
	if scenario.is_empty():
		expect.call(false, "08 拒绝路径缺少对照局面")
		return
	var attacker_id: String = str(scenario.get("attackerId", ""))
	var defender_id: String = str(scenario.get("defenderId", ""))
	var target: String = str(scenario.get("target", ""))

	# 非本方阶段：phasing 与宣告席位不一致。
	var wrong_phase: Dictionary = scenario.get("base", {}).duplicate(true)
	wrong_phase.cursor.phasing = "axis"
	var res: Dictionary = Combat.declare(wrong_phase, "soviet",
		{"target": target, "attackers": [attacker_id], "payments": [], "internalUnitIds": []}, bundle, board)
	expect.call(not res.ok and res.get("errorCode") == "combat_unavailable", "拒绝非本方阶段宣告")

	# 守方不在目标格：选一枚可达但无敌方战斗单位的邻格（s1.12 开局为空）。
	var empty_target: Dictionary = scenario.get("base", {}).duplicate(true)
	res = Combat.declare(empty_target, "soviet",
		{"target": "s1.12", "attackers": [attacker_id], "payments": [], "internalUnitIds": []}, bundle, board)
	expect.call(not res.ok and res.get("errorCode") == "combat_defender_empty", "拒绝守方缺失的目标格")

	# 攻方不在邻格：选一个与攻方不相邻的地图格。
	var attacker_hex: String = str(scenario.get("base", {}).get("units", {}).get(attacker_id, {}).get("hex", ""))
	var neighbors: Array = bundle.get("view", {}).get("mapGraph", {}).get("neighbors", {}).get(attacker_hex, [])
	var non_neighbor: String = ""
	for hex_id: String in bundle.get("view", {}).get("mapGraph", {}).get("terrains", {}):
		if hex_id != target and hex_id != attacker_hex and not neighbors.has(hex_id):
			non_neighbor = hex_id
			break
	if non_neighbor != "":
		var far_target: Dictionary = scenario.get("base", {}).duplicate(true)
		res = Combat.declare(far_target, "soviet",
			{"target": non_neighbor, "attackers": [attacker_id], "payments": [], "internalUnitIds": []}, bundle, board)
		expect.call(not res.ok and res.get("errorCode") in ["combat_attacker_path", "combat_defender_empty"],
			"拒绝攻方不可达目标格")

	# 敌方补给源格不得作为战斗目标。
	var axis_sources: Array = bundle.get("view", {}).get("supplySources", {}).get("axis", [])
	if axis_sources.size() > 0:
		var source_target: Dictionary = scenario.get("base", {}).duplicate(true)
		res = Combat.declare(source_target, "soviet",
			{"target": str(axis_sources[0]), "attackers": [attacker_id],
				"payments": [{"unitId": attacker_id, "dumpId": "soviet:hex:s1.14", "tokens": 2}],
				"internalUnitIds": []}, bundle, board)
		expect.call(not res.ok and res.get("errorCode") == "combat_supply_source", "拒绝以敌方补给源格为目标")

	# 攻方补给未付足：支付 0 token。
	var unpaid: Dictionary = scenario.get("base", {}).duplicate(true)
	res = Combat.declare(unpaid, "soviet",
		{"target": target, "attackers": [attacker_id],
			"payments": [{"unitId": attacker_id, "dumpId": "soviet:hex:s1.14", "tokens": 0}],
			"internalUnitIds": []}, bundle, board)
	expect.call(not res.ok and res.get("errorCode") in ["supply_attacker_payment", "supply_payment"],
		"拒绝攻方补给未付足")

	# 评分选择顺序错误：攻方窗口由守方选单位。
	var opened: Dictionary = scenario.get("base", {}).duplicate(true)
	var opened_res: Dictionary = Combat.declare(opened, "soviet",
		{"target": target, "attackers": [attacker_id],
			"payments": [{"unitId": attacker_id, "dumpId": "soviet:hex:s1.14", "tokens": 2}],
			"internalUnitIds": []}, bundle, board)
	if opened_res.ok:
		opened = opened_res.value
		res = Combat.select_rating(opened, "axis", defender_id)
		expect.call(not res.ok and res.get("errorCode") == "combat_rating_order", "拒绝行动值选择顺序颠倒")
	else:
		expect.call(false, "拒绝路径前置宣告可建立")

	# 选项损失越界：optionLosses 超过可选项上限。先走完守方补给与两次选评级。
	if opened_res.ok:
		var opened2: Dictionary = opened.duplicate(true)
		var defend2: Dictionary = _step(scenario.get("steps", []), "defend")
		var defend_res: Dictionary = Combat.defend(opened2, "axis", defend2.get("action", {}), bundle)
		if defend_res.ok:
			opened2 = defend_res.value
			var rate_a: Dictionary = Combat.select_rating(opened2, "soviet", attacker_id)
			var rate_d: Dictionary = Combat.select_rating(opened2, "axis", defender_id)
			if rate_a.ok and rate_d.ok:
				opened2 = rate_d.value
				var terrain: Dictionary = _step(scenario.get("steps", []), "defender-terrain")
				var terrain_res: Dictionary = Combat.choose_terrain(opened2, "axis", terrain.get("action", {}), bundle, board)
				if terrain_res.ok:
					opened2 = terrain_res.value
					var attacker_action: Dictionary = {"lossOrder": [attacker_id], "optionLosses": 99,
						"ignoreDefenderOption": false, "retreats": [], "remnants": []}
					res = CombatResult.resolve(opened2, "soviet", attacker_action, bundle, board)
					expect.call(not res.ok and res.get("errorCode") in ["combat_option_losses", "loss_order_leader",
						"loss_order_round_robin"], "拒绝选项损失分配越界")


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
