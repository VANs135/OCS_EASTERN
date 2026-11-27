extends RefCounted

## src/match/scorpion-remnants.ts `rebuildScorpionRemnant` — TTW 2.4d and 1.7a: exchange a remnant
## battalion plus one Axis Pax for its parent division at one step. The parent must sit on the dead
## pile, the remnant must stand with a supplied Corps/Army HQ outside enemy ZOC, and the rebuilt
## counter enters one step down.

const SupplyPosition := preload("res://works/third-winter/rules/supply_position.gd")
const SupplyTrace := preload("res://works/third-winter/rules/supply_trace.gd")
const Result := preload("res://scripts/core/result.gd")


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
	rebuilt.moveMode = face == "move"
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
