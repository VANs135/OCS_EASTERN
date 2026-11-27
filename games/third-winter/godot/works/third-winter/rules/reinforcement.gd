extends RefCounted

const Board := preload("res://works/third-winter/rules/reinforcement_board.gd")
const Result := preload("res://scripts/core/result.gd")
const Rng := preload("res://scripts/core/rng.gd")

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


## OCS 13.6 and TTW 1.7a/2.4b — the reinforcement phase commands of src/match/scorpion-reinforcement.ts:
## scheduled arrivals, fixed and variable supply delivery, and the closing transition.
static func apply(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	if state.get("victory") != null:
		return Result.failure("match_over", "对局已结束")
	if str(state.cursor.get("phasing")) != actor:
		return Result.failure("wrong_actor", "该方不能执行增援动作")
	if str(state.cursor.get("phase")) != "reinforcement" or state.get("window") == null:
		return Result.failure("reinforcement_closed", "当前不在增援阶段")
	match str(action.get("type")):
		"place-arrival":
			return _place_arrival(state, actor, action, data)
		"place-supply":
			return _place_supply(state, actor, action, data)
		"finish-scheduled-arrivals":
			return _finish_scheduled(state, actor, data)
		"place-alert":
			return _place_alert(state, actor, action, data)
		"pass-alert":
			return _pass_alert(state, actor)
		"complete-reinforcement":
			return _complete(state, actor)
	return Result.failure("unsupported_action", "该增援动作尚未接入原生 08 对局")


## OCS 13.6: a scheduled arrival is placed in its own phase and cannot be delayed. Only `placed`
## settles the obligation; entry-hex availability never removes one from the outstanding set.
static func scheduled(state: Dictionary, actor: String, data: Dictionary) -> Dictionary:
	var turn := int(state.cursor.turn)
	var arrival_state: Dictionary = state.get("arrival", {})
	var placed := _list(arrival_state.get("placed"))
	var forfeited := _list(arrival_state.get("forfeited"))
	var outstanding: Array = []
	var placeable: Array = []
	var blocked: Array = []
	for entry: Dictionary in data.view.get("arrivals", []):
		if str(entry.get("side")) != actor or int(entry.get("turn", 0)) != turn:
			continue
		if entry.get("optionalForce") != null or placed.has(entry.get("id")) or forfeited.has(entry.get("id")):
			continue
		outstanding.append(entry)
		if Board.arrival_destinations(data.view.mapGraph, data, state, entry).is_empty():
			blocked.append(entry)
		else:
			placeable.append(entry)
	return {"outstanding": outstanding, "placeable": placeable, "blocked": blocked}


static func _place_arrival(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var window: Dictionary = state.window
	if str(window.get("stage")) != "scheduled":
		return Result.failure("arrivals_closed", "按日程抵达已关闭")
	var entry := {}
	var wanted := str(action.get("arrivalId", ""))
	for item: Dictionary in data.view.get("arrivals", []):
		if str(item.get("id")) == wanted:
			entry = item
			break
	if entry.is_empty():
		return Result.failure("unknown_arrival", "未知的增援条目")
	var arrival_state: Dictionary = state.get("arrival", {})
	if str(entry.side) != actor or _list(arrival_state.get("placed")).has(entry.id):
		return Result.failure("arrival_unavailable", "该增援不属于本方或已经抵达")
	if _list(arrival_state.get("forfeited")).has(entry.id):
		return Result.failure("arrival_forfeited", "该增援在本阶段已弃置")
	var turn := int(state.cursor.turn)
	var force := "" if entry.get("optionalForce") == null else str(entry.optionalForce)
	var on_time := turn >= int(entry.turn) if force != "" else turn == int(entry.turn)
	if not on_time or (force != "" and _force_owner(force) != actor):
		return Result.failure("arrival_turn", "该增援不在本回合可用")
	var legal: Array = Board.arrival_destinations(data.view.mapGraph, data, state, entry)
	var hex := str(action.get("hex", ""))
	if not legal.has(hex):
		return Result.failure("arrival_destination", "该落点不是合法的进入格")
	var template: Dictionary = data.view.get("catalog", {}).get("counters", {}).get(entry.get("definition"), {})
	if template.is_empty():
		return Result.failure("arrival_counter", "缺少该增援的算子资料")
	# src/match/scorpion-session.ts rejects an arrival whose counter is foreign or already on the map.
	if str(template.get("side")) != actor or state.get("units", {}).has(entry.id):
		return Result.failure("arrival_counter", "该增援的算子资料与盘面冲突")
	var unit: Dictionary = template.duplicate(true)
	unit.hex = hex
	unit.stepsLost = int(entry.get("stepsLost", 0))
	if entry.get("organicTruck") != null:
		unit.organicTruck = str(entry.organicTruck)
	var next_arrival: Dictionary = arrival_state.duplicate(true)
	next_arrival.placed = _list(arrival_state.get("placed")).duplicate()
	next_arrival.placed.append(entry.id)
	var vp := int(arrival_state.get("sovietVp", 0))
	if force != "" and not _list(arrival_state.get("mobilized")).has(force):
		var mobilized := _list(arrival_state.get("mobilized")).duplicate()
		mobilized.append(force)
		next_arrival.mobilized = mobilized
		vp += 5 if actor == "axis" else -5
	next_arrival.sovietVp = vp
	var on_map := _list(state.get("arrivalsOnMap")).duplicate()
	on_map.append({"arrival": entry.duplicate(true), "hex": hex, "turn": turn})
	state.arrival = next_arrival
	state.arrivalsOnMap = on_map
	state.units[entry.id] = unit
	state.victory = _sudden_death(turn, vp)
	_record_control(state, actor, hex, data)
	return Result.success(state)


## OCS 2.3 — supply awards land as ordinary dumps in the same transaction as the debit.
static func _place_supply(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var window: Dictionary = state.window
	var fixed := str(window.get("stage")) == "scheduled"
	var target: Dictionary = action.get("target", {})
	var kind := str(target.get("kind", ""))
	var hex := str(target.get("id", ""))
	if fixed and (kind != "hex" or not window.get("fixedDestinations", []).has(hex)):
		return Result.failure("fixed_destination", "请选择印刷的固定补给落点")
	var left := int(window.get("fixedTokens" if fixed else "variableTokens", 0))
	var tokens := int(action.get("tokens", 0))
	if tokens <= 0 or tokens > left:
		return Result.failure("supply_tokens", "补给点数超出本轮可用配额")
	var legal := kind == "air-box"
	if kind == "hex":
		var enemy := "soviet" if actor == "axis" else "axis"
		var candidates: Array = window.get("fixedDestinations", []) if fixed \
			else data.view.get("supplySources", {}).get(actor, [])
		legal = candidates.has(hex) and control_of(state, hex, data) != enemy
	if not legal:
		return Result.failure("supply_destination", "补给只能放在补给源或本方地图外的机场盒")
	var id := "%s:air-box" % actor if kind == "air-box" else "%s:hex:%s" % [actor, hex]
	var dump: Dictionary = state.dumps.get(id, {})
	state.dumps[id] = {"side": actor, "location": "off-map" if kind == "air-box" else "on-map",
		"tokens": int(dump.get("tokens", 0)) + tokens}
	if fixed:
		window.fixedTokens = left - tokens
	else:
		window.variableTokens = left - tokens
	return Result.success(state)


## TTW 1.7a — the Alert counter arrives at one of the printed HQ hexes, or the draw is passed up.
## src/match/scorpion-reinforcement.ts settles `pendingAlert` first, then lands the counter like any
## other arrival: one deployed counter in the chosen hex, and ground control recorded for it.
static func _place_alert(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var window: Dictionary = state.window
	var counter: Variant = window.get("pendingAlert")
	if counter == null:
		return Result.failure("alert_pending", "本轮没有待放置的警戒营")
	var hex := str(action.get("hex", ""))
	var legal := Board.alert_destinations(data.view.mapGraph, data, state, counter, actor,
		str(state.turn.weather.ground))
	if not legal.has(hex):
		return Result.failure("alert_destination", "警戒营只能落在印刷的 HQ 落点")
	var template: Dictionary = data.view.get("catalog", {}).get("counters", {}).get(counter.get("definition"), {})
	if template.is_empty() or str(template.get("side")) != actor or state.get("units", {}).has(counter.id):
		return Result.failure("alert_counter", "该警戒营的算子资料与盘面冲突")
	var unit: Dictionary = template.duplicate(true)
	unit.hex = hex
	unit.stepsLost = 0
	unit.erase("organicTruck")
	var pool: Array = []
	for entry: Dictionary in _list(state.get("availableAlerts")):
		if str(entry.get("id")) != str(counter.id):
			pool.append(entry)
	var placed: Array = _list(state.get("placedAlerts")).duplicate(true)
	placed.append({"counter": counter.duplicate(true), "hex": hex})
	window.pendingAlert = null
	state.availableAlerts = pool
	state.placedAlerts = placed
	state.units[str(counter.id)] = unit
	_record_control(state, actor, hex, data)
	return Result.success(state)


static func _pass_alert(state: Dictionary, actor: String) -> Dictionary:
	var window: Dictionary = state.window
	if window.get("pendingAlert") == null:
		return Result.failure("alert_pending", "本轮没有待放置的警戒营")
	window.pendingAlert = null
	return Result.success(state)


## OCS 13.6 forbids delaying a reinforcement, and 13.6b substitutes only for blocked map-edge hexes.
## An arrival whose printed hexes are all enemy-held therefore never arrives, so the outcome is
## recorded before the variable award rolls.
static func _finish_scheduled(state: Dictionary, actor: String, data: Dictionary) -> Dictionary:
	var status := scheduled(state, actor, data)
	if not status.placeable.is_empty():
		return Result.failure("arrivals_pending", "请先安置可以落地的日程抵达")
	var window: Dictionary = state.window
	if str(window.get("stage")) != "scheduled":
		return Result.failure("reinforcement_stage", "可变补给已经结算")
	if int(window.get("fixedTokens", 0)) != 0:
		return Result.failure("fixed_supply_pending", "请先交付固定补给")
	if not status.blocked.is_empty():
		var arrival_state: Dictionary = state.arrival.duplicate(true)
		var forfeited := _list(arrival_state.get("forfeited")).duplicate()
		for entry: Dictionary in status.blocked:
			if _list(arrival_state.get("placed")).has(entry.id):
				return Result.failure("arrival_conflict", "该增援已经在盘面上")
			if not forfeited.has(entry.id):
				forfeited.append(entry.id)
		arrival_state.forfeited = forfeited
		state.arrival = arrival_state
	return _award_variable(state, actor)


## TTW S08 p.53 — the printed variable table. The first turn awards nothing and draws no dice.
static func _award_variable(state: Dictionary, actor: String) -> Dictionary:
	var window: Dictionary = state.window
	var turn := int(state.cursor.turn)
	if turn < 1 or turn > 8:
		return Result.failure("turn_range", "回合超出 1 至 8")
	var sp := 0
	var pax := 0
	var alert := 0
	var dice: Variant = null
	if turn != 1:
		var draw := Rng.roll_dice(state.rng, 2)
		if not draw.ok:
			return draw
		state.rng = draw.value.rng
		var faces: Array = draw.value.value.faces
		dice = faces.duplicate()
		var total := int(faces[0]) + int(faces[1])
		if actor == "axis":
			sp = 4 if total <= 3 else (5 if total <= 10 else 6)
			pax = 1
			alert = 1
		else:
			sp = 5 if total <= 5 else (6 if total <= 7 else 7)
	var pending: Variant = null
	var pool := _list(state.get("availableAlerts"))
	if alert > 0 and not pool.is_empty():
		var pick := Rng.pick_index(state.rng, pool.size())
		if not pick.ok:
			return pick
		state.rng = pick.value.rng
		pending = pool[int(pick.value.value)]
	state.pax[actor] = int(state.pax.get(actor, 0)) + pax
	state.window = {"dice": dice, "variableTokens": sp * 4, "fixedTokens": int(window.get("fixedTokens", 0)),
		"fixedDestinations": _list(window.get("fixedDestinations")).duplicate(), "pendingAlert": pending,
		"stage": "variable"}
	return Result.success(state)


static func _complete(state: Dictionary, actor: String) -> Dictionary:
	var window: Dictionary = state.window
	if str(window.get("stage")) != "variable" or int(window.get("variableTokens", 0)) != 0 \
			or window.get("pendingAlert") != null:
		return Result.failure("variable_pending", "请先完成可变增援")
	var next := advance(state.cursor, actor)
	if next.is_empty() or str(next.get("phase")) != "movement":
		return Result.failure("reinforcement_transition", "无法进入移动阶段")
	state.cursor = next
	state.window = null
	return Result.success(state)


## packages/series — HQ Alert placement follows TTW 1.7a; only the printed Alerts carry a location rule.
static func control_of(state: Dictionary, hex: String, data: Dictionary) -> Variant:
	var sites: Array = data.get("deployment", {}).get("controlSites", [])
	if not sites.has(hex):
		return null
	var control: Dictionary = state.get("railControl", {})
	if control.has(hex):
		return control[hex]
	var occupied: Variant = null
	for unit: Dictionary in state.get("units", {}).values():
		if unit.get("combat") == true and str(unit.get("hex")) == hex:
			occupied = unit.side
	if occupied != null:
		return occupied
	return data.get("deployment", {}).get("frontControl", {}).get(hex)


## src/match/scorpion-hex-control.ts — only hexes with a control rule keep a controller.
static func _record_control(state: Dictionary, actor: String, entered: String, data: Dictionary) -> void:
	var sites: Array = data.get("deployment", {}).get("controlSites", [])
	if not sites.has(entered):
		return
	var control: Dictionary = state.get("railControl", {})
	if control.get(entered) == actor:
		return
	control[entered] = actor
	state.railControl = control


## TypeScript reads optional arrays as `?? []`; a stored null must read as empty, not crash.
static func _list(value: Variant) -> Array:
	if value is Array:
		return value
	return []


static func _sudden_death(turn: int, vp: int) -> Variant:
	if turn < 3:
		return null
	if vp < -4:
		return {"outcome": "axis", "level": "major"}
	if vp > 19:
		return {"outcome": "soviet", "level": "major"}
	return null


static func _force_owner(force: String) -> String:
	match force:
		"axis-24-panzer":
			return "axis"
		"soviet-5-guards-cavalry":
			return "soviet"
	return ""


## Mirrors packages/series/turn.ts advancePlayerTurn; null at the end of the second side's turn.
## Keeps every other cursor field (retention, turn, simulcast) like the TypeScript spread.
static func advance(cursor: Dictionary, actor: String) -> Dictionary:
	var side: String = str(cursor.phasing)
	if cursor.phase == "reaction":
		side = "soviet" if side == "axis" else "axis"
	if side != actor:
		return {}
	var next := cursor.duplicate(true)
	var index: int = PHASES.find(str(cursor.phase)) + 1
	if index < PHASES.size():
		next.phase = PHASES[index]
		return next
	if cursor.phasing != cursor.first:
		return {}
	next.phasing = "soviet" if cursor.phasing == "axis" else "axis"
	next.phase = PHASES[0]
	return next


static func _fixed_supply(data: Dictionary, side: String, turn: int) -> Dictionary:
	for row: Dictionary in data.view.get("fixedSupply", []):
		if row.side == side and int(row.turn) == turn:
			return row
	return {}
