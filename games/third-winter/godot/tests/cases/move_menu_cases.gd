extends RefCounted

## 移动阶段侧栏走子：`scorpion_view._append_move_menu` 的行必须与「原始地形/阻挡」推出的可达邻格
## 一致——两步各自独立算（视图走 GroundMove.check，用例走 TerrainCost + 敌情），任何漂移都会红。

const JsonFile := preload("res://scripts/data/json_file.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")
const ScorpionMatch := preload("res://works/third-winter/scenarios/08-korsun-pocket/scorpion_match.gd")
const TerrainCost := preload("res://works/third-winter/rules/terrain_cost.gd")

const OPENING_REL := "../../../dist/godot/08-opening-data.json"


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var bundle := _read_json(OPENING_REL)
	if bundle.is_empty():
		expect.call(false, "08 数据包可读（移动侧栏）")
		return
	var opening: Dictionary = bundle.get("opening", {})
	var state := {
		"kind": "playing",
		"turn": {"number": 1, "weather": {"ground": "freeze", "flight": "clear"}},
		"cursor": {"turn": 1, "phasing": "axis", "phase": "movement", "retention": 0},
		"units": (opening.get("units", {}) as Dictionary).duplicate(true),
		"dumps": (opening.get("dumps", {}) as Dictionary).duplicate(true),
		"pieces": [],
		"moved": [],
		"railControl": {},
	}
	var blocked := _blocked_hexes(state, bundle, "axis")
	var picked := _pick_unit(state, bundle, blocked)
	if picked.is_empty():
		expect.call(false, "初设里有能在移动阶段走一格的轴心步兵")
		return
	var unit_id := str(picked.get("id", ""))
	var from := str(picked.get("hex", ""))
	var expected: Array = _expected_targets(bundle, picked, from, blocked)
	expect.call(expected.size() > 0, "样例单位至少有一个可达邻格")
	var menu: Array = ScorpionView.menu_entries(state, "axis", {"unitId": unit_id, "hex": str(expected[0])}, bundle)
	var offers: Array = _move_offers(menu)
	expect.call(offers.size() == 1 and str((offers[0].get("path", []) as Array)[0]) == str(expected[0]),
		"点可达邻格给出唯一移动行 · %s" % str(expected[0]))
	## 点不可达的邻格与点自身格都不出移动行。
	var blocked_neighbor := _blocked_neighbor(state, bundle, picked, blocked)
	if not blocked_neighbor.is_empty():
		var blocked_menu: Array = ScorpionView.menu_entries(state, "axis",
			{"unitId": unit_id, "hex": blocked_neighbor}, bundle)
		expect.call(_move_offers(blocked_menu).is_empty(), "点被挡邻格不列移动行 · " + blocked_neighbor)
	var own_menu: Array = ScorpionView.menu_entries(state, "axis", {"unitId": unit_id, "hex": from}, bundle)
	expect.call(_move_offers(own_menu).is_empty(), "点自身格不列移动行")
	for hex: String in expected:
		var res := _submit(state, bundle, {"type": "ground-move", "unitId": unit_id, "path": [hex]})
		expect.call(bool(res.get("ok", false)), "侧栏行可直接提交 · %s → %s %s"
			% [from, hex, str(res.get("errorCode", ""))])
		if not res.get("ok", false):
			break
	## 已动过的算子不再列行。
	var spent := state.duplicate(true)
	(spent["moved"] as Array).append(unit_id)
	var spent_menu: Array = ScorpionView.menu_entries(spent, "axis", {"unitId": unit_id, "hex": str(expected[0])}, bundle)
	expect.call(_move_offers(spent_menu).is_empty(), "已移动算子不列移动行")
	## 解冻天气（非 freeze）不列行，规则也会拒。
	var thaw := state.duplicate(true)
	(thaw["turn"]["weather"] as Dictionary)["ground"] = "thaw"
	var thaw_menu: Array = ScorpionView.menu_entries(thaw, "axis", {"unitId": unit_id, "hex": str(expected[0])}, bundle)
	expect.call(_move_offers(thaw_menu).is_empty(), "解冻天气不列移动行")


## 与视图无关的可达性推断：邻格 → 去掉敌方战斗算子/敌方补给源 → 去掉无可通行格边。
static func _expected_targets(bundle: Dictionary, unit: Dictionary, from: String, blocked: Array) -> Array:
	var graph: Dictionary = bundle.get("view", {}).get("mapGraph", {})
	var neighbors: Array = (graph.get("neighbors", {}) as Dictionary).get(from, [])
	var result: Array = []
	for hex: Variant in neighbors:
		var to := str(hex)
		if blocked.has(to):
			continue
		if TerrainCost.step_cost(graph, from, to, str(unit.get("mobility")), "freeze") == null:
			continue
		## 用例只挑 leg 单位，卡车 ZOC 与横渡耗尽在此不触发；若挑到别样单位就跳过该用例单位。
		result.append(to)
	return result


static func _blocked_hexes(state: Dictionary, bundle: Dictionary, actor: String) -> Array:
	var opponent := "axis" if actor == "soviet" else "soviet"
	var sources: Array = bundle.get("view", {}).get("supplySources", {}).get(opponent, [])
	var blocked: Array = (sources as Array).duplicate()
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if str(unit.get("side", "")) != actor and unit.get("combat") == true:
			blocked.append(str(unit.get("hex", "")))
	return blocked


## 首个能走的轴心步兵：移动面、leg、有移动力、未被标记为延补队。
static func _pick_unit(state: Dictionary, bundle: Dictionary, blocked: Array) -> Dictionary:
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if str(unit.get("side", "")) != "axis" or unit.get("extender") != null:
			continue
		if unit.get("moveMode") == true or str(unit.get("mobility")) != "leg":
			continue
		if int(unit.get("allowance", 0)) <= 0:
			continue
		var from := str(unit.get("hex", ""))
		if _expected_targets(bundle, unit, from, blocked).is_empty():
			continue
		var picked: Dictionary = unit.duplicate(true)
		picked["id"] = id
		return picked
	return {}


static func _blocked_neighbor(state: Dictionary, bundle: Dictionary, unit: Dictionary, blocked: Array) -> String:
	var graph: Dictionary = bundle.get("view", {}).get("mapGraph", {})
	var neighbors: Array = (graph.get("neighbors", {}) as Dictionary).get(str(unit.get("hex", "")), [])
	for hex: Variant in neighbors:
		if blocked.has(str(hex)):
			return str(hex)
	return ""


static func _move_offers(menu: Array) -> Array:
	var offers: Array = []
	for entry: Dictionary in menu:
		for act: Dictionary in entry.get("actions", []):
			if str(act.get("type", "")) == "ground-move":
				offers.append(act)
	return offers


static func _submit(state: Dictionary, bundle: Dictionary, action: Dictionary) -> Dictionary:
	var record := {"state": state.duplicate(true), "revision": 0, "receipts": []}
	return ScorpionMatch.submit(record, "axis",
		{"id": "move:" + str(action.get("type", "")), "expectedRevision": 0, "action": action}, bundle)


static func _read_json(relative: String) -> Dictionary:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var path := (base + "/" + relative).simplify_path()
	var read: Dictionary = JsonFile.read(path)
	if read.get("ok", false):
		return read.value.document
	return {}
