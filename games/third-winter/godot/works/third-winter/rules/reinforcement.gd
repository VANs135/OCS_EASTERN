extends RefCounted

const Result := preload("res://scripts/core/result.gd")

## OCS v4.3 §2.2 — the player-turn phase order.
const PHASES := ["aircraft-refit", "reinforcement", "movement", "supply",
	"reaction", "combat", "exploitation", "cleanup"]


## TTW S08 p.55 and the Scenario Book — fixed deliveries, separate from the variable supply roll.
## `complete-refit` closes the Aircraft Refit Phase and opens the reinforcement window with the
## printed delivery for this side and turn (src/match/scorpion-reinforcement-state.ts).
static func enter(state: Dictionary, actor: String, data: Dictionary) -> Dictionary:
	var cursor: Dictionary = state.cursor
	if cursor.phase != "aircraft-refit" or state.get("window") != null or state.get("victory") != null:
		return Result.failure("reinforcement_window", "当前阶段不能开启增援")
	var next := advance(cursor, actor)
	if next.is_empty() or next.phase != "reinforcement":
		return Result.failure("reinforcement_transition", "无法进入增援阶段")
	var fixed := _fixed_supply(data, actor, next.turn)
	state.cursor = next
	state.window = {
		"dice": null, "variableTokens": 0, "fixedTokens": int(fixed.get("sp", 0)) * 4,
		"fixedDestinations": fixed.get("destinations", []).duplicate(), "pendingAlert": null,
		"stage": "scheduled",
	}
	return Result.success(state)


## Mirrors packages/series/turn.ts advancePlayerTurn; null at the end of the second side's turn.
static func advance(cursor: Dictionary, actor: String) -> Dictionary:
	var side: String = str(cursor.phasing)
	if cursor.phase == "reaction" and side == "axis":
		side = "soviet"
	elif cursor.phase == "reaction":
		side = "axis"
	if side != actor:
		return {}
	var index: int = PHASES.find(str(cursor.phase)) + 1
	if index < PHASES.size():
		return {"turn": cursor.turn, "first": cursor.first, "phasing": cursor.phasing,
			"phase": PHASES[index], "retention": cursor.retention}
	if cursor.phasing != cursor.first:
		return {}
	return {"turn": cursor.turn, "first": cursor.first,
		"phasing": "soviet" if cursor.phasing == "axis" else "axis",
		"phase": PHASES[0], "retention": cursor.retention}


static func _fixed_supply(data: Dictionary, side: String, turn: int) -> Dictionary:
	for row: Dictionary in data.view.get("fixedSupply", []):
		if row.side == side and int(row.turn) == turn:
			return row
	return {}
