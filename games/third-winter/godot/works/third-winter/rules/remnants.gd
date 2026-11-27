extends RefCounted

## src/match/scorpion-remnants.ts — TTW 2.4d: an eliminated eligible Axis infantry division
## leaves a remnant battalion on the board (`place`/`place_remnant`); TTW 2.4d and 1.7a later
## exchange that remnant plus one Axis Pax for its parent (`rebuild`). The parent must sit on the
## dead pile, the remnant must stand with a supplied Corps/Army HQ outside enemy ZOC, and the
## rebuilt counter enters one step down.

const SupplyPosition := preload("res://works/third-winter/rules/supply_position.gd")
const SupplyTrace := preload("res://works/third-winter/rules/supply_trace.gd")
const TerrainCost := preload("res://works/third-winter/rules/terrain_cost.gd")
const GroundMode := preload("res://works/third-winter/rules/ground_mode_actions.gd")
const Result := preload("res://scripts/core/result.gd")

## Scenario booklet p.55 supplies two interchangeable battalions; the first unused printed copy
## goes on the board (src/match/scorpion-remnants.ts `scorpionRemnantDefinitions`).
const REMNANT_DEFINITIONS := ["land:id:3999", "land:id:4499"]


static func rebuild(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	if actor != "axis" or str(state.cursor.get("phasing")) != actor \
			or str(state.cursor.get("phase")) != "reinforcement" or state.get("window") == null \
					or int(state.get("pax", {}).get("axis", 0)) < 1:
		return Result.failure("remnant_rebuild", "重建残部需要轴心的增援人员补充点")
	var units: Dictionary = state.get("units", {})
	var remnant_id := str(action.get("remnantId", ""))
	var remnant: Dictionary = units.get(remnant_id, {})
	if remnant.is_empty():
		return Result.failure("remnant_rebuild", "请选择本方在场残部")
	var parent_id := str(remnant.get("remnantOf", ""))
	var parent: Dictionary = {}
	for piece: Dictionary in state.get("pieces", []):
		if str(piece.get("id")) == parent_id and str(piece.get("side")) == actor \
				and str(piece.get("location", {}).get("kind")) == "dead-pile":
			parent = piece
			break
	if parent.is_empty():
		return Result.failure("remnant_rebuild", "该残部的母单位不在死人堆")
	var hex := str(remnant.get("hex", ""))
	if not _hq_present(state, actor, hex, data):
		return Result.failure("remnant_rebuild", "残部须与可用的轴心军/集团军司令部同格")
	if SupplyPosition.enemy_zoc(units, actor, data).has(hex):
		return Result.failure("remnant_rebuild", "残部不能位于敌方 ZOC")
	var weather := "freeze" if str(state.turn.get("weather", {}).get("ground")) == "freeze" else "dry"
	var position := SupplyPosition.position(units, state.get("railControl", {}), actor, data)
	var network: RefCounted = SupplyTrace.network(data.view.mapGraph, position, actor, weather)
	if not network.has_trace(hex):
		return Result.failure("remnant_rebuild", "残部所在地须有追溯补给")
	## The native catalog keeps counter stats only for arrivals, so the dead pile carries the whole
	## counter snapshot of the eliminated unit; the TypeScript side re-reads them from its catalog.
	var catalog: Dictionary = data.view.get("catalog", {})
	var template: Dictionary = (parent.get("counter", {}) as Dictionary).duplicate(true)
	if template.is_empty():
		template = (catalog.get("counters", {}) as Dictionary).get(str(parent.get("definition")), {}).duplicate(true)
	if template.is_empty():
		return Result.failure("remnant_rebuild", "缺少该母单位的算子资料")
	var face := str(action.get("face", "combat"))
	if face != "combat" and face != "move":
		return Result.failure("remnant_rebuild", "朝向只能是战斗面或移动面")
	var rebuilt: Dictionary = template.duplicate(true)
	rebuilt.hex = hex
	rebuilt.stepsLost = max(0, int(template.get("printedRe", 0)) - 1)
	## TS scorpionModeFace 战斗面原样返回部署算子（不带 moveMode）；仅移动面置位。
	if face == "move":
		rebuilt.moveMode = true
	else:
		rebuilt.erase("moveMode")
	## TTW 12.4 — a rebuilt division keeps one Pax spent for the exchange.
	var next_units: Dictionary = units.duplicate(true)
	next_units.erase(remnant_id)
	next_units[parent_id] = rebuilt
	var pieces: Array = []
	for piece: Dictionary in state.get("pieces", []):
		if str(piece.get("id")) == parent_id:
			continue
		pieces.append(piece)
	state.units = next_units
	state.pieces = pieces
	state.pax = {"axis": int(state.pax.get("axis", 0)) - 1,
		"soviet": int(state.pax.get("soviet", 0))}
	return Result.success(state)


## TTW 2.4d — generate the remnant for an eliminated eligible division. Mirrors TS
## `placeScorpionRemnant`: eligibility, unused remnant counter, two-hex westward leg destination,
## flag inheritance and the moved/activity books. Returns Result.success({ state, placed });
## `placed` is false when the division is ineligible or has no legal destination (state unchanged).
static func place(state: Dictionary, division_id: String, division: Dictionary,
		requested: Variant, data: Dictionary) -> Dictionary:
	var units: Dictionary = state.get("units", {})
	var key := _remnant_key(units, division, data)
	var choices: Array = []
	if key != "":
		choices = _destinations(state, str(division.get("hex", "")), data)
	if key == "" or choices.is_empty():
		if requested != null:
			return Result.failure("remnant_ineligible", "该师不能生成残部")
		return Result.success({"state": state, "placed": false, "remnantId": "", "hex": ""})
	var hex := ""
	if requested == null:
		hex = str(choices[0]) if choices.size() == 1 else ""
	else:
		hex = _normalize_hex(str(requested))
	if not choices.has(hex):
		return Result.failure("remnant_choice", "残部落点不在合法候选格内")
	var counters: Dictionary = data.get("view", {}).get("catalog", {}).get("counters", {})
	var template: Dictionary = counters.get(key, {})
	if template.is_empty():
		return Result.failure("remnant_counter", "缺少该残部的算子资料")
	var remnant_id := "remnant:%s" % key
	var remnant: Dictionary = template.duplicate(true)
	remnant.hex = hex
	remnant.stepsLost = 0
	if division.get("moveMode") == true:
		var projected: Variant = GroundMode.project_face(remnant, key, "move", data)
		if projected is Dictionary:
			remnant = projected
	## TS placeScorpionRemnant inherits the parent's mode/supply flags onto the remnant counter.
	for flag: String in ["disorganized", "reserve", "exploit", "exploitRating", "released",
			"outOfSupply", "internalStocks"]:
		if division.has(flag):
			remnant[flag] = division[flag]
	remnant.remnantOf = division_id
	var next_units: Dictionary = units.duplicate(true)
	next_units[remnant_id] = remnant
	state.units = next_units
	## Books: the remnant takes over the parent's moved/airlifted marks and its spent tally.
	var activity := _activity(state)
	var next_moved: Array = []
	for entry: String in state.get("moved", []):
		if entry != remnant_id:
			next_moved.append(entry)
	if state.get("moved", []).has(division_id):
		next_moved.append(remnant_id)
	state.moved = next_moved
	var next_airlifted: Array = []
	for entry: String in activity.get("airlifted", []):
		if entry != remnant_id:
			next_airlifted.append(entry)
	if activity.get("airlifted", []).has(division_id):
		next_airlifted.append(remnant_id)
	var spent: Dictionary = activity.get("spent", {}).duplicate()
	spent[remnant_id] = int(spent.get(division_id, 0))
	activity.airlifted = next_airlifted
	activity.spent = spent
	state.groundActivity = activity
	_record_control(state, "axis", hex, data)
	return Result.success({"state": state, "placed": true, "remnantId": remnant_id, "hex": hex})


## 接线别名：与 TS `placeScorpionRemnant` 同名入口。
static func place_remnant(state: Dictionary, division_id: String, division: Dictionary,
		requested: Variant, data: Dictionary) -> Dictionary:
	return place(state, division_id, division, requested, data)


## 公开落点候选（TS `placeScorpionRemnant` 内部的 destinations）：只有合格师才有名单，
## 供战斗结算的待决选择与侧栏直接展示，不再在规则层里私藏。
static func destinations(state: Dictionary, division: Dictionary, data: Dictionary) -> Array:
	if _remnant_key(state.get("units", {}), division, data) == "":
		return []
	return _destinations(state, str(division.get("hex", "")), data)


## 与 TS `scorpionRemnantDestinations(state, from, assets)` 同签名的纯坐标入口。
static func destinations_from(state: Dictionary, from_hex: String, data: Dictionary) -> Array:
	return _destinations(state, from_hex, data)


## 某师是否能在盘面生成残部（TS isParentDivision + 未用残部算子）。
static func can_place(state: Dictionary, division: Dictionary, data: Dictionary) -> bool:
	return _remnant_key(state.get("units", {}), division, data) != ""


## src/match/scorpion-remnants.ts `isParentDivision` — Ge-prefixed Axis infantry division,
## RE 4, combat face 16/AR 4/MA 3. The GDScript catalog row carries the printed record; the
## combat stats live on the deployed counter (strength / actionRating / allowance).
static func _is_parent_division(unit: Dictionary, data: Dictionary) -> bool:
	var row: Dictionary = data.get("view", {}).get("catalog", {}).get("definitions", {}) \
		.get(str(unit.get("definition", "")), {})
	if row.is_empty():
		return false
	if not str(row.get("name", "")).begins_with("Ge "):
		return false
	if str(row.get("side", "")) != "axis":
		return false
	if str(row.get("category", "")) != "infantry":
		return false
	if int(row.get("re", 0)) != 4:
		return false
	if int(unit.get("strength", 0)) != 16:
		return false
	if int(unit.get("actionRating", 0)) != 4:
		return false
	if int(unit.get("allowance", 0)) != 3:
		return false
	return true


## First remnant definition not already on the board; empty when the unit is not an eligible
## parent division or both remnant counters are active.
static func _remnant_key(units: Dictionary, division: Dictionary, data: Dictionary) -> String:
	if not _is_parent_division(division, data):
		return ""
	var active := {}
	for id: String in units:
		active[str(units[id].get("definition", ""))] = true
	for definition: String in REMNANT_DEFINITIONS:
		if not active.has(definition):
			return definition
	return ""


## TTW 2.4d — exactly two hexes away and west of the division, following a legal leg path.
## Mirrors TS `scorpionRemnantDestinations`.
static func _destinations(state: Dictionary, from_hex: String, data: Dictionary) -> Array:
	var units: Dictionary = state.get("units", {})
	var occupied := _soviet_occupied(state, data)
	var friendly_re := {}
	var friendly_combat := {}
	for id: String in units:
		var unit: Dictionary = units[id]
		if str(unit.get("side", "")) != "axis":
			continue
		var hex := str(unit.get("hex", ""))
		friendly_re[hex] = int(friendly_re.get(hex, 0)) + int(unit.get("printedRe", 0)) \
			- int(unit.get("stepsLost", 0))
		if unit.get("combat") == true:
			friendly_combat[hex] = true
	var zoc: Array = SupplyPosition.enemy_zoc(units, "axis", data)
	var weather := "freeze" if str(state.get("turn", {}).get("weather", {}).get("ground", "")) \
		== "freeze" else "dry"
	var sources: Array = data.get("view", {}).get("supplySources", {}).get("soviet", [])
	var graph: Dictionary = data.get("view", {}).get("mapGraph", {})
	var near_list: Array = graph.get("neighbors", {}).get(from_hex, [])
	var out := {}
	for near: String in near_list:
		if not _open(state, data, occupied, friendly_combat, sources, zoc, weather,
				graph, from_hex, near):
			continue
		for hex: String in graph.get("neighbors", {}).get(near, []):
			if _column(hex) >= _column(from_hex):
				continue
			if _hex_distance(from_hex, hex) != 2:
				continue
			if int(friendly_re.get(hex, 0)) + 1 > 10:
				continue
			if not _open(state, data, occupied, friendly_combat, sources, zoc, weather,
					graph, near, hex):
				continue
			out[hex] = true
	var keys: Array = out.keys()
	keys.sort()
	return keys


static func _open(state: Dictionary, data: Dictionary, occupied: Dictionary, friendly_combat: Dictionary,
		sources: Array, zoc: Array, weather: String, graph: Dictionary, from_hex: String,
		to_hex: String) -> bool:
	if occupied.has(to_hex):
		return false
	if sources.has(to_hex):
		return false
	if zoc.has(to_hex) and not friendly_combat.has(to_hex):
		return false
	return TerrainCost.step_cost(graph, from_hex, to_hex, "leg", weather) != null


## Soviet-occupied hexes for the occupancy rule (units, air bases, hedgehogs, hex pieces, on-map
## dumps). Mirrors `scorpionPhaseOccupancy`; only the Soviet side feeds the remnant destination.
static func _soviet_occupied(state: Dictionary, data: Dictionary) -> Dictionary:
	var occupied := {}
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if str(unit.get("side", "")) == "soviet":
			occupied[str(unit.get("hex", ""))] = true
	for base: Dictionary in state.get("airBases", []):
		if str(base.get("side", "")) == "soviet":
			occupied[str(base.get("hex", ""))] = true
	for hex: String in state.get("hedgehogs", {}):
		var hedgehog: Variant = state.hedgehogs[hex]
		if hedgehog is Dictionary and str(hedgehog.get("side", "")) == "soviet":
			occupied[hex] = true
	for piece: Dictionary in state.get("pieces", []):
		if str(piece.get("location", {}).get("kind", "")) == "hex" and str(piece.get("side", "")) == "soviet":
			occupied[str(piece.get("location", {}).get("hex", ""))] = true
	for id: String in state.get("dumps", {}):
		var dump: Dictionary = state.dumps[id]
		var prefix := str(dump.get("side", "")) + ":hex:"
		if str(dump.get("location", "")) == "on-map" and int(dump.get("tokens", 0)) > 0 \
				and str(id).begins_with(prefix) and str(dump.get("side", "")) == "soviet":
			occupied[str(id).substr(prefix.length())] = true
	return occupied


static func _column(hex: String) -> int:
	var parts := _normalize_hex(hex).split(".")
	if parts.size() != 2:
		return 0
	return int(parts[0])


## Axial hex distance (src/import/hex-id.ts `scorpionHexDistance`).
static func _hex_distance(a: String, b: String) -> int:
	var ax := _axial(a)
	var bx := _axial(b)
	var q: int = ax[0] - bx[0]
	var r: int = ax[1] - bx[1]
	return maxi(absi(q), maxi(absi(r), absi(q + r)))


static func _axial(hex: String) -> Array:
	var normalized := _normalize_hex(hex)
	var parts := normalized.substr(1).split(".")
	if parts.size() != 2:
		return [0, 0]
	var col := int(parts[0])
	var row := int(parts[1])
	return [col, row - int(floor(float(col - 1) / 2.0))]


## Normalize a printed hex to `s<col>.<row two digits>`; invalid input returns an empty string.
static func _normalize_hex(source: String) -> String:
	var match := RegEx.create_from_string("^s(\\d+)\\.(\\d{1,2})$")
	var result: Variant = match.search(source)
	if result == null:
		return ""
	return "s%s.%s" % [result.get_string(1), result.get_string(2).pad_zeros(2)]


## src/match/scorpion-ground-activity.ts — the books reset when the player turn or phase moves.
static func _activity(state: Dictionary) -> Dictionary:
	var cursor: Dictionary = state.get("cursor", {})
	var stored: Variant = state.get("groundActivity")
	if stored is Dictionary:
		if int(stored.get("turn", -1)) == int(cursor.get("turn", -1)) \
				and str(stored.get("phasing", "")) == str(cursor.get("phasing", "")) \
				and str(stored.get("phase", "")) == str(cursor.get("phase", "")):
			var kept: Dictionary = stored.duplicate(true)
			kept.spent = kept.get("spent", {}).duplicate()
			kept.airlifted = kept.get("airlifted", []).duplicate()
			return kept
	return {"turn": int(cursor.get("turn", 0)), "phasing": str(cursor.get("phasing", "")),
		"phase": str(cursor.get("phase", "")), "spent": {}, "airlifted": []}


## src/match/scorpion-hex-control.ts — only control sites keep a persistent controller.
static func _record_control(state: Dictionary, actor: String, hex: String, data: Dictionary) -> void:
	var sites: Array = data.get("deployment", {}).get("controlSites", [])
	if not sites.has(hex):
		return
	var control: Dictionary = state.get("railControl", {}).duplicate()
	if str(control.get(hex, "")) == actor:
		return
	control[hex] = actor
	state.railControl = control


## OCS 13.4 — only a supplied Corps/Army HQ of the same side unlocks the exchange, and a Kessel HQ,
## a flipped or Reserve HQ does not count.
static func _hq_present(state: Dictionary, actor: String, hex: String, data: Dictionary) -> bool:
	var definitions: Dictionary = data.view.get("catalog", {}).get("definitions", {})
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if str(unit.get("side")) != actor or str(unit.get("hex", "")) != hex:
			continue
		var hq: Variant = unit.get("headquarters")
		if hq == null or hq.get("kessel") == true:
			continue
		if unit.get("moveMode") == true or unit.get("reserve") != null:
			continue
		var name := str(definitions.get(str(unit.get("definition", "")), {}).get("name", ""))
		if name.begins_with("Ge HQ "):
			return true
	return false
