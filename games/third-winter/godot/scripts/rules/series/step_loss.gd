extends RefCounted

## OCS 12.7 / TTW 2.4d — applying step losses to combat counters. A counter that lost its last
## step leaves play: remnants go back to the mix, alert battalions return to the pool, and the rest
## lands on the dead pile (src/match/scorpion-losses.ts `takeScorpionSteps`).

const Result := preload("res://scripts/core/result.gd")


static func apply(state: Dictionary, allocation: Dictionary, data: Dictionary) -> Dictionary:
	var units: Dictionary = state.units.duplicate(true)
	var pieces: Array = (state.get("pieces", []) as Array).duplicate(true)
	var alerts: Array = (state.get("availableAlerts", []) as Array).duplicate(true)
	for id: String in allocation:
		var steps := int(allocation[id])
		var unit: Dictionary = units.get(id, {})
		if unit.is_empty() or unit.get("combat") != true or steps < 1 or steps > remaining(unit):
			return Result.failure("step_loss", "只能从在场的战斗力单位扣除存活步数")
		if steps < remaining(unit):
			unit.stepsLost = int(unit.get("stepsLost", 0)) + steps
			units[id] = unit
			continue
		units.erase(id)
		if unit.get("remnantOf") != null:
			continue
		var definition := str(unit.get("definition", ""))
		if _alert_battalion(data, definition):
			alerts.append({"id": id, "definition": definition})
			continue
		pieces.append({"id": id, "kind": "ground", "side": str(unit.get("side", "")),
			"definition": definition, "location": {"kind": "dead-pile"}})
	state.units = units
	state.pieces = pieces
	state.availableAlerts = alerts
	return Result.success(state)


## src/match/scorpion-losses.ts floors the surviving RE at 1.
static func remaining(unit: Dictionary) -> int:
	return max(1, int(unit.get("printedRe", 0)) - int(unit.get("stepsLost", 0)))


static func _alert_battalion(data: Dictionary, definition: String) -> bool:
	var entries: Dictionary = data.view.get("catalog", {}).get("definitions", {})
	var row: Dictionary = entries.get(definition, {})
	for ability: Variant in row.get("abilities", []):
		if str(ability) == "alert_battalion":
			return true
	return false
