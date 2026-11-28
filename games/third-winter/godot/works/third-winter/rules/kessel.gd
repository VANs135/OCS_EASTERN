extends RefCounted

## TTW 2.3a / Q05 — Kessel 司令部入盒与移除（`src/match/scorpion-kessel.ts`）。
## 两个席位固定为 08 剧本的 1st Corps（开局在盘）与 4th Corps（开局在盒）；
## 离场后按 `kesselReturnAfterRemoval` 记「回合 + 3」再可入盘。

const Result := preload("res://scripts/core/result.gd")
const TerrainCost := preload("res://works/third-winter/rules/terrain_cost.gd")
const SupplyPosition := preload("res://works/third-winter/rules/supply_position.gd")
const ReinforcementBoard := preload("res://works/third-winter/rules/reinforcement_board.gd")
const Capture := preload("res://works/third-winter/rules/capture.gd")

const SLOTS := [
	{"definition": "hq:id:4150", "originalId": "setup:hq:id:4150:1"},
	{"definition": "hq:id:4151", "originalId": "kessel:hq:id:4151"},
]


## `scorpionKesselWindow`：轴心本方增援阶段、玩家回合、无战斗待决。
static func window(state: Dictionary, side: String) -> bool:
	if state.get("kind") != "playing" or state.get("victory") != null:
		return false
	if side != "axis":
		return false
	var cursor: Dictionary = state.get("cursor", {})
	if str(cursor.get("phasing", "")) != side or str(cursor.get("phase", "")) != "reinforcement":
		return false
	if str(state.get("turn", {}).get("step", {}).get("kind", "")) != "player-turn":
		return false
	return state.get("combat") == null


## `scorpionKesselSlots`：每席给出在盘 id、阵亡/盒内状态与可入盘回合。
static func slots(state: Dictionary, data: Dictionary) -> Array:
	var turn := _turn(state)
	var definitions: Dictionary = data.get("view", {}).get("catalog", {}).get("definitions", {})
	var rows: Array = []
	for slot: Dictionary in SLOTS:
		var definition := str(slot.definition)
		var printed: Dictionary = definitions.get(definition, {})
		if printed.is_empty() or not (printed.get("abilities", []) as Array).has("kessel_supply"):
			continue
		var found_id := ""
		for id: String in state.get("units", {}):
			if str(state.units[id].get("definition", "")) == definition:
				found_id = id
				break
		var dead := false
		for piece: Variant in state.get("pieces", []):
			if piece is Dictionary and str((piece as Dictionary).get("definition", "")) == definition \
					and str((piece as Dictionary).get("location", {}).get("kind", "")) == "dead-pile":
				dead = true
				break
		var available_from := 1
		var returns: Variant = state.get("kesselReturns")
		if state.get("kind") == "playing" and returns is Dictionary:
			available_from = int((returns as Dictionary).get(definition, 1))
		rows.append({"definition": definition, "originalId": str(slot.originalId), "id": found_id,
			"dead": dead, "availableFromTurn": available_from,
			"ready": found_id.is_empty() and not dead and available_from <= turn})
	return rows


## `scorpionKesselTargets`：轴心战斗算子所在格，去重。
static func targets(state: Dictionary) -> Array:
	var hexes: Array = []
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		var hex := str(unit.get("hex", ""))
		if str(unit.get("side", "")) == "axis" and unit.get("combat") == true \
				and not hex.is_empty() and not hexes.has(hex):
			hexes.append(hex)
	return hexes


## `applyScorpionKessel`：`place-kessel-hq` / `remove-kessel-hq`。
static func apply(state: Dictionary, side: String, action: Dictionary, data: Dictionary) -> Dictionary:
	if not window(state, side):
		return Result.failure("kessel_window", "Kessel 司令部入盒或移除只能在本方增援阶段进行")
	var rows := slots(state, data)
	var kind := str(action.get("type", ""))
	if kind == "remove-kessel-hq":
		var unit_id := str(action.get("unitId", ""))
		var picked: Dictionary = {}
		for row: Dictionary in rows:
			if str(row.get("id", "")) == unit_id and not unit_id.is_empty():
				picked = row
				break
		if picked.is_empty():
			return Result.failure("kessel_unit", "请选择盘上的 Kessel 司令部")
		var units: Dictionary = state.get("units", {}).duplicate(true)
		units.erase(unit_id)
		state["units"] = units
		var returns: Dictionary = state.get("kesselReturns", {}).duplicate()
		returns[str(picked.definition)] = _turn(state) + 3
		state["kesselReturns"] = returns
		return Result.success(state)
	if kind != "place-kessel-hq":
		return Result.failure("kessel_action", "Kessel 命令只能是入盒或移除")
	var definition := str(action.get("definition", ""))
	var picked: Dictionary = {}
	for row: Dictionary in rows:
		if str(row.get("definition", "")) == definition:
			picked = row
			break
	var hex := str(action.get("hex", ""))
	var graph: Dictionary = data.get("view", {}).get("mapGraph", {})
	if picked.is_empty() or not picked.get("ready", false) or not graph.get("terrains", {}).has(hex):
		return Result.failure("kessel_slot", "请选择可用且已到返还回合的 Kessel 司令部")
	if not targets(state).has(hex):
		return Result.failure("kessel_hex", "Kessel 司令部只能落在有本方战斗算子的格")
	var template: Dictionary = data.get("view", {}).get("catalog", {}).get("counters", {}).get(definition, {})
	if template.is_empty():
		return Result.failure("kessel_template", "数据包缺少该 Kessel 司令部的计数器模板")
	var unit: Dictionary = template.duplicate(true)
	unit["hex"] = hex
	unit["stepsLost"] = 0
	var units: Dictionary = state.get("units", {}).duplicate(true)
	units[str(picked.originalId)] = unit
	state["units"] = units
	var returns: Dictionary = state.get("kesselReturns", {}).duplicate()
	returns.erase(definition)
	state["kesselReturns"] = returns
	return Result.success(state)


## TTW 2.3a(B) — Kessel 特规行军（`src/match/scorpion-kessel-move.ts`）：
## 轴心步行战斗算子在本方移动阶段，沿 Kessel 司令部两格内 1–4 格、不向东，且不得穿敌战斗/补给格。
static func move_check(state: Dictionary, side: String, action: Dictionary, data: Dictionary) -> Dictionary:
	if state.get("kind") != "playing" or state.get("victory") != null:
		return Result.failure("kessel_window", "请先开始 08 对局")
	var cursor: Dictionary = state.get("cursor", {})
	if side != "axis" or str(cursor.get("phasing", "")) != side or str(cursor.get("phase", "")) != "movement" \
			or str(state.get("turn", {}).get("weather", {}).get("ground", "")) == "thaw" \
			or str(state.get("turn", {}).get("step", {}).get("kind", "")) != "player-turn":
		return Result.failure("kessel_window", "Kessel 行军只能在本方非解冻移动阶段进行")
	if _has_phase_barrage(state):
		return Result.failure("kessel_barrage", "本阶段已有炮击，不能再进行 Kessel 行军")
	var unit_id := str(action.get("unitId", ""))
	var unit: Dictionary = state.get("units", {}).get(unit_id, {})
	var moved: Array = state.get("moved", [])
	var activity: Dictionary = state.get("groundActivity", {})
	var airlifted: Array = activity.get("airlifted", [])
	if unit.is_empty() or unit.get("combat") != true or str(unit.get("side", "")) != side \
			or str(unit.get("mobility", "")) != "leg" or int(unit.get("allowance", 0)) <= 0 \
			or unit.get("reserve") != null or unit.get("exploit") != null or unit.get("disorganized") == true \
			or moved.has(unit_id) or airlifted.has(unit_id):
		return Result.failure("kessel_unit", "Kessel 行军须选未动的轴心步行战斗算子")
	var hq_id := str(action.get("headquartersId", ""))
	var headquarters: Dictionary = state.get("units", {}).get(hq_id, {})
	var flag: Variant = headquarters.get("headquarters")
	if headquarters.is_empty() or str(headquarters.get("side", "")) != side \
			or not (flag is Dictionary) or (flag as Dictionary).get("kessel") != true:
		return Result.failure("kessel_hq", "请选择盘上的轴心 Kessel 司令部")
	var path: Array = []
	for value: Variant in action.get("path", []):
		path.append(str(value))
	if path.is_empty() or path.size() > 4:
		return Result.failure("kessel_path", "Kessel 行军须进入 1–4 格")
	var position := SupplyPosition.position(state.get("units", {}), state.get("railControl", {}), side, data)
	var enemy_combat: Array = position.enemyCombat
	var unnegated: Array = position.unnegatedEnemyZoc
	var opponent := "soviet"
	var enemy_sources: Array = data.get("view", {}).get("supplySources", {}).get(opponent, [])
	var graph: Dictionary = data.get("view", {}).get("mapGraph", {})
	var weather := "freeze" if str(state.get("turn", {}).get("weather", {}).get("ground", "")) == "freeze" else "dry"
	var from := str(unit.get("hex", ""))
	for index in path.size():
		var to: String = path[index]
		if ReinforcementBoard.hex_distance(str(headquarters.get("hex", "")), to) > 2:
			return Result.failure("kessel_distance", "每个进入格都须在 Kessel 司令部两格内")
		var step: Variant = TerrainCost.step_cost(graph, from, to, "leg", weather)
		if step == null or enemy_combat.has(to) or enemy_sources.has(to):
			return Result.failure("kessel_blocked", "Kessel 行军不能进入受阻地形、敌战斗格或敌补给源")
		if index < path.size() - 1 and (step is String or unnegated.has(to)):
			return Result.failure("kessel_stop", "Kessel 行军须在 All 成本或未抵消敌 ZOC 格停下")
		from = to
	if _column(from) > _column(str(unit.get("hex", ""))):
		return Result.failure("kessel_east", "Kessel 行军的终点不能在本格以东")
	return Result.success({"path": path})


static func move_apply(state: Dictionary, side: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var checked := move_check(state, side, action, data)
	if not checked.ok:
		return checked
	var unit_id := str(action.get("unitId", ""))
	var path: Array = checked.value.path
	state["units"][unit_id]["hex"] = str(path[path.size() - 1])
	state["groundCaptureMove"] = null
	var working := state
	for index in path.size():
		var step_res := Capture.resolve_entry(working, side, str(path[index]), [unit_id], data, false,
			path.slice(index + 1))
		if not step_res.ok:
			return step_res
		working = step_res.value
		if working.get("capture") != null and index != path.size() - 1:
			return Result.failure("capture_route_end", "本次 Kessel 行军必须以待决夺取格为终点")
	state = working
	var moved: Array = state.get("moved", []).duplicate()
	moved.append(unit_id)
	state["moved"] = moved
	return Result.success(state)


static func _has_phase_barrage(state: Dictionary) -> bool:
	if state.get("barrage") != null:
		return true
	var cursor: Dictionary = state.get("cursor", {})
	for event: Variant in state.get("barrageHistory", []):
		if event is Dictionary and int((event as Dictionary).get("turn", -1)) == int(cursor.get("turn", 0)) \
				and str((event as Dictionary).get("phasing", "")) == str(cursor.get("phasing", "")) \
				and str((event as Dictionary).get("phase", "")) == str(cursor.get("phase", "")):
			return true
	return false


static func _column(hex: String) -> int:
	var dot := hex.find(".")
	if dot <= 1:
		return 0
	return int(hex.substr(1, dot - 1))


static func _turn(state: Dictionary) -> int:
	return int(state.get("turn", {}).get("number", 1))
