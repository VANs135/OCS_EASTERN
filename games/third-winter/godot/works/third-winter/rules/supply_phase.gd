extends RefCounted

const Result := preload("res://scripts/core/result.gd")
const Stacking := preload("res://works/third-winter/rules/stacking.gd")
const Reinforcement := preload("res://works/third-winter/rules/reinforcement.gd")
const SupplyPosition := preload("res://works/third-winter/rules/supply_position.gd")
const SupplyTrace := preload("res://works/third-winter/rules/supply_trace.gd")
const Attrition := preload("res://scripts/rules/series/attrition.gd")
const Rng := preload("res://scripts/core/rng.gd")
const StepLoss := preload("res://scripts/rules/series/step_loss.gd")
const Round := preload("res://works/third-winter/rules/round.gd")
const SpPayment := preload("res://works/third-winter/rules/sp_payment.gd")


## OCS 12.1 — `complete-movement` closes the Movement Segment and opens the Supply Phase of
## src/match/scorpion-supply-phase.ts: every combat counter's trace routes are collected, formations
## whose members share no source become a player choice, and single-counter fuel expires.
static func complete_movement(state: Dictionary, actor: String, data: Dictionary) -> Dictionary:
	if state.kind != "playing":
		return Result.failure("match_not_started", "请先开始 08 对局")
	if state.get("victory") != null:
		return Result.failure("match_over", "对局已结束")
	if state.get("combat") != null:
		return Result.failure("combat_pending", "先结算本轮战斗")
	if str(state.turn.step.kind) != "player-turn":
		return Result.failure("turn_step", "当前不在玩家回合")
	if str(state.cursor.get("phase")) != "movement":
		return Result.failure("supply_not_due", "当前不在移动阶段")
	if str(state.cursor.get("phasing")) != actor:
		return Result.failure("wrong_actor", "该方不能结束移动")
	if state.get("supply") != null:
		return Result.failure("supply_open", "补给阶段已经开启")
	var stacked := Stacking.assert_phase_stacking(state, actor)
	if not stacked.ok:
		return stacked
	var next := Reinforcement.advance(state.cursor, actor)
	if next.is_empty() or str(next.get("phase")) != "supply":
		return Result.failure("supply_transition", "无法进入补给阶段")
	state.cursor = next
	state.overrunMarch = null
	state.groundCaptureMove = null
	state.supply = open_window(state, actor, data)
	return Result.success(state)


## OCS 12.7 — `check-attrition` fixes every combat counter's supply state and rolls one attrition
## result per out-of-supply hex, in hex order (src/match/scorpion-attrition.ts).
static func check_attrition(state: Dictionary, actor: String, data: Dictionary) -> Dictionary:
	var window: Variant = state.get("supply")
	if state.kind != "playing" or str(state.cursor.get("phase")) != "supply" or str(state.cursor.get("phasing")) != actor \
			or window == null:
		return Result.failure("supply_unavailable", "当前不在本方补给阶段")
	if window.get("attrition") != null or _pending_split(window):
		return Result.failure("supply_allocation", "请先确认各编队的追溯来源")
	var stacks := {}
	var units: Dictionary = state.units.duplicate(true)
	for id: String in units:
		var unit: Dictionary = units[id]
		if unit.get("combat") != true or str(unit.get("side")) != actor:
			continue
		var out: bool = not has_trace(window, id) and not _list(window.get("fed")).has(id)
		unit.outOfSupply = out
		if not out:
			continue
		if not stacks.has(unit.hex):
			stacks[unit.hex] = []
		stacks[unit.hex].append(id)
	state.units = units
	var attrition: Array = []
	if str(state.turn.weather.ground) != "thaw":
		var rng: Dictionary = state.rng
		var order: Array = stacks.keys()
		order.sort()
		for hex: String in order:
			var ids: Array = stacks[hex]
			var first := Rng.roll_die(rng)
			if not first.ok:
				return first
			var second := Rng.roll_die(first.value.rng)
			if not second.ok:
				return second
			rng = second.value.rng
			var dice := [int(first.value.value), int(second.value.value)]
			var size := 0
			var rating := 0
			for id: String in ids:
				size += _remaining_steps(units[id])
				rating = max(rating, int(units[id].get("actionRating", 0)))
			var losses := Attrition.loss(size, rating, dice)
			if losses < 0:
				return Result.failure("attrition_stack", "堆叠无法结算断补损耗")
			attrition.append({"hex": hex, "units": ids, "dice": dice, "losses": losses,
				"assigned": losses == 0})
		state.rng = rng
	var settled: Dictionary = window.duplicate(true)
	settled.attrition = attrition
	state.supply = settled
	return Result.success(state)


## OCS 12.8 — the phase closes only after the trace choices, feeding and attrition are settled.
static func complete_supply(state: Dictionary, actor: String) -> Dictionary:
	if _window_of(state, actor).is_empty():
		return Result.failure("supply_unavailable", "当前不在本方补给阶段")
	var step := decision(state, actor)
	if step.is_empty() or str(step.get("step")) != "complete-supply":
		return Result.failure("supply_pending", "请先结算断补损耗与追溯选择")
	var stacked := Stacking.assert_phase_stacking(state, actor)
	if not stacked.ok:
		return stacked
	var next := Reinforcement.advance(state.cursor, actor)
	if next.is_empty() or str(next.get("phase")) != "reaction":
		return Result.failure("supply_transition", "无法进入反应阶段")
	state.cursor = next
	state.supply = null
	return Result.success(state)


## src/match/scorpion-supply-phase.ts — the next obligation of the supply phase, or the closing
## command. Internal stock recovery is not modelled for 08 yet, so it never obliges.
static func decision(state: Dictionary, actor: String) -> Dictionary:
	var window: Variant = state.get("supply")
	if state.kind != "playing" or str(state.cursor.get("phase")) != "supply" \
			or str(state.cursor.get("phasing")) != actor or window == null:
		return {}
	if state.get("victory") != null or str(state.turn.step.kind) != "player-turn":
		return {}
	if window.get("attrition") == null:
		var pending := _pending_split(window)
		if not pending.is_empty():
			return {"actor": actor, "segment": "supply-check", "step": "choose-formation-trace",
				"formation": pending}
		return {"actor": actor, "segment": "supply-check", "step": "settle-trace-and-feeding"}
	for entry: Dictionary in _list(window.get("attrition")):
		if entry.get("assigned") != true:
			return {"actor": actor, "segment": "supply-check", "step": "assign-attrition",
				"hex": str(entry.get("hex"))}
	return {"actor": actor, "segment": "supply-check", "step": "complete-supply"}


static func has_trace(window: Dictionary, id: String) -> bool:
	if _list(window.get("traceExempt")).has(id):
		return true
	var split: Dictionary = {}
	for entry: Dictionary in _list(window.get("splits")):
		if _list(entry.get("members")).has(id):
			split = entry
			break
	var routes: Dictionary = _list_into_dict(window.get("trace"))
	for option: Dictionary in _list(routes.get(id)):
		if split.is_empty():
			return true
		if split.get("selected") != null and str(split.get("selected", "")) != "" \
				and _anchor(option) == str(split.selected):
			return true
	return false


static func _list_into_dict(value: Variant) -> Dictionary:
	if value is Dictionary:
		return value
	return {}


static func _window_of(state: Dictionary, actor: String) -> Dictionary:
	if state.kind != "playing" or str(state.cursor.get("phase")) != "supply" \
			or str(state.cursor.get("phasing")) != actor:
		return {}
	var window: Variant = state.get("supply")
	if window is Dictionary:
		return window
	return {}


static func _pending_split(window: Dictionary) -> String:
	for split: Dictionary in _list(window.get("splits")):
		if split.get("selected") == null or str(split.get("selected", "")) == "":
			return str(split.get("formation"))
	return ""


## src/match/scorpion-losses.ts floors the surviving RE at 1, so a printed 0-RE counter still
## keeps one step.
static func _remaining_steps(unit: Dictionary) -> int:
	return max(1, int(unit.get("printedRe", 0)) - int(unit.get("stepsLost", 0)))


static func _list(value: Variant) -> Array:
	if value is Array:
		return value
	return []


## src/match/scorpion-supply-phase.ts `selectTraceAnchor` — a split formation picks one source for
## the whole group, and only before any feeding or attrition settles.
static func choose_formation(state: Dictionary, actor: String, action: Dictionary) -> Dictionary:
	var window := _window_of(state, actor)
	if window.is_empty():
		return Result.failure("supply_unavailable", "当前不在本方补给阶段")
	if window.get("attrition") != null or not _list(window.get("fed")).is_empty():
		return Result.failure("supply_allocation", "先结算追溯来源再付补给或查断补")
	var formation := str(action.get("formation", ""))
	var anchor := str(action.get("anchor", ""))
	var splits: Array = []
	var chosen := false
	for split: Dictionary in _list(window.get("splits")):
		if not chosen and str(split.get("formation")) == formation:
			if not _list(split.get("anchors")).has(anchor):
				return Result.failure("supply_trace_choice", "该编队没有这条追溯来源")
			var picked: Dictionary = split.duplicate(true)
			picked.selected = anchor
			splits.append(picked)
			chosen = true
			continue
		splits.append(split.duplicate(true))
	if not chosen:
		return Result.failure("supply_trace_choice", "没有待选追溯的编队")
	var settled: Dictionary = window.duplicate(true)
	settled.splits = splits
	state.supply = settled
	return Result.success(state)


## src/match/scorpion-attrition.ts `assignScorpionAttrition` — one allocation, covering the whole
## attrition result of the chosen stack, then the Axis loss moves the Soviet VP.
static func assign_attrition(state: Dictionary, actor: String, action: Dictionary,
		data: Dictionary) -> Dictionary:
	var window := _window_of(state, actor)
	if window.is_empty():
		return Result.failure("supply_unavailable", "当前不在本方补给阶段")
	if window.get("attrition") == null:
		return Result.failure("supply_allocation", "请先检查断补损耗")
	var hex := str(action.get("hex", "")).to_lower()
	var stack: Dictionary = {}
	for entry: Dictionary in _list(window.get("attrition")):
		if str(entry.get("hex")).to_lower() == hex and entry.get("assigned") != true:
			stack = entry
			break
	if stack.is_empty():
		return Result.failure("attrition_stack", "该格没有待分配的断补损耗")
	var allocation: Variant = action.get("allocation", [])
	if not (allocation is Array) or (allocation as Array).is_empty():
		return Result.failure("attrition_allocation", "请给出完整的步损分配")
	var steps_by_unit := {}
	var total := 0
	for row: Variant in allocation:
		if not (row is Dictionary):
			return Result.failure("attrition_allocation", "步损分配格式错误")
		var unit_id := str(row.get("unitId", ""))
		var steps := int(row.get("steps", 0))
		if steps_by_unit.has(unit_id) or steps < 1:
			return Result.failure("attrition_allocation", "每个单位只能分一次且步数至少为 1")
		steps_by_unit[unit_id] = steps
		total += steps
	if total != int(stack.get("losses", 0)):
		return Result.failure("attrition_allocation", "分配步数须等于该格的损耗 %d" % int(stack.get("losses", 0)))
	for unit_id: String in steps_by_unit:
		var unit: Dictionary = state.units.get(unit_id, {})
		if unit.is_empty() or not _list(stack.get("units")).has(unit_id):
			return Result.failure("attrition_allocation", "只能从该格断补单位里分步损")
		if unit.get("outOfSupply") != true:
			return Result.failure("attrition_allocation", "该单位不在断补状态")
		if int(steps_by_unit[unit_id]) > _remaining_steps(unit):
			return Result.failure("attrition_allocation", "步损超出该单位的存活步数")
	var settled := StepLoss.apply(state, steps_by_unit, data)
	if not settled.ok:
		return settled
	var vp := int(state.arrival.get("sovietVp", 0))
	if str(state.cursor.get("phasing")) == "axis":
		vp += int(stack.get("losses", 0))
	state.arrival.sovietVp = vp
	## scorpionSuddenDeath only records a result when the marker actually ends the game.
	var sudden := Round.sudden_death(int(state.cursor.get("turn", 0)), vp)
	state.victory = null if sudden.is_empty() else sudden
	var assigned: Array = []
	for entry: Dictionary in _list(window.get("attrition")):
		if entry == stack:
			var done: Dictionary = entry.duplicate(true)
			done.assigned = true
			assigned.append(done)
			continue
		assigned.append(entry.duplicate(true))
	var window_copy: Dictionary = window.duplicate(true)
	window_copy.attrition = assigned
	state.supply = window_copy
	return Result.success(state)


## src/match/scorpion-supply-phase.ts `feedScorpionUnits` — concrete supply pays `ceil(RE/2)` tokens
## per dump and must cover the counter's whole surviving RE. Contiguous portions share one payment
## row, so a dump can never be charged twice.
static func feed_units(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var window := _window_of(state, actor)
	if window.is_empty():
		return Result.failure("supply_unavailable", "当前不在本方补给阶段")
	ready_check(window)
	var payments: Variant = action.get("payments", [])
	if not (payments is Array) or (payments as Array).is_empty():
		return Result.failure("supply_payment", "请先分配补给支付")
	var ledger: RefCounted = SpPayment.new(state, actor, data)
	var totals := {}
	var used := {}
	for row: Variant in payments:
		if not (row is Dictionary):
			return Result.failure("supply_payment", "补给支付格式错误")
		var dump_id := str(row.get("dumpId", ""))
		var portions: Variant = row.get("portions", [])
		if used.has(dump_id) or not (portions is Array) or (portions as Array).is_empty():
			return Result.failure("supply_payment", "同一来源的分配给养须合并成一行")
		used[dump_id] = true
		var re_from_dump := 0
		for portion: Variant in portions:
			if not (portion is Dictionary):
				return Result.failure("supply_payment", "补给支付格式错误")
			var unit_id := str(portion.get("unitId", ""))
			var re := int(portion.get("re", 0))
			var unit: Dictionary = state.units.get(unit_id, {})
			if unit.is_empty() or unit.get("combat") != true or str(unit.get("side")) != actor \
					or re <= 0 or _list(window.get("fed")).has(unit_id) or has_trace(window, unit_id) \
					or not ledger.can_use(unit, dump_id):
				return Result.failure("supply_payment", "这枚单位无法从该补给来源领取补给")
			re_from_dump += re
			totals[unit_id] = int(totals.get(unit_id, 0)) + re
		var cost := int(ceil(float(re_from_dump) / 2.0))
		var paid: Dictionary = ledger.spend([{"dumpId": dump_id, "tokens": cost}],
			func(_row: Dictionary) -> bool: return true)
		if not paid.ok:
			return paid
	for unit_id: String in totals:
		var unit: Dictionary = state.units.get(unit_id, {})
		if int(totals[unit_id]) != _remaining_steps(unit):
			return Result.failure("supply_payment", "补给须覆盖该单位当前的全部存活 RE")
	var settled: Dictionary = ledger.settle(state.units)
	state.units = settled.units
	state.dumps = settled.dumps
	var fed: Array = _list(window.get("fed")).duplicate()
	for unit_id: String in totals:
		fed.append(unit_id)
	var window_copy: Dictionary = window.duplicate(true)
	window_copy.fed = fed
	state.supply = window_copy
	return Result.success(state)


## `readyForSupplyAllocation`: nothing may be paid for or checked while a formation trace or the
## attrition result is still open.
static func ready_check(window: Dictionary) -> Dictionary:
	if window.get("attrition") != null:
		return Result.failure("supply_allocation", "先结算追溯来源再付补给或查断补")
	for split: Dictionary in _list(window.get("splits")):
		if split.get("selected") == null:
			return Result.failure("supply_allocation", "先选好编队追溯来源再付补给或查断补")
	return Result.success({})


## The window as the TS module builds it; `traceExempt` only appears when a supply drop covers a
## counter this turn, which the native 08 state does not model yet.
static func open_window(state: Dictionary, actor: String, data: Dictionary) -> Dictionary:
	var position := SupplyPosition.position(state.get("units", {}), state.get("railControl", {}), actor, data)
	var weather := "freeze" if str(state.turn.weather.ground) == "freeze" else "dry"
	var open: RefCounted = SupplyTrace.network(data.view.mapGraph, position, actor, weather)
	var trace := {}
	var members := {}
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if unit.get("combat") != true or str(unit.get("side")) != actor:
			continue
		trace[id] = SupplyTrace.options_of(open, str(unit.hex), str(unit.get("traceDrawMobility", "truck")))
		var formation := str(unit.get("formation", ""))
		if formation.is_empty():
			continue
		if not members.has(formation):
			members[formation] = []
		members[formation].append(id)
	var splits: Array = []
	for formation: String in members:
		var listed: Array = members[formation]
		var per_member := {}
		var anchors := {}
		for id: String in listed:
			var own := {}
			for option: Dictionary in trace.get(id, []):
				own[_anchor(option)] = true
				anchors[_anchor(option)] = true
			per_member[id] = own
		var common := false
		for anchor: String in anchors:
			var shared := true
			for id: String in listed:
				if not per_member[id].has(anchor):
					shared = false
					break
			if shared:
				common = true
				break
		if not anchors.is_empty() and not common:
			splits.append({"formation": formation, "members": listed, "anchors": _sorted(anchors)})
	var cleared: Dictionary = state.get("units", {}).duplicate(true)
	for id: String in cleared:
		if str(cleared[id].get("side")) == actor and cleared[id].get("fueled") == true:
			cleared[id].fueled = false
	state.units = cleared
	return {"trace": trace, "splits": splits, "fed": [], "attrition": null}


## src/match/scorpion-supply-phase.ts — a formation is keyed by the source it draws from, and an HQ
## route is named after the headquarters that throws it.
static func _anchor(option: Dictionary) -> String:
	if str(option.get("kind")) == "direct":
		return "direct:%s" % str(option.get("source"))
	var hq: Variant = option.get("headquarters")
	return "hq:%s" % str(hq if hq != null else option.get("from"))


static func _sorted(keys: Dictionary) -> Array:
	var result: Array = []
	for key: String in keys:
		result.append(key)
	result.sort()
	return result
