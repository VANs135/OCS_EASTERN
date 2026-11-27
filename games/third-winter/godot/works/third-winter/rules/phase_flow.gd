extends RefCounted

const Result := preload("res://scripts/core/result.gd")

const PHASES := ["aircraft-refit", "reinforcement", "movement", "supply", "reaction", "combat",
	"exploitation", "cleanup"]


## OCS 2.2 — in the Reaction Segment the non-phasing side acts while `cursor.phasing` stays put
## (packages/series/src/turn.ts `actingSide`).
static func acting_side(cursor: Dictionary) -> String:
	var phasing := str(cursor.get("phasing"))
	if str(cursor.get("phase")) != "reaction":
		return phasing
	return "soviet" if phasing == "axis" else "axis"


## The phase-flow commands of src/match/scorpion-phase-flow.ts that carry no pending combat. Combat
## results, initiative and the cleanup round rollover are not native yet, so they are refused
## instead of guessed.
static func apply(state: Dictionary, actor: String, action: Dictionary) -> Dictionary:
	if state.kind != "playing":
		return Result.failure("match_not_started", "请先开始 08 对局")
	if state.get("victory") != null or str(state.turn.step.kind) == "ended":
		return Result.failure("match_over", "对局已结束")
	if str(state.turn.step.kind) != "player-turn":
		return Result.failure("phase_pending", "该回合步骤不允许结束阶段")
	var phase := str(state.cursor.get("phase"))
	if acting_side(state.cursor) != actor:
		return Result.failure("wrong_actor", "该方不能结束本阶段")
	if str(action.get("type")) != "complete-" + phase:
		return Result.failure("phase_command", "该命令不能结束当前阶段")
	if state.get("combat") != null:
		return Result.failure("phase_pending", "先结算当前战斗再推进阶段")
	if phase == "cleanup":
		return _complete_cleanup(state, actor)
	if not _generic_phase(phase):
		return Result.failure("unsupported_action", "该阶段的结束命令尚未接入原生 08 对局")
	return _complete_phase(state, actor)


## OCS 2.1 — Cleanup clears the acting side's disorganization, exploitation and markers, then hands
## the round to the other side. The round rollover past the second side needs weather, initiative
## and victory, so it is refused instead of guessed.
static func _complete_cleanup(state: Dictionary, actor: String) -> Dictionary:
	var next := _completed_cursor(state.cursor)
	if next.is_empty():
		return Result.failure("round_rollover", "回合换手的天气与主动权尚未接入原生 08 对局")
	var units: Dictionary = state.units.duplicate(true)
	for id: String in units:
		if str(units[id].get("side")) != actor:
			continue
		units[id].disorganized = false
		units[id].exploit = false
		units[id].fueled = false
		units[id].released = false
	state.units = units
	state.cursor = next
	state.moved = []
	state.combatTargets = []
	state.combatAttackers = []
	state.overrunMarch = null
	state.groundCaptureMove = null
	return Result.success(state)


## OCS 5.11 and 9.1 — closing a segment expires the acting side's fuel and release markers and
## starts the movement books of the next segment empty.
static func _complete_phase(state: Dictionary, actor: String) -> Dictionary:
	var next := _completed_cursor(state.cursor)
	if next.is_empty():
		return Result.failure("phase_transition", "无法推进到下一阶段")
	var units: Dictionary = state.units.duplicate(true)
	for id: String in units:
		if str(units[id].get("side")) != actor:
			continue
		units[id].fueled = false
		units[id].released = false
	state.units = units
	state.cursor = next
	state.moved = []
	state.combatTargets = []
	state.combatAttackers = []
	state.overrunMarch = null
	state.groundCaptureMove = null
	return Result.success(state)


static func _generic_phase(phase: String) -> bool:
	return phase == "reaction" or phase == "combat" or phase == "exploitation"


static func _completed_cursor(cursor: Dictionary) -> Dictionary:
	var next := cursor.duplicate(true)
	var index := PHASES.find(str(cursor.get("phase"))) + 1
	if index < PHASES.size():
		next.phase = PHASES[index]
		return next
	if str(cursor.get("phasing")) != str(cursor.get("first")):
		return {}
	next.phasing = "soviet" if str(cursor.phasing) == "axis" else "axis"
	next.phase = PHASES[0]
	return next
