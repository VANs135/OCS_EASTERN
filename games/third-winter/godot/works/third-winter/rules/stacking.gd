extends RefCounted

const Result := preload("res://scripts/core/result.gd")

const LIMIT := 10


## OCS v4.3 §4.8a — combat RE per hex, printed RE less losses. Non-combat counters stack free.
static func overstacked_hexes(state: Dictionary, side: String) -> Array:
	var hexes := {}
	for unit_id: String in state.units:
		var unit: Dictionary = state.units[unit_id]
		if unit.get("combat") != true or unit.side != side:
			continue
		var re: int = int(unit.printedRe) - int(unit.stepsLost)
		if not hexes.has(unit.hex):
			hexes[unit.hex] = {"hex": unit.hex, "re": 0, "limit": LIMIT}
		hexes[unit.hex].re += re
	var illegal: Array = []
	for hex: String in hexes:
		if hexes[hex].re > LIMIT:
			illegal.append(hexes[hex])
	return illegal


## TTW/OCS checks stacking before a phase closes, matching assertScorpionPhaseStacking.
static func assert_phase_stacking(state: Dictionary, side: String) -> Dictionary:
	var illegal: Array = overstacked_hexes(state, side)
	if illegal.is_empty():
		return Result.success(state)
	var first: Dictionary = illegal[0]
	return Result.failure("stacking_limit", "地面堆叠超过 %s 上限（%d/%d RE）" % [first.hex, first.re, first.limit])
