extends RefCounted

## OCS v4.3 §12.7d–f、TTW 3.6 — 延补队（Supply Extender）崩溃。
## 判定只对照 src/match/scorpion-extender.ts：崩溃前在射程内找有补给 trace 的落点；
## 崩溃后延补队翻回普通运输队、清空延补标记与载货，并记为已行动。

const Result := preload("res://scripts/core/result.gd")
const ReinforcementBoard := preload("res://works/third-winter/rules/reinforcement_board.gd")
const SupplyPosition := preload("res://works/third-winter/rules/supply_position.gd")
const SupplyTrace := preload("res://works/third-winter/rules/supply_trace.gd")


## 崩溃落点：先移除所有待崩溃延补队，再按剩余补给网算每枚的射程内 trace 格。
## 返回 [{id, destinations}]；destinations 为空表示无处可去，按 TS 原地翻回运输队。
static func displacements(state: Dictionary, side: String, ids: Array, data: Dictionary) -> Array:
	if ids.is_empty():
		return []
	var units: Dictionary = (state.get("units", {}) as Dictionary).duplicate(true)
	for id: Variant in ids:
		units.erase(str(id))
	var position := SupplyPosition.position(units, state.get("railControl", {}), side, data)
	var graph: Dictionary = data.get("view", {}).get("mapGraph", {})
	var network := SupplyTrace.network(graph, position, side, str(position.get("weather", "freeze")))
	network.prepare_trace_coverage()
	var all_hexes: Array = (graph.get("terrains", {}) as Dictionary).keys()
	all_hexes.sort()
	var supplied := {}
	var result: Array = []
	for id: Variant in ids:
		var unit: Dictionary = (state.get("units", {}) as Dictionary).get(str(id), {})
		var from := str(unit.get("hex", ""))
		var extender: Variant = unit.get("extender")
		var reach := int(extender.get("range", 0)) if extender is Dictionary else 0
		var destinations: Array = []
		for hex_id: String in all_hexes:
			if hex_id == from or ReinforcementBoard.hex_distance(from, hex_id) > reach:
				continue
			if not supplied.has(hex_id):
				supplied[hex_id] = network.has_trace(hex_id)
			if supplied[hex_id]:
				destinations.append(hex_id)
		result.append({"id": str(id), "destinations": destinations})
	return result


## collapse-extender：移动阶段由本方选择一枚本回合未行动的延补队，崩溃到射程内有补给的格。
static func collapse(state: Dictionary, side: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var window := _assert_window(state, side)
	if not window.ok:
		return window
	var unit_id := str(action.get("unitId", ""))
	var unit: Dictionary = state.get("units", {}).get(unit_id, {})
	if unit.is_empty() or str(unit.get("side", "")) != side or unit.get("extender") == null:
		return Result.failure("extender_unit", "请选择本方延补队")
	if (state.get("moved", []) as Array).has(unit_id):
		return Result.failure("extender_moved", "该延补队本阶段已行动")
	var destination := _hex_id(str(action.get("destination", "")))
	var choices: Array = displacements(state, side, [unit_id], data)
	var allowed: Array = choices[0].get("destinations", []) if not choices.is_empty() else []
	if not allowed.has(destination):
		return Result.failure("extender_destination", "崩溃落点须在射程内且有补给 trace")
	return Result.success(_flip(state, unit_id, destination, true))


## 夺取窗口用：无处可去的延补队在被夺取格原地翻回运输队，不标记已行动。
static func flip_in_place(state: Dictionary, unit_id: String, hex_id: String) -> Dictionary:
	return _flip(state, unit_id, hex_id, false)


static func _flip(state: Dictionary, unit_id: String, hex_id: String, spent: bool) -> Dictionary:
	var next: Dictionary = state.duplicate(true)
	var unit: Dictionary = (next.get("units", {}) as Dictionary).get(unit_id, {}).duplicate(true)
	unit["hex"] = hex_id
	unit.erase("extender")
	unit["transportCargoTokens"] = 0
	next["units"][unit_id] = unit
	if spent:
		var moved: Array = (next.get("moved", []) as Array).duplicate()
		if not moved.has(unit_id):
			moved.append(unit_id)
		next["moved"] = moved
	return next


static func _assert_window(state: Dictionary, side: String) -> Dictionary:
	var cursor: Dictionary = state.get("cursor", {})
	if str(state.get("turn", {}).get("step", {}).get("kind", "")) != "player-turn" \
			or str(cursor.get("phase", "")) != "movement" or str(cursor.get("phasing", "")) != side:
		return Result.failure("extender_window", "延补队崩溃只能在本方移动阶段进行")
	if str(state.get("turn", {}).get("weather", {}).get("ground", "")) == "thaw":
		return Result.failure("extender_window", "解冻天气不能重整运输队")
	if state.get("combat") != null or state.get("barrage") != null \
			or not (state.get("combatTargets", []) as Array).is_empty():
		return Result.failure("extender_window", "战斗或炮击待决时不能崩溃延补队")
	return Result.success({})


static func _hex_id(source: String) -> String:
	var match := RegEx.create_from_string("^s(\\d+)\\.(\\d{1,2})$").search(source)
	if match == null:
		return source
	return "s%s.%s" % [match.get_string(1), match.get_string(2).pad_zeros(2)]
