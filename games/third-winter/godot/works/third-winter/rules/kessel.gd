extends RefCounted

## TTW 2.3a / Q05 — Kessel 司令部入盒与移除（`src/match/scorpion-kessel.ts`）。
## 两个席位固定为 08 剧本的 1st Corps（开局在盘）与 4th Corps（开局在盒）；
## 离场后按 `kesselReturnAfterRemoval` 记「回合 + 3」再可入盘。

const Result := preload("res://scripts/core/result.gd")

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


static func _turn(state: Dictionary) -> int:
	return int(state.get("turn", {}).get("number", 1))
