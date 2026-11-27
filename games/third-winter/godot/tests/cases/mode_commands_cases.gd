extends RefCounted

## 08 换面与预备命令对照用例。
## 期望值全部来自 dist/godot/08-mode-commands.json（由 scripts/godot-mode-commands.mjs 用 TS 函数算出）。
## 入口契约：static func run(ctx: Dictionary) -> void。

const JsonFile := preload("res://scripts/data/json_file.gd")
const Modes := preload("res://scripts/rules/series/modes.gd")
const GroundModeActions := preload("res://works/third-winter/rules/ground_mode_actions.gd")
const Reserves := preload("res://works/third-winter/rules/reserves.gd")

const FIXTURE_REL := "../../../dist/godot/08-mode-commands.json"
const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"
const EPSILON := 1e-9


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var read: Dictionary = JsonFile.read(_fixture_path(FIXTURE_REL))
	if not read.get("ok", false):
		expect.call(false, "08 换面/预备对照夹具可读 · " + str(read.get("errorMessage", FIXTURE_REL)))
		return
	var fixture: Dictionary = read.value.document
	var bundle: Dictionary = _load_bundle(ctx)
	_check_face_rows(ctx, bundle, fixture.get("faceRows", []))
	_check_reserve_rows(ctx, bundle, fixture.get("reserveRows", []))
	_check_switch_rows(ctx, fixture.get("switchRows", []))
	_check_release_rows(ctx, fixture.get("releaseRows", []))
	_check_move_phase_rows(ctx, fixture.get("movePhaseRows", []))
	_check_validate_rows(ctx, fixture.get("validateRows", []))
	_check_predicate_rows(ctx, fixture.get("predicateRows", []))


static func _load_bundle(ctx: Dictionary) -> Dictionary:
	var args: Array = ctx.get("args", [])
	var path: String = ""
	if args.size() >= 1 and str(args[0]) != "":
		path = str(args[0])
	else:
		path = _fixture_path(BUNDLE_REL)
	var read: Dictionary = JsonFile.read(path)
	if read.get("ok", false):
		return read.value.document
	return {}


static func _fixture_path(rel: String) -> String:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	return (base + "/" + rel).simplify_path()


static func _check_face_rows(ctx: Dictionary, bundle: Dictionary, rows: Array) -> void:
	var expect: Callable = ctx.expect
	for row: Dictionary in rows:
		var label := str(row.get("label", ""))
		var state: Dictionary = row.get("state", {}).duplicate(true)
		var action: Dictionary = row.get("action", {})
		var outcome: Dictionary = GroundModeActions.set_ground_mode(
			state, str(row.get("actor", "")), action, bundle)
		var expected: Dictionary = row.get("expected", {})
		if expected.get("ok", false):
			expect.call(outcome.ok, label + " 接受")
			if outcome.ok:
				var unit_id := str(action.get("unitId", ""))
				_expect_same(ctx, outcome.value.units.get(unit_id, {}), expected.get("unit", {}), label)
		else:
			var code := str(expected.get("errorCode", ""))
			expect.call(not outcome.ok and str(outcome.get("errorCode", "")) == code,
				label + " 拒绝 " + code)


static func _check_reserve_rows(ctx: Dictionary, bundle: Dictionary, rows: Array) -> void:
	var expect: Callable = ctx.expect
	for row: Dictionary in rows:
		var label := str(row.get("label", ""))
		var state: Dictionary = row.get("state", {}).duplicate(true)
		var actor := str(row.get("actor", ""))
		var action: Dictionary = row.get("action", {})
		var outcome: Dictionary
		match str(row.get("command", "")):
			"mark-reserve":
				outcome = Reserves.mark_reserve(state, actor, action, bundle)
			"leave-reserve":
				outcome = Reserves.leave_reserve(state, actor, action, bundle)
			"release-reserve":
				outcome = Reserves.release_reserve(state, actor, action, bundle)
			_:
				outcome = { "ok": false, "errorCode": "unsupported_action" }
		var expected: Dictionary = row.get("expected", {})
		if expected.get("ok", false):
			expect.call(outcome.ok, label + " 接受")
			if outcome.ok:
				var unit_id := str(action.get("unitId", ""))
				_expect_same(ctx, outcome.value.units.get(unit_id, {}), expected.get("unit", {}), label)
		else:
			var code := str(expected.get("errorCode", ""))
			expect.call(not outcome.ok and str(outcome.get("errorCode", "")) == code,
				label + " 拒绝 " + code)


static func _check_switch_rows(ctx: Dictionary, rows: Array) -> void:
	for row: Dictionary in rows:
		var verdict: Dictionary = Modes.can_switch_mode(row.get("req", {}))
		_expect_same(ctx, verdict, row.get("expected", {}), str(row.get("label", "切换")))


static func _check_release_rows(ctx: Dictionary, rows: Array) -> void:
	for row: Dictionary in rows:
		var verdict: Dictionary = Modes.can_release_reserve(row.get("input", {}))
		_expect_same(ctx, verdict, row.get("expected", {}), str(row.get("label", "释放")))


static func _check_move_phase_rows(ctx: Dictionary, rows: Array) -> void:
	for row: Dictionary in rows:
		var verdict: Dictionary = Modes.can_move_in_phase(row.get("input", {}), str(row.get("phase", "")))
		_expect_same(ctx, verdict, row.get("expected", {}), str(row.get("label", "阶段")))


static func _check_validate_rows(ctx: Dictionary, rows: Array) -> void:
	for row: Dictionary in rows:
		var issues: Array = Modes.validate_mode_state(row.get("state", {}), str(row.get("unitClass", "")))
		_expect_same(ctx, issues, row.get("expected", []), str(row.get("label", "校验")))


static func _check_predicate_rows(ctx: Dictionary, rows: Array) -> void:
	for row: Dictionary in rows:
		var state: Dictionary = row.get("state", {})
		var actual := {
			"exertsZoc": Modes.exerts_zoc(state),
			"canUseTransport": Modes.can_use_transport(state),
			"canEngineer": Modes.can_engineer(state),
			"canStackWithHedgehog": Modes.can_stack_with_hedgehog(state),
			"mustEndMoveInSupply": Modes.must_end_move_in_supply(state),
		}
		_expect_same(ctx, actual, row.get("expected", {}), str(row.get("label", "派生判定")))


static func _expect_same(ctx: Dictionary, actual: Variant, expected: Variant, label: String) -> void:
	var expect: Callable = ctx.expect
	expect.call(_same(actual, expected), label)


static func _same(actual: Variant, expected: Variant) -> bool:
	if expected == null:
		return actual == null
	if actual is bool or expected is bool:
		return actual is bool and expected is bool and actual == expected
	if actual is int or actual is float or expected is int or expected is float:
		if not (actual is int or actual is float) or not (expected is int or expected is float):
			return false
		return absf(float(actual) - float(expected)) <= EPSILON
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
