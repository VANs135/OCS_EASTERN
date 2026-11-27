extends RefCounted

## OCS 2.1–2.3 and TTW Scenario Book p.53 — the round rollover past the second side's cleanup:
## weather, sudden death, dated VP penalty, initiative retention, and the next turn's cursor.
## Mirrors src/match/scorpion-round.ts, src/ttw/scorpion/{weather,pre-turn,victory,initiative,initiative-step}.ts.

const Result := preload("res://scripts/core/result.gd")
const Rng := preload("res://scripts/core/rng.gd")
const PhaseFlow := preload("res://works/third-winter/rules/phase_flow.gd")

const FREEZE_CEILINGS := [6, 6, 5, 4, 3, 2, 1, 0]
const DNE_PR_HEX := "s22.08"


## Called once both sides finished Cleanup. Weather is rolled only here.
static func complete_cleanup(state: Dictionary, actor: String, data: Dictionary) -> Dictionary:
	var phase := str(state.cursor.get("phase"))
	if phase != "cleanup" or PhaseFlow.acting_side(state.cursor) != actor:
		return Result.failure("wrong_actor", "该方不能结束本回合")
	if state.get("combat") != null:
		return Result.failure("phase_pending", "先结算当前战斗再推进回合")
	var current: Dictionary = state.turn
	if str(current.step.get("kind")) != "player-turn":
		return Result.failure("round_rollover", "本回合还在应答主动权")
	var vp := _live_vp(state)
	var dates: Array = data.view.get("dates", [])
	if int(current.number) == dates.size():
		return _close_game(state, actor, current, vp)
	var number := int(current.number) + 1
	var weather := _weather(number, current.get("thawSeen") == true, state)
	if not weather.ok:
		return weather
	state.rng = weather.value.rng
	var opened := _open_turn(number, weather.value.weather, vp,
		str(current.step.get("retention", "closed")), _axis_dnepr_steps(state, data), str(state.get("rerollHolder", "")))
	if opened.is_empty():
		return Result.failure("turn_rollover", "无法开启回合 %d" % number)
	state.turn = opened
	state.arrival.sovietVp = opened.vp
	var units: Dictionary = state.units.duplicate(true)
	for id: String in units:
		if str(units[id].get("side")) != actor:
			continue
		units[id].disorganized = false
		units[id].exploit = false
		units[id].fueled = false
		units[id].released = false
	state.units = units
	state.moved = []
	state.combatTargets = []
	state.combatAttackers = []
	state.overrunMarch = null
	state.groundCaptureMove = null
	if str(state.turn.step.get("kind")) == "ended":
		state.victory = state.turn.step.get("result")
	return Result.success(state)


## src/ttw/scorpion/initiative-step.ts — the initiative questions of the newly opened turn.
static func answer(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	if state.kind != "playing":
		return Result.failure("match_not_started", "请先开始 08 对局")
	if state.get("victory") != null or str(state.turn.step.get("kind")) == "ended":
		return Result.failure("match_over", "对局已结束")
	match str(action.get("type")):
		"retain-initiative":
			return _retain(state, actor, action)
		"roll-initiative":
			return _roll(state, actor)
		"choose-first":
			return _choose(state, actor, action, data)
	return Result.failure("unsupported_action", "未知的主动权命令")


static func _retain(state: Dictionary, actor: String, action: Dictionary) -> Dictionary:
	var step: Dictionary = state.turn.step
	if str(step.get("kind")) != "retention" or str(step.get("responder")) != actor:
		return Result.failure("initiative_step", "该方现在不能回答主动权问题")
	if not _may_retain(int(state.turn.number), str(step.get("retention")), actor):
		return Result.failure("initiative_retention", "本回合无法保留主动权")
	var dump_id := str(action.get("dumpId", ""))
	var dump: Dictionary = state.dumps.get(dump_id, {})
	if dump.is_empty() or str(dump.get("side")) != actor or str(dump.get("location")) != "on-map" \
			or int(dump.get("tokens", 0)) < 4:
		return Result.failure("initiative_supply", "保留主动权需要本方盘上补给堆的 1 SP")
	state.dumps[dump_id] = {"side": dump.side, "tokens": int(dump.tokens) - 4, "location": "on-map"}
	var next: Dictionary = state.turn.duplicate(true)
	next.step = {"kind": "choose-order", "responder": actor, "retention": step.get("retention")}
	state.turn = next
	return Result.success(state)


static func _roll(state: Dictionary, actor: String) -> Dictionary:
	var step: Dictionary = state.turn.step
	# src/match/scorpion-phase-flow.ts lets the retention responder skip paying by rolling.
	if str(step.get("kind")) == "retention":
		if str(step.get("responder")) != actor:
			return Result.failure("initiative_step", "该方现在不能回答主动权问题")
		var asked: Dictionary = state.turn.duplicate(true)
		asked.step = {"kind": "roll", "retention": step.get("retention")}
		state.turn = asked
		step = asked.step
	if str(step.get("kind")) != "roll":
		return Result.failure("initiative_step", "现在不掷主动权")
	var rng: Dictionary = state.rng
	var axis := 0
	var soviet := 0
	for side in ["axis", "soviet"]:
		var total := 0
		for index in 2:
			var draw := Rng.roll_die(rng)
			if not draw.ok:
				return draw
			rng = draw.value.rng
			total += int(draw.value.value)
		if side == "axis":
			axis = total
		else:
			soviet = total
	state.rng = rng
	if axis == soviet:
		return Result.success(state)
	var winner := "axis" if axis > soviet else "soviet"
	var next: Dictionary = state.turn.duplicate(true)
	next.step = {"kind": "choose-order", "responder": winner,
		"retention": _retention_after(str(step.get("retention")), winner)}
	state.turn = next
	return Result.success(state)


static func _choose(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var step: Dictionary = state.turn.step
	if str(step.get("kind")) != "choose-order" or str(step.get("responder")) != actor:
		return Result.failure("initiative_step", "该方现在不能指定先手")
	var first := str(action.get("first", ""))
	if first != "axis" and first != "soviet":
		return Result.failure("initiative_first", "先手只能是轴心或苏军")
	var next: Dictionary = state.turn.duplicate(true)
	next.step = {"kind": "player-turn", "first": first, "retention": step.get("retention")}
	state.turn = next
	state.cursor = {"turn": int(next.number), "first": first, "phasing": first, "phase": "aircraft-refit",
		"retention": step.get("retention")}
	return Result.success(state)


## Scenario Book p.53 — the retention policy only changes on an Axis initiative win.
static func _retention_after(current: String, winner: String) -> String:
	if current == "axis":
		return "closed"
	if current == "soviet" and winner == "axis":
		return "axis"
	return current


## Turn 1 is prescribed; later rounds need 1 SP from the acting side's on-map dumps.
static func _may_retain(turn: int, retention: String, side: String) -> bool:
	return turn > 1 and retention == side


static func _weather(turn: int, thaw_seen: bool, state: Dictionary) -> Dictionary:
	if turn < 1 or turn > FREEZE_CEILINGS.size():
		return Result.failure("weather_turn", "回合号超出天气表")
	if turn == 1:
		return Result.success({"rng": state.rng,
			"weather": {"ground": "freeze", "flight": "limited", "thawSeen": false, "endGame": false}})
	var ceiling := int(FREEZE_CEILINGS[turn - 1])
	var rng: Dictionary = state.rng
	var freeze := thaw_seen or ceiling == 6
	if not freeze and ceiling > 0:
		var draw := Rng.roll_die(rng)
		if not draw.ok:
			return draw
		rng = draw.value.rng
		freeze = int(draw.value.value) <= ceiling
	if not freeze:
		return Result.success({"rng": rng,
			"weather": {"ground": "thaw", "flight": "none", "thawSeen": true, "endGame": turn == 8}})
	var total := 0
	for index in 2:
		var draw := Rng.roll_die(rng)
		if not draw.ok:
			return draw
		rng = draw.value.rng
		total += int(draw.value.value)
	var flight := "none" if total <= 5 else ("limited" if total <= 9 else "normal")
	return Result.success({"rng": rng,
		"weather": {"ground": "freeze", "flight": flight, "thawSeen": thaw_seen, "endGame": false}})


## src/ttw/scorpion/pre-turn.ts `openScorpionTurn` — sudden death, the dated penalty and the
## retention question that the new turn opens with.
static func _open_turn(number: int, weather: Dictionary, vp: int, retention: String,
		axis_steps: int, reroll_holder: String) -> Dictionary:
	var base := {"number": number, "weather": {"ground": weather.ground, "flight": weather.flight},
		"thawSeen": weather.thawSeen == true, "vp": vp}
	var sudden := _sudden_death(number, vp)
	if not sudden.is_empty():
		base.vp = _final_points(vp, reroll_holder)
		base.step = {"kind": "ended", "result": sudden}
		return base
	if weather.endGame == true:
		var closed := base.duplicate(true)
		closed.vp = _final_points(vp, reroll_holder)
		closed.step = {"kind": "ended", "result": _final_victory(vp, reroll_holder)}
		return closed
	var penalty: int = min(axis_steps, 4) if number >= 3 and str(weather.ground) != "thaw" else 0
	var adjusted: int = vp - penalty
	base.vp = adjusted
	var result := _sudden_death(number, adjusted)
	if not result.is_empty():
		base.vp = _final_points(adjusted, reroll_holder)
		base.step = {"kind": "ended", "result": result}
		return base
	base.step = {"kind": "roll", "retention": retention} if retention == "closed" \
		else {"kind": "retention", "responder": retention, "retention": retention}
	return base


static func _close_game(state: Dictionary, actor: String, current: Dictionary, vp: int) -> Dictionary:
	var holder := str(state.get("rerollHolder", ""))
	var closed := current.duplicate(true)
	closed.vp = _final_points(vp, holder)
	closed.step = {"kind": "ended", "result": _final_victory(vp, holder)}
	state.turn = closed
	state.arrival.sovietVp = closed.vp
	state.victory = closed.step.result
	var units: Dictionary = state.units.duplicate(true)
	for id: String in units:
		if str(units[id].get("side")) != actor:
			continue
		units[id].disorganized = false
		units[id].exploit = false
		units[id].fueled = false
		units[id].released = false
	state.units = units
	state.moved = []
	state.combatTargets = []
	state.combatAttackers = []
	state.overrunMarch = null
	state.groundCaptureMove = null
	return Result.success(state)


static func _live_vp(state: Dictionary) -> int:
	return int(state.arrival.get("sovietVp", 0))


## Scenario Book p.53 — the Dnepr reach is the calibrated major-river edge set plus the map-edge hex.
static func _axis_dnepr_steps(state: Dictionary, data: Dictionary) -> int:
	var graph: Dictionary = data.view.get("mapGraph", {})
	var neighbors: Dictionary = graph.get("neighbors", {})
	var edges: Dictionary = graph.get("edges", {})
	var total := 0
	for id: String in state.units:
		var unit: Dictionary = state.units[id]
		if str(unit.get("side")) != "axis" or unit.get("combat") != true:
			continue
		var hex := str(unit.get("hex", ""))
		if not _on_dnepr(hex, neighbors, edges):
			continue
		total += max(1, int(unit.get("printedRe", 0)) - int(unit.get("stepsLost", 0)))
	return total


static func _on_dnepr(hex: String, neighbors: Dictionary, edges: Dictionary) -> bool:
	if hex == DNE_PR_HEX:
		return true
	for near: Variant in neighbors.get(hex, []):
		var edge: Dictionary = edges.get(_edge_key(hex, str(near)), {})
		if str(edge.get("river", "")) == "major":
			return true
	return false


static func _edge_key(left: String, right: String) -> String:
	return left + "|" + right if left < right else right + "|" + left


static func _sudden_death(turn: int, vp: int) -> Dictionary:
	if turn < 3:
		return {}
	if vp < -4:
		return {"outcome": "axis", "level": "major"}
	if vp > 19:
		return {"outcome": "soviet", "level": "major"}
	return {}


## src/ttw/scorpion/victory.ts — the reroll counter pays out only when the game closes.
static func _final_points(vp: int, reroll_holder: String) -> int:
	if reroll_holder == "soviet":
		return vp + 1
	if reroll_holder == "axis":
		return vp - 1
	return vp


static func _final_victory(vp: int, reroll_holder: String) -> Dictionary:
	var final := _final_points(vp, reroll_holder)
	if final <= 0:
		return {"outcome": "axis", "level": "major"}
	if final <= 4:
		return {"outcome": "axis", "level": "minor"}
	if final <= 10:
		return {"outcome": "draw"}
	return {"outcome": "soviet", "level": "minor" if final <= 14 else "major"}
