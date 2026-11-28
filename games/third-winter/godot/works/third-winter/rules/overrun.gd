extends RefCounted

## OCS 8.1 / TTW 2.3a — 突袭（overrun）：移动段内同格出发的攻方堆，花 3 MP 攻击相邻格；
## 守方清空后全部存活者自动进格，否则留在原格并可用余量继续行军。
## 对照 `src/match/scorpion-overrun.ts`；本轮只接直接邻格宣告与战斗后继续，不接战前移动前缀。

const Result := preload("res://scripts/core/result.gd")
const Combat := preload("res://works/third-winter/rules/combat.gd")
const CombatTerrain := preload("res://works/third-winter/rules/combat_terrain.gd")
const Modes := preload("res://scripts/rules/series/modes.gd")
const TerrainCost := preload("res://works/third-winter/rules/terrain_cost.gd")
const SupplyPosition := preload("res://works/third-winter/rules/supply_position.gd")
const Stacking := preload("res://works/third-winter/rules/stacking.gd")
const Capture := preload("res://works/third-winter/rules/capture.gd")

const COST := 3


static func window(state: Dictionary, side: String) -> bool:
	var cursor: Dictionary = state.get("cursor", {})
	return state.get("kind") == "playing" and state.get("victory") == null \
		and str(cursor.get("phasing", "")) == side \
		and ["movement", "reaction", "exploitation"].has(str(cursor.get("phase", ""))) \
		and str(state.get("turn", {}).get("weather", {}).get("ground", "")) != "thaw" \
		and state.get("combat") == null and state.get("barrage") == null \
		and state.get("combatTargets", []).is_empty() and not _has_phase_barrage(state)


## 宣告前的纯校验：不改盘面，侧栏与规则层共用，避免同一条突袭在界面能点、规则却拒。
static func check(state: Dictionary, side: String, action: Dictionary, data: Dictionary) -> Dictionary:
	if not window(state, side):
		return Result.failure("overrun_window", "突袭只能在本方移动段且无待决战斗时进行")
	var ids: Array = action.get("attackers", [])
	if ids.is_empty():
		return Result.failure("overrun_attacker", "突袭至少需要一枚攻方单位")
	var seen := {}
	var origin := ""
	for id: String in ids:
		if seen.has(id):
			return Result.failure("overrun_attacker", "突袭攻方名单重复：%s" % id)
		seen[id] = true
		var unit: Dictionary = state.get("units", {}).get(id, {})
		if unit.is_empty() or str(unit.get("side", "")) != side or unit.get("attackCapable", false) != true \
				or unit.get("disorganized", false) == true:
			return Result.failure("overrun_attacker", "突袭攻方资格不符：%s" % id)
		if origin.is_empty():
			origin = str(unit.get("hex", ""))
		elif str(unit.get("hex", "")) != origin:
			return Result.failure("overrun_attacker", "突袭攻方须从同一格出发")
		var mode := Modes.ground_mode_effect(CombatTerrain._ground_state(unit))
		if mode.get("canOverrun", false) != true:
			return Result.failure("overrun_attacker", "该面不能突袭：%s" % id)
		var march: Variant = state.get("overrunMarch")
		var resumed: bool = march is Dictionary and (march as Dictionary).get("remaining", {}).has(id)
		if state.get("moved", []).has(id) and not resumed:
			return Result.failure("overrun_attacker", "该算子本阶段已动：%s" % id)
		if str(unit.get("mobility", "")) != "leg" and unit.get("fueled", false) != true:
			return Result.failure("overrun_fuel", "机械化突袭须先加油：%s" % id)
		if _remaining(state, id, unit) < COST:
			return Result.failure("overrun_mp", "每枚突袭攻方至少要有 3 MP：%s" % id)
	var target := str(action.get("target", ""))
	var neighbors: Dictionary = data.get("view", {}).get("mapGraph", {}).get("neighbors", {})
	if target.is_empty() or not neighbors.get(origin, []).has(target):
		return Result.failure("overrun_target", "突袭目标须是与出发点相邻的一格")
	var opponent := "soviet" if side == "axis" else "axis"
	var enemy_sources: Array = data.get("view", {}).get("supplySources", {}).get(opponent, [])
	if enemy_sources.has(target):
		return Result.failure("overrun_target", "敌方补给源格不能作为突袭目标")
	var has_defender := false
	for unit: Dictionary in state.get("units", {}).values():
		if str(unit.get("side", "")) == opponent and str(unit.get("hex", "")) == target \
				and unit.get("combat", false) == true:
			has_defender = true
			break
	if not has_defender:
		return Result.failure("overrun_target", "突袭目标格须有敌战斗算子：%s" % target)
	var weather := "freeze" if str(state.get("turn", {}).get("weather", {}).get("ground", "")) == "freeze" else "dry"
	var graph: Dictionary = data.get("view", {}).get("mapGraph", {})
	for id: String in ids:
		var unit: Dictionary = state.get("units", {}).get(id, {})
		var step: Variant = TerrainCost.step_cost(graph, origin, target, str(unit.get("mobility", "")), weather, false)
		if not (step is int or step is float) or int(step) > COST:
			return Result.failure("overrun_entry", "突袭进格须为数值且不超过 3 MP：%s" % id)
	return Result.success({"origin": origin, "target": target, "attackers": ids})


## `declareScorpionOverrun`：先按普通战斗的攻方补给口径宣告，再把 3 MP 与余量账本落到局面上。
static func declare(state: Dictionary, side: String, action: Dictionary, data: Dictionary,
		board: Dictionary = {}) -> Dictionary:
	var checked := check(state, side, action, data)
	if not checked.ok:
		return checked
	var combat_action: Dictionary = action.duplicate(true)
	combat_action["type"] = "declare-combat"
	combat_action["kind"] = "overrun"
	var remaining := {}
	for id: String in action.get("attackers", []):
		remaining[id] = _remaining(state, id, state.get("units", {}).get(id, {})) - COST
	var declared: Dictionary = Combat.declare(state, side, combat_action, data, board)
	if not declared.ok:
		return declared
	var next: Dictionary = declared.value
	var ids: Array = action.get("attackers", [])
	for id: String in ids:
		remaining[id] = int(remaining.get(id, 0))
	next["overrunMarch"] = {"remaining": remaining, "enteredHex": false}
	var activity: Dictionary = next.get("groundActivity", {}).duplicate(true)
	var spent: Dictionary = activity.get("spent", {}).duplicate()
	for id: String in ids:
		spent[id] = int(spent.get(id, 0)) + COST
	activity["spent"] = spent
	next["groundActivity"] = activity
	var moved: Array = next.get("moved", []).duplicate()
	for id: String in ids:
		if not moved.has(id):
			moved.append(id)
	next["moved"] = moved
	next["groundCaptureMove"] = null
	return Result.success(next)


## `continueScorpionOverrunMove`：战斗结束后幸存者用余量续走；任一步走到夺取窗口即停在该格。
static func continue_check(state: Dictionary, side: String, action: Dictionary, data: Dictionary) -> Dictionary:
	if not window(state, side):
		return Result.failure("overrun_window", "当前不能继续突袭行军")
	var march: Variant = state.get("overrunMarch")
	if not (march is Dictionary):
		return Result.failure("overrun_march", "当前没有突袭余量")
	var ids: Array = (march as Dictionary).get("remaining", {}).keys()
	var path: Array = []
	for value: Variant in action.get("path", []):
		path.append(str(value))
	if ids.is_empty() or path.is_empty():
		return Result.failure("overrun_path", "请选择突袭续走路线")
	var from := ""
	for id: String in ids:
		var unit: Dictionary = state.get("units", {}).get(id, {})
		if unit.is_empty():
			return Result.failure("overrun_march", "突袭攻方已不在盘面：%s" % id)
		if unit.get("disorganized", false) == true:
			return Result.failure("overrun_attacker", "混乱单位不能继续突袭行军：%s" % id)
		if str(unit.get("mobility", "")) != "leg" and unit.get("fueled", false) != true:
			return Result.failure("overrun_fuel", "机械化突袭须保持已加油：%s" % id)
		if from.is_empty():
			from = str(unit.get("hex", ""))
		elif str(unit.get("hex", "")) != from:
			return Result.failure("overrun_march", "突袭攻方须从同一格续走")
	var position := SupplyPosition.position(state.get("units", {}), state.get("railControl", {}), side, data)
	var enemy_combat: Array = position.enemyCombat
	var unnegated: Array = position.unnegatedEnemyZoc
	var opponent := "soviet" if side == "axis" else "axis"
	var enemy_sources: Array = data.get("view", {}).get("supplySources", {}).get(opponent, [])
	var graph: Dictionary = data.get("view", {}).get("mapGraph", {})
	var weather := "freeze" if str(state.get("turn", {}).get("weather", {}).get("ground", "")) == "freeze" else "dry"
	var remaining: Dictionary = (march as Dictionary).get("remaining", {}).duplicate()
	for to: String in path:
		if enemy_combat.has(to) or enemy_sources.has(to):
			return Result.failure("overrun_path", "突袭续走不能进入敌战斗格或敌补给源")
		for id: String in ids:
			var unit: Dictionary = state.get("units", {}).get(id, {})
			if str(unit.get("mobility", "")) == "truck" and unnegated.has(from):
				return Result.failure("overrun_zoc", "卡车在敌方控制区须停下或再次突袭")
			var step: Variant = TerrainCost.step_cost(graph, from, to, str(unit.get("mobility", "")), weather, false)
			if not (step is int or step is float) or int(remaining.get(id, 0)) < int(step):
				return Result.failure("overrun_path", "突袭余量不足以走到该格：%s" % id)
			remaining[id] = int(remaining.get(id, 0)) - int(step)
		from = to
	return Result.success({"path": path, "remaining": remaining})


static func continue_apply(state: Dictionary, side: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var checked := continue_check(state, side, action, data)
	if not checked.ok:
		return checked
	var path: Array = checked.value.path
	var ids: Array = state.get("overrunMarch", {}).get("remaining", {}).keys()
	var before: Dictionary = state.get("overrunMarch", {}).get("remaining", {}).duplicate()
	var final_hex := str(path[path.size() - 1])
	var units: Dictionary = state.get("units", {}).duplicate(true)
	for id: String in ids:
		units[id]["hex"] = final_hex
	state["units"] = units
	state["overrunMarch"] = {"remaining": checked.value.remaining,
		"enteredHex": true}
	var activity: Dictionary = state.get("groundActivity", {}).duplicate(true)
	var spent: Dictionary = activity.get("spent", {}).duplicate()
	for id: String in ids:
		spent[id] = int(spent.get(id, 0)) + int(before.get(id, 0)) - int(checked.value.remaining.get(id, 0))
	activity["spent"] = spent
	state["groundActivity"] = activity
	var working := state
	for index in path.size():
		var entry: Dictionary = Capture.resolve_entry(working, side, str(path[index]), ids, data, false,
			path.slice(index + 1))
		if not entry.ok:
			return entry
		working = entry.value
		if working.get("capture") != null and index != path.size() - 1:
			return Result.failure("capture_route_end", "突袭续走必须以待决夺取格为终点")
	state = working
	if state.get("capture") == null:
		state["overrunMarch"] = null
	return Result.success(state)


static func _remaining(state: Dictionary, id: String, unit: Dictionary) -> int:
	var march: Variant = state.get("overrunMarch")
	if march is Dictionary and (march as Dictionary).get("remaining", {}).has(id):
		return int((march as Dictionary).remaining[id])
	return int(unit.get("allowance", 0))


static func _has_phase_barrage(state: Dictionary) -> bool:
	var cursor: Dictionary = state.get("cursor", {})
	for event: Variant in state.get("barrageHistory", []):
		if event is Dictionary and int((event as Dictionary).get("turn", -1)) == int(cursor.get("turn", 0)) \
				and str((event as Dictionary).get("phasing", "")) == str(cursor.get("phasing", "")) \
				and str((event as Dictionary).get("phase", "")) == str(cursor.get("phase", "")):
			return true
	return false
