extends RefCounted

## 战斗地形 / 战斗强度 / 模式数值层 / CRT 取表对照用例。
## 期望值全部来自 dist/godot/08-combat-terrain.json（由 scripts/godot-combat-terrain.mjs 用 TS 函数算出）。
## 浮点比较容差 1e-9；入口契约：static func run(ctx: Dictionary) -> void。

const JsonFile := preload("res://scripts/data/json_file.gd")
const Modes := preload("res://scripts/rules/series/modes.gd")
const CombatTerrain := preload("res://works/third-winter/rules/combat_terrain.gd")
const Crt := preload("res://scripts/rules/series/crt.gd")

const FIXTURE_REL := "../../../dist/godot/08-combat-terrain.json"
const EPSILON := 1e-9


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var fixture_path: String = _fixture_path()
	var read: Dictionary = JsonFile.read(fixture_path)
	if not read.get("ok", false):
		expect.call(false, "08 战斗地形对照夹具可读 · " + str(read.get("errorMessage", fixture_path)))
		return
	var fixture: Dictionary = read.value.document
	_check_strength_rows(ctx, fixture.get("terrainRows", []), "地形")
	_check_strength_rows(ctx, fixture.get("riverRows", []), "河岸")
	_check_strength_rows(ctx, fixture.get("antiTankRows", []), "反坦克")
	_check_strength_rows(ctx, fixture.get("stepRows", []), "步损")
	_check_strength_rows(ctx, fixture.get("supplyRows", []), "补给")
	_check_strength_rows(ctx, fixture.get("artilleryRows", []), "炮兵师")
	_check_modes(ctx, fixture)
	_check_crt(ctx, fixture)


static func _fixture_path() -> String:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	return (base + "/" + FIXTURE_REL).simplify_path()


static func _check_strength_rows(ctx: Dictionary, rows: Array, group: String) -> void:
	var expect: Callable = ctx.expect
	for row: Dictionary in rows:
		var facts: Dictionary = row.get("facts", {})
		var actual: float = CombatTerrain.combat_strength(facts)
		var label := "%s 战斗强度 · %s" % [group, str(row.get("note", "%s/%s/%s" % [
			row.get("terrain", ""), row.get("combatClass", ""), str(row.get("attacking", ""))]))]
		_expect_same(ctx, actual, row.get("expected"), label)
		if row.has("category"):
			_expect_same(ctx, CombatTerrain.combat_terrain_category(str(row.get("terrain", ""))),
				row.get("category"), "%s CRT 类别 · %s" % [group, str(row.get("terrain", ""))])


static func _check_modes(ctx: Dictionary, fixture: Dictionary) -> void:
	var expect: Callable = ctx.expect
	for row: Dictionary in fixture.get("modeRows", []):
		var state: Dictionary = row.get("state", {})
		var phase: String = str(row.get("phase", "movement"))
		var label := "模式 %s · %s" % [str(row.get("label", "")), phase]
		_expect_same(ctx, Modes.ground_mode_effect(state), row.get("effect"), label + " 效果矩阵")
		_expect_same(ctx, Modes.resolve_mode_stats({"attack": 6, "ar": 3, "ma": 4, "barrage": 2}, state, phase),
			row.get("stats"), label + " 改写数值")
		_expect_same(ctx, Modes.ground_mode_movement_factor(state, phase), row.get("movementFactor"),
			label + " 移动倍率")
		_expect_same(ctx, Modes.effective_mode(state), row.get("effectiveMode"), label + " 生效模式")
		var unit := {
			"actionRating": 3,
			"moveMode": state.get("face") == "move",
			"reserve": state.get("marker") == "reserve",
			"disorganized": state.get("marker") == "dg",
			"exploit": state.get("marker") == "exploit",
			"released": state.get("released", false) == true,
		}
		_expect_same(ctx, CombatTerrain.combat_rating(unit), row.get("rating"), label + " 行动值")


static func _check_crt(ctx: Dictionary, fixture: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var table: Dictionary = fixture.get("crtTable", {})
	var rows: Array = fixture.get("crtRows", [])
	for row: Dictionary in rows:
		var result: Dictionary = Crt.crt_lookup(int(row.get("roll", 0)), str(row.get("terrain", "")),
			str(row.get("odds", "")), table)
		if not result.get("ok", true):
			expect.call(false, "CRT 取表 %s %s %d · %s" % [
				str(row.get("terrain", "")), str(row.get("odds", "")), int(row.get("roll", 0)),
				str(result.get("errorMessage", ""))])
			continue
		_expect_same(ctx, result, row.get("expected"),
			"CRT %s %s 掷骰 %d" % [str(row.get("terrain", "")), str(row.get("odds", "")), int(row.get("roll", 0))])
	# 缺省表路径（环境变量 OCS_V43_CRT 或 dist/ocs-v43-crt.json）可读并与内嵌表一致。
	var default_sample: Dictionary = Crt.crt_lookup(8, "Open", "3:1", null)
	var embedded: Dictionary = Crt.crt_lookup(8, "Open", "3:1", table)
	expect.call(default_sample.get("ok", true) and default_sample.get("code", "") != "", "默认 CRT 表可读")
	if default_sample.get("ok", true) and embedded.get("ok", true):
		_expect_same(ctx, default_sample.get("code"), embedded.get("code"), "默认表与内嵌表同格")


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
