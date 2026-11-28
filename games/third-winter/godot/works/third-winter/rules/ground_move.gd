extends RefCounted

const Result := preload("res://scripts/core/result.gd")
const TerrainCost := preload("res://works/third-winter/rules/terrain_cost.gd")
const SupplyPosition := preload("res://works/third-winter/rules/supply_position.gd")
const Fuel := preload("res://works/third-winter/rules/fuel.gd")


## OCS 6.1 and 14.8c — one normal single-counter ground move of src/match/scorpion-movement.ts.
## The whole route is checked before the board changes, so a rejected move leaves the ledger intact.
static func apply(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var unit_id := str(action.get("unitId", ""))
	var path: Array = []
	for hex: Variant in action.get("path", []):
		path.append(str(hex))
	## 桌面 `ground-move` 可以顺带付油：先按 TS `fuelScorpionMovement` 走单枚油源，
	## 付完再校验路线；只认补给堆/运输车油源，已加油司令部投送还没原生。
	if action.get("fuelHeadquartersId") != null:
		return Result.failure("fuel_headquarters", "已加油司令部投送还没移植，请改用补给堆付油")
	var fuel_paid := false
	var dump_id := str(action.get("fuelDumpId", ""))
	if not dump_id.is_empty():
		var fueled := Fuel.fuel_with_dump(state, actor, unit_id, dump_id, data)
		if not fueled.ok:
			return fueled
		fuel_paid = true
	var checked := check(state, actor, unit_id, path, data, fuel_paid)
	if not checked.ok:
		return Result.failure(str(checked.errorCode), str(checked.message))
	var spent: int = int(checked.spent)
	var from := str(checked.to)
	var activity := _activity(state)
	var spent_book: Dictionary = activity.spent.duplicate()
	spent_book[unit_id] = int(spent_book.get(unit_id, 0)) + spent
	activity.spent = spent_book
	state.groundActivity = activity
	state.units[unit_id].hex = from
	var moved: Array = state.get("moved", [])
	var next_moved: Array = moved.duplicate()
	next_moved.append(unit_id)
	state.moved = next_moved
	state.overrunMarch = null
	return Result.success(state)


## 同一套校验的纯函数版（不改盘面）：视图用它决定要不要给出「移动到 X」，
## 规则用它落地，两侧不会因为各写一份判断而漂移。
static func check(state: Dictionary, actor: String, unit_id: String, path: Array, data: Dictionary,
		fuel_paid: bool = false) -> Dictionary:
	if state.kind != "playing":
		return _refuse("match_not_started", "请先开始 08 对局")
	if state.get("victory") != null:
		return _refuse("match_over", "对局已结束")
	var cursor: Dictionary = state.cursor
	if str(cursor.get("phase")) != "movement":
		return _refuse("movement_phase", "当前不在移动阶段")
	if str(cursor.get("phasing")) != actor:
		return _refuse("wrong_actor", "该方不能执行移动")
	if str(state.turn.weather.ground) == "thaw":
		return _refuse("movement_weather", "解冻天气禁止移动")
	var unit: Dictionary = state.get("units", {}).get(unit_id, {})
	if unit.is_empty() or str(unit.get("side")) != actor:
		return _refuse("movement_unit", "请选择本方的地面算子")
	if unit.get("extender") != null:
		return _refuse("movement_unit", "延补队不能自行移动")
	var allowance := _allowance(unit, str(cursor.get("phase")))
	if allowance <= 0:
		return _refuse("movement_allowance", "该算子没有可用移动力")
	# OCS 6.1 — a combat counter with a mechanised face needs fuel before it can use that face.
	if not fuel_paid and unit.get("combat") == true and str(unit.get("mobility")) != "leg" and unit.get("fueled") != true:
		return _refuse("movement_fuel", "机械化战斗面需要先加油")
	var moved: Array = state.get("moved", [])
	if moved.has(unit_id):
		return _refuse("movement_spent", "该算子在本阶段已经移动")
	if path.is_empty():
		return _refuse("movement_path", "请选择移动路线")
	var position := SupplyPosition.position(state.get("units", {}), state.get("railControl", {}), actor, data)
	var blocked_by_combat: Array = position.enemyCombat
	var opponent := "axis" if actor == "soviet" else "soviet"
	var enemy_sources: Array = data.view.get("supplySources", {}).get(opponent, [])
	var unnegated: Array = position.unnegatedEnemyZoc
	var graph: Dictionary = data.view.mapGraph
	var weather := "freeze" if str(state.turn.weather.ground) == "freeze" else "dry"
	var truck := str(unit.get("mobility")) == "truck"
	var from := str(unit.hex)
	var spent := 0
	for index in path.size():
		var to: String = path[index]
		var last: bool = index == path.size() - 1
		if blocked_by_combat.has(to) or enemy_sources.has(to):
			return _refuse("movement_blocked", "敌方战斗算子或补给源阻挡移动")
		var step: Variant = TerrainCost.step_cost(graph, from, to, str(unit.mobility), weather)
		if step == null:
			return _refuse("movement_passable", "没有可通行的格边")
		if step is String:
			# OCS 6.1c — an "all" crossing consumes the whole allowance and must be the only hex.
			if index != 0 or not last:
				return _refuse("movement_crossing", "该横渡需要耗尽全部移动力")
			spent = allowance
		else:
			spent += int(step)
			if spent > allowance:
				return _refuse("movement_allowance", "移动力不足以走到该格")
		if not last and truck and unnegated.has(to):
			return _refuse("movement_zoc", "卡车进入敌方控制区必须停下")
		from = to
	var activity := _activity(state)
	if activity.airlifted.has(unit_id):
		var limit: int = allowance / 2
		if int(activity.spent.get(unit_id, 0)) + spent > limit:
			return _refuse("movement_airlift", "空运后的地面移动力不足")
	return {"ok": true, "spent": spent, "to": from}


static func _refuse(code: String, message: String) -> Dictionary:
	return {"ok": false, "errorCode": code, "message": message}


## src/match/scorpion-movement.ts — the move factor is 1 in the Movement Phase; other phases are not
## migrated yet, so they are rejected before this is consulted.
static func _allowance(unit: Dictionary, phase: String) -> int:
	if phase != "movement":
		return 0
	return int(unit.get("allowance", 0))


## src/match/scorpion-ground-activity.ts — the books reset whenever the acting player turn or phase moves.
static func _activity(state: Dictionary) -> Dictionary:
	var cursor: Dictionary = state.cursor
	var stored: Variant = state.get("groundActivity")
	if stored is Dictionary:
		if int(stored.get("turn", -1)) == int(cursor.get("turn")) \
				and str(stored.get("phasing")) == str(cursor.get("phasing")) \
				and str(stored.get("phase")) == str(cursor.get("phase")):
			var kept: Dictionary = stored.duplicate(true)
			kept.spent = kept.get("spent", {}).duplicate()
			kept.airlifted = kept.get("airlifted", []).duplicate()
			return kept
	return {"turn": int(cursor.get("turn")), "phasing": str(cursor.get("phasing")),
		"phase": str(cursor.get("phase")), "spent": {}, "airlifted": []}
