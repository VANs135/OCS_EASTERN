extends RefCounted

## TTW 2.4d 残部生成对照（src/match/scorpion-remnants.ts、scorpion-combat-losses.ts）。
## 回放 dist/godot/08-remnant-gen.json：合格轴心师打光生成残部、非师级/苏军/存活不生成、
## 残部重建链；另覆盖拒绝与边界路径（双残部已在盘、非法落点、pax 不足、非本方阶段、非增援段）。

const JsonFile := preload("res://scripts/data/json_file.gd")
const CombatLosses := preload("res://works/third-winter/rules/combat_losses.gd")
const Remnants := preload("res://works/third-winter/rules/remnants.gd")

const FIXTURE_REL := "../../../dist/godot/08-remnant-gen.json"
const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"


static func run(ctx: Dictionary) -> void:
	var fixture: Dictionary = _read_json(FIXTURE_REL)
	var bundle: Dictionary = _read_json(BUNDLE_REL)
	if fixture.is_empty() or bundle.is_empty():
		ctx.expect.call(false, "残部生成对照夹具与初设数据可读")
		return
	for scenario: Dictionary in fixture.scenarios:
		if str(scenario.name) == "rebuild-chain":
			_rebuild_scenario(ctx, bundle, scenario)
		else:
			_loss_scenario(ctx, bundle, scenario)
	_reject_paths(ctx, bundle, fixture)


static func _loss_scenario(ctx: Dictionary, bundle: Dictionary, scenario: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var label: String = str(scenario.name)
	var state: Dictionary = (scenario.base as Dictionary).duplicate(true)
	var step: Dictionary = scenario.steps[0]
	var action: Dictionary = step.action
	var allocation: Dictionary = action.allocation
	var remnants: Array = action.get("remnants", [])
	var res: Dictionary = CombatLosses.apply_losses(state, allocation, bundle, null, remnants)
	expect.call(res.ok, label + " · 战损落地成功" + ("" if res.ok else " · " + str(res.get("errorMessage", ""))))
	if not res.ok:
		return
	state = res.value.state
	var expected_units: Dictionary = step.units
	for unit_id: String in expected_units:
		expect.call(state.units.has(unit_id), label + " · 盘面算子 %s" % unit_id)
		if state.units.has(unit_id):
			expect.call(_same(state.units[unit_id], expected_units[unit_id]),
				label + " · 算子快照 %s" % unit_id)
	var expected_pieces: Array = step.pieces
	var actual_pieces: Array = []
	for piece: Dictionary in state.get("pieces", []):
		if _piece_id_in(expected_pieces, str(piece.get("id", ""))):
			var stripped: Dictionary = piece.duplicate(true)
			stripped.erase("counter")
			actual_pieces.append(stripped)
	expect.call(_same(actual_pieces, expected_pieces), label + " · 死人堆")
	expect.call(int(state.get("arrival", {}).get("sovietVp", 0)) == int(step.vp),
		label + " · 苏军 VP %d" % int(step.vp))
	var expected_remnants: Array = step.remnants
	var actual_remnants: Array = []
	for entry: Dictionary in res.value.get("remnants", []):
		actual_remnants.append({"divisionId": entry.get("divisionId", ""), "hex": entry.get("hex", "")})
	var expected_remnant_view: Array = []
	for entry: Dictionary in expected_remnants:
		expected_remnant_view.append({"divisionId": entry.get("divisionId", ""), "hex": entry.get("hex", "")})
	expect.call(_same(actual_remnants, expected_remnant_view), label + " · 生成残部名单")


static func _rebuild_scenario(ctx: Dictionary, bundle: Dictionary, scenario: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var label: String = str(scenario.name)
	var state: Dictionary = (scenario.base as Dictionary).duplicate(true)
	var step: Dictionary = scenario.steps[1]
	var action: Dictionary = step.action
	var res: Dictionary = Remnants.rebuild(state, "axis", action, bundle)
	expect.call(res.ok, label + " · 残部重建成功" + ("" if res.ok else " · " + str(res.get("errorMessage", ""))))
	if not res.ok:
		return
	state = res.value
	var expected_units: Dictionary = step.units
	for unit_id: String in expected_units:
		expect.call(state.units.has(unit_id), label + " · 盘面算子 %s" % unit_id)
		if state.units.has(unit_id):
			expect.call(_same(state.units[unit_id], expected_units[unit_id]),
				label + " · 算子快照 %s" % unit_id)
	var expected_pieces: Array = step.pieces
	var actual_pieces: Array = []
	for piece: Dictionary in state.get("pieces", []):
		if _piece_id_in(expected_pieces, str(piece.get("id", ""))):
			var stripped: Dictionary = piece.duplicate(true)
			stripped.erase("counter")
			actual_pieces.append(stripped)
	expect.call(_same(actual_pieces, expected_pieces), label + " · 死人堆")
	expect.call(_same(state.get("pax", {}), step.get("pax", {})), label + " · Pax 台账")
	var rebuilt: Dictionary = step.get("rebuilt", {})
	var parent_id: String = str(rebuilt.get("id", ""))
	if state.units.has(parent_id):
		expect.call(int(state.units[parent_id].get("stepsLost", -1)) == int(rebuilt.get("stepsLost", -1)),
			label + " · 母单位降一步")
		expect.call(bool(state.units[parent_id].get("moveMode", false)) == bool(rebuilt.get("moveMode", false)),
			label + " · 母单位面朝")


static func _reject_paths(ctx: Dictionary, bundle: Dictionary, fixture: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var loss_base: Dictionary = {}
	var rebuild_base: Dictionary = {}
	for scenario: Dictionary in fixture.scenarios:
		if str(scenario.name) == "axis-division-remnant":
			loss_base = scenario.base
		elif str(scenario.name) == "rebuild-chain":
			rebuild_base = scenario.base
	if loss_base.is_empty() or rebuild_base.is_empty():
		expect.call(false, "拒绝路径夹具可读")
		return
	var division_id: String = str(find_scenario(fixture, "axis-division-remnant").get("divisionId", ""))
	var remnant_id: String = str(find_scenario(fixture, "rebuild-chain").get("remnantId", ""))
	_reject_bad_hex(ctx, bundle, division_id, loss_base)
	_reject_both_remnants_active(ctx, bundle, division_id, loss_base)
	_reject_pax_short(ctx, bundle, remnant_id, rebuild_base)
	_reject_wrong_seat(ctx, bundle, remnant_id, rebuild_base)
	_reject_wrong_phase(ctx, bundle, remnant_id, rebuild_base)


static func _reject_bad_hex(ctx: Dictionary, bundle: Dictionary, division_id: String, loss_base: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var state: Dictionary = loss_base.duplicate(true)
	var division: Dictionary = state.units[division_id]
	var remaining: int = int(division.get("printedRe", 0)) - int(division.get("stepsLost", 0))
	var allocation: Dictionary = {}
	allocation[division_id] = remaining
	var choices: Array = [{"divisionId": division_id, "hex": "s17.01"}]
	var res: Dictionary = CombatLosses.apply_losses(state, allocation, bundle, null, choices)
	expect.call(not res.ok and str(res.get("errorCode", "")) == "remnant_choice",
		"残部拒绝 · 非法落点 remnant_choice")


static func _reject_both_remnants_active(ctx: Dictionary, bundle: Dictionary, division_id: String, loss_base: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var state: Dictionary = loss_base.duplicate(true)
	state.units["remnant:land:id:3999"] = {"definition": "land:id:3999", "side": "axis", "hex": "s2.10"}
	state.units["remnant:land:id:4499"] = {"definition": "land:id:4499", "side": "axis", "hex": "s3.10"}
	var division: Dictionary = state.units[division_id]
	var remaining: int = int(division.get("printedRe", 0)) - int(division.get("stepsLost", 0))
	var allocation: Dictionary = {}
	allocation[division_id] = remaining
	var choices: Array = [{"divisionId": division_id, "hex": "s2.10"}]
	var res: Dictionary = CombatLosses.apply_losses(state, allocation, bundle, null, choices)
	expect.call(not res.ok and str(res.get("errorCode", "")) in ["remnant_ineligible", "remnant_unmatched"],
		"残部拒绝 · 两枚残部均在盘")


static func _reject_pax_short(ctx: Dictionary, bundle: Dictionary, remnant_id: String, rebuild_base: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var state: Dictionary = rebuild_base.duplicate(true)
	state.pax = state.pax.duplicate(true)
	state.pax["axis"] = 0
	var action: Dictionary = {"type": "rebuild-remnant", "remnantId": remnant_id, "face": "combat"}
	var res: Dictionary = Remnants.rebuild(state, "axis", action, bundle)
	expect.call(not res.ok and str(res.get("errorCode", "")) == "remnant_rebuild",
		"残部重建拒绝 · Pax 不足")


static func _reject_wrong_seat(ctx: Dictionary, bundle: Dictionary, remnant_id: String, rebuild_base: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var state: Dictionary = rebuild_base.duplicate(true)
	var action: Dictionary = {"type": "rebuild-remnant", "remnantId": remnant_id, "face": "combat"}
	var res: Dictionary = Remnants.rebuild(state, "soviet", action, bundle)
	expect.call(not res.ok and str(res.get("errorCode", "")) == "remnant_rebuild",
		"残部重建拒绝 · 非本方阶段")


static func _reject_wrong_phase(ctx: Dictionary, bundle: Dictionary, remnant_id: String, rebuild_base: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var state: Dictionary = rebuild_base.duplicate(true)
	state.cursor = state.cursor.duplicate(true)
	state.cursor["phase"] = "supply"
	var action: Dictionary = {"type": "rebuild-remnant", "remnantId": remnant_id, "face": "combat"}
	var res: Dictionary = Remnants.rebuild(state, "axis", action, bundle)
	expect.call(not res.ok and str(res.get("errorCode", "")) == "remnant_rebuild",
		"残部重建拒绝 · 非增援段")


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


static func _piece_id_in(pieces: Array, target: String) -> bool:
	for entry: Dictionary in pieces:
		if str(entry.get("id", "")) == target:
			return true
	return false


static func find_scenario(fixture: Dictionary, name: String) -> Dictionary:
	for scenario: Dictionary in fixture.scenarios:
		if str(scenario.name) == name:
			return scenario
	return {}


static func _read_json(rel: String) -> Dictionary:
	var path: String = ProjectSettings.globalize_path("res://") + rel
	var read: Dictionary = JsonFile.read(path)
	return read.value.document if read.ok else {}
