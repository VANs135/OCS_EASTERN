extends RefCounted

## OCS v4.3 §9.12 / §13.2g(E) 守方撤退（src/match/scorpion-retreat.ts）。
## 规则层：撤退路径可选格、可否撤退、逐堆逐格撤退结算、待决续跑状态形状。
## 判定与数值只对照 TS 语义，不做推演。
##
## 已知缺口（以 Result.failure + 待决描述返回，不伪造结果）：
## - 残部落点选择（DG 单位被迫损一步后生成残部的候选格）；
## - 进格夺取的飞机/Extender/运输队分配（窗口本身已按 capture.gd 掷骰挂起）；
## - Kessel 司令部离场返还。

const Result := preload("res://scripts/core/result.gd")
const SupplyPosition := preload("res://works/third-winter/rules/supply_position.gd")
const TerrainCost := preload("res://works/third-winter/rules/terrain_cost.gd")
const Stacking := preload("res://works/third-winter/rules/stacking.gd")
const CombatLosses := preload("res://works/third-winter/rules/combat_losses.gd")
const ReinforcementBoard := preload("res://works/third-winter/rules/reinforcement_board.gd")
const Capture := preload("res://works/third-winter/rules/capture.gd")
const GroundModeActions := preload("res://works/third-winter/rules/ground_mode_actions.gd")
const Breakdown := preload("res://works/third-winter/rules/breakdown.gd")

## 每条路线选择窗口最多铺开的合法终点数。
const ROUTE_OPTION_LIMIT := 24


## 完整撤退路线候选：从原点走满 distance 格的所有合法路径（不含 ZOC/残部选择）。
## 仅返回路径数组；玩家仍须选路线，规则层不代选。
static func route_options(state: Dictionary, side: String, units: Array, distance: int,
		combat: Dictionary, data: Dictionary) -> Array:
	if distance <= 0 or units.is_empty():
		return []
	var origin := str(state.get("units", {}).get(str(units[0]), {}).get("hex", ""))
	if origin == "":
		return []
	var options: Array = []
	_walk_routes(state, side, origin, units, distance, combat, data, [], options)
	return options


static func _walk_routes(state: Dictionary, side: String, origin: String, units: Array,
		distance: int, combat: Dictionary, data: Dictionary, path: Array, options: Array) -> void:
	if options.size() >= ROUTE_OPTION_LIMIT:
		return
	if path.size() == distance:
		options.append(path.duplicate())
		return
	var route := {"origin": origin, "units": units, "path": path}
	for hex_id: String in path_options(state, side, route, combat, data):
		path.append(hex_id)
		_walk_routes(state, side, origin, units, distance, combat, data, path, options)
		path.pop_back()
		if options.size() >= ROUTE_OPTION_LIMIT:
			return


## scorpionRetreatPathOptions：当前路径末端相邻、未被战斗开始时敌方占用、非敌方补给源且
## 撤退堆全体可通过的可选格。route: { units, path, ... }。
static func path_options(state: Dictionary, side: String, route: Dictionary, combat: Dictionary,
		data: Dictionary) -> Array:
	var origin := str(route.get("origin", ""))
	var path: Array = route.get("path", [])
	var units: Array = route.get("units", [])
	var counters: Array = []
	for id: String in units:
		var mode := _retreat_mode_result(state.get("units", {}).get(id, {}), side, origin, data)
		if not mode.ok:
			return []
		counters.append(mode.value)
	var options: Array = []
	for hex_id: String in _retreat_neighbors(origin, path, side, combat, data):
		if _passable(state, side, path[-1] if path.size() > 0 else origin, hex_id, counters, data):
			options.append(hex_id)
	return options


## canScorpionRetreat：单位能否以撤退资格离场（战斗面/移动面资格校验通过即真）。
static func can_retreat(unit: Dictionary, side: String, origin: String, data: Dictionary) -> bool:
	return _retreat_mode_result(unit, side, origin, data).ok


## retreatScorpionCombat：开局撤退分配。involved 为本窗口参战存活名单；plans 为每堆 RetreatPlan。
## 返回 Result.success({ state, pending })；pending 为 ScorpionCombatRetreat 进度字典或 null。
static func retreat(state: Dictionary, side: String, involved: Array, distance: int, plans: Array,
		combat: Dictionary, data: Dictionary, _board: Variant = null) -> Dictionary:
	if distance == 0 and plans.is_empty():
		return Result.success({"state": state, "pending": null})
	var units: Dictionary = state.get("units", {})
	var expected: Array = involved.filter(func(id): return units.has(str(id)))
	var all: Array = []
	for plan: Dictionary in plans:
		all.append_array(plan.get("units", []))
	if plans.is_empty() and distance > 0:
		var options: Array = route_options(state, side, expected, distance, combat, data)
		if options.is_empty():
			return Result.failure("retreat_plan", "没有任何合法撤退路线")
		var choice := Result.failure("retreat_route_choice", "请选择撤退路线")
		choice["pending"] = {"kind": "retreat-route", "side": side, "distance": distance,
			"units": expected.duplicate(), "options": options}
		return choice
	if distance <= 0 or all.is_empty() or all.size() != _distinct(all).size() \
			or expected.any(func(id): return not all.has(str(id))):
		return Result.failure("retreat_plan", "每条存活参战名单都必须给出一条撤退路线")
	var routes: Array = []
	for index: int in plans.size():
		var plan: Dictionary = plans[index]
		var plan_units: Array = plan.get("units", [])
		var first := str(plan_units[0] if plan_units.size() > 0 else "")
		var origin: Variant = units.get(first, {}).get("hex")
		if origin == null or not plan_units.any(func(id): return involved.has(str(id))):
			return Result.failure("retreat_plan", "每条撤退堆必须包含一名存活参战单位")
		var route := _route_shape(plan, str(origin), index)
		var validate := _validate_route(route, side, distance, combat, data)
		if not validate.ok:
			return validate
		for id: String in route.units:
			var mode := _retreat_mode_result(units.get(id, {}), side, str(origin), data)
			if not mode.ok:
				return mode
		var truck := _validate_truck(route, units)
		if not truck.ok:
			return truck
		routes.append(route)
	var checked: Dictionary = state
	for route: Dictionary in routes:
		var prepared := _prepare_route(checked, side, route, data)
		if not prepared.ok:
			return prepared
		checked = prepared.value.state
	var groups: Dictionary = {}
	for route: Dictionary in routes:
		groups[str(route.get("group", ""))] = true
	if groups.size() != routes.size():
		return Result.failure("retreat_group", "每条撤退堆必须使用独立的组 id")
	var progress := {"side": side, "distance": distance, "routes": routes, "nextRoute": 0, "nextStep": 0}
	return _follow(state, progress, combat, data)


## resumeScorpionCombatRetreat：续跑未完成的撤退堆。changes 为未完成堆的路线后缀
## ContinueCombatRetreat['routes']；缺省 null 表示原地续跑。
static func resume(state: Dictionary, progress: Dictionary, changes: Variant, combat: Dictionary,
		data: Dictionary, _board: Variant = null) -> Dictionary:
	if state.get("capture") != null:
		return Result.failure("capture_pending", "须先结算待决的进格夺取，再继续撤退")
	var routes: Array = progress.get("routes", [])
	var next_route: int = int(progress.get("nextRoute", 0))
	var next_step: int = int(progress.get("nextStep", 0))
	if changes == null:
		return _follow(state, progress, combat, data)
	var suffixes: Array = changes if changes is Array else []
	if suffixes.size() != routes.size() - next_route:
		return Result.failure("retreat_suffix", "须为每条未完成撤退堆给出新的路线后缀")
	var updated: Array = []
	for index: int in routes.size():
		var route: Dictionary = routes[index]
		var change: Variant = suffixes[index - next_route]
		if change == null:
			updated.append(route)
			continue
		var prefix: int = next_step if index == next_route else 0
		var change_path: Array = change.get("path", [])
		var path: Array = route.get("path", []).slice(0, prefix)
		path.append_array(change_path)
		var zoc_losses := _replace_choices(route.get("zocLosses", {}), change.get("zocLosses", {}),
			prefix, change_path.size())
		var remnant_hexes := _replace_choices(route.get("remnantHexes", {}), change.get("remnantHexes", {}),
			prefix, change_path.size())
		var merged := route.duplicate(true)
		merged["path"] = path
		merged["zocLosses"] = zoc_losses
		merged["remnantHexes"] = remnant_hexes
		var validate := _validate_route(merged, str(progress.get("side", "")),
			int(progress.get("distance", 0)), combat, data)
		if not validate.ok:
			return validate
		updated.append(merged)
	var next_progress := progress.duplicate(true)
	next_progress["routes"] = updated
	return _follow(state, next_progress, combat, data)


# ── 内部实现 ──────────────────────────────────────────────────────────────


static func _route_shape(plan: Dictionary, origin: String, index: int) -> Dictionary:
	var group: Variant = plan.get("group")
	if group == null:
		group = "group:%d" % index
	elif str(group) == "":
		group = ""  # 空串由校验层拒绝
	var route := {
		"group": str(group), "origin": origin, "units": plan.get("units", []).duplicate(),
		"path": plan.get("path", []).map(_hex_id),
	}
	if plan.get("breakdowns", []).size() > 0:
		route["breakdowns"] = plan.get("breakdowns", []).duplicate()
	if plan.get("zocLosses", {}).size() > 0:
		route["zocLosses"] = plan.get("zocLosses", {}).duplicate()
	if plan.get("remnantHexes", {}).size() > 0:
		route["remnantHexes"] = plan.get("remnantHexes", {}).duplicate()
	return route


static func _validate_route(route: Dictionary, side: String, distance: int, combat: Dictionary,
		data: Dictionary) -> Dictionary:
	var path: Array = route.get("path", [])
	var endpoint := str(path[-1] if path.size() > 0 else "")
	if endpoint == "" or ReinforcementBoard.hex_distance(str(route.get("origin", "")), endpoint) != distance:
		return Result.failure("retreat_distance", "撤退终点距原点必须恰为指定撤退格数")
	for index: int in path.size():
		var prefix := path.slice(0, index)
		if not _retreat_neighbors(str(route.get("origin", "")), prefix, side, combat, data) \
				.has(str(path[index])):
			return Result.failure("retreat_illegal_hex", "撤退路径穿过非法格或战斗开始时被敌方占据的格")
	for step_key: String in route.get("zocLosses", {}):
		if not _is_step_key(step_key) or int(step_key) >= path.size():
			return Result.failure("retreat_zoc_loss", "ZOC 损失必须选在撤退路径的格上")
	for step_key: String in route.get("remnantHexes", {}):
		if not route.get("zocLosses", {}).has(step_key):
			return Result.failure("retreat_remnant", "撤退残部落点必须对应同一格的被迫损失")
	return Result.success({})


static func _validate_truck(route: Dictionary, units: Dictionary) -> Dictionary:
	var has_truck: bool = route.get("units", []).any(func(id):
		return units.get(str(id), {}).get("organicTruck") != null)
	var has_combat: bool = route.get("units", []).any(func(id):
		return units.get(str(id), {}).get("combat") == true)
	if has_truck and not has_combat:
		return Result.failure("retreat_truck", "编内卡车不能脱离战斗单位单独撤退")
	return Result.success({})


## scorpionRetreatNeighbors：排除原点、路径已走格、战斗开始时敌方占据格与敌方补给源格。
static func _retreat_neighbors(origin: String, path: Array, side: String, combat: Dictionary,
		data: Dictionary) -> Array:
	var enemy := "soviet" if side == "axis" else "axis"
	var held: Array = combat.get("heldAtStart", {}).get(enemy, [])
	var sources: Array = data.get("view", {}).get("supplySources", {}).get(enemy, [])
	var graph: Dictionary = data.get("view", {}).get("mapGraph", {})
	var last := str(path[-1] if path.size() > 0 else origin)
	var result: Array = []
	for hex_id: String in graph.get("neighbors", {}).get(last, []):
		if hex_id == origin or path.has(hex_id) or held.has(hex_id) or sources.has(hex_id):
			continue
		result.append(hex_id)
	return result


## passableRetreatStep：全体撤退单位可支付格边取费，且目标格没有敌方战斗单位。
static func _passable(state: Dictionary, side: String, from: String, to: String, counters: Array,
		data: Dictionary) -> bool:
	var weather := "freeze" if str(state.get("turn", {}).get("weather", {}).get("ground", "")) == "freeze" \
			else "dry"
	var graph: Dictionary = data.get("view", {}).get("mapGraph", {})
	for counter: Dictionary in counters:
		if TerrainCost.step_cost(graph, from, to, str(counter.get("mobility", "truck")), weather) == null:
			return false
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if str(unit.get("side", "")) != side and unit.get("combat") == true and str(unit.get("hex", "")) == to:
			return false
	return true


## retreatMode：资格校验；返回的移动面副本只用于取费/资格判定。
static func _retreat_mode_result(unit: Dictionary, side: String, origin: String, data: Dictionary) -> Dictionary:
	if unit.is_empty() or str(unit.get("side", "")) != side or str(unit.get("hex", "")) != origin \
			or (unit.get("combat") != true and unit.get("organicTruck") == null):
		return Result.failure("retreat_eligible", "撤退堆必须同格出发且只含合格友方算子")
	if unit.get("moveMode", false) == true or (unit.get("headquarters") == null and int(unit.get("allowance", 0)) > 0):
		return Result.success(unit)
	var definition_id := str(unit.get("definition", ""))
	var projected: Variant = GroundModeActions.project_face(unit, definition_id, "move", data)
	if projected is Dictionary and int(projected.get("allowance", 0)) > 0:
		return Result.success(projected)
	var definition: Dictionary = data.get("view", {}).get("catalog", {}).get("definitions", {}) \
			.get(definition_id, {})
	var profile: Dictionary = definition.get("moveFaceProfile", {})
	var alt_allowance: int = int(profile.get("allowance", 0))
	if alt_allowance <= 0:
		return Result.failure("retreat_move_face", "该算子移动面不能撤退")
	var alternate := unit.duplicate(true)
	alternate["allowance"] = alt_allowance
	if profile.get("mobility") != null:
		alternate["mobility"] = str(profile.get("mobility"))
	return Result.success(alternate)


## prepareRoute：撤退堆整堆切到移动面，再按顺序拆出拆分单位；拆出者加入撤退堆。
static func _prepare_route(state: Dictionary, side: String, route: Dictionary,
		data: Dictionary) -> Dictionary:
	var setup: Dictionary = state.get("units", {}).duplicate(true)
	var origin := str(route.get("origin", ""))
	for id: String in route.get("units", []):
		var mode := _retreat_mode_result(setup.get(id, {}), side, origin, data)
		if not mode.ok:
			return mode
		setup[id] = mode.value

	var prepared_state := state.duplicate(true)
	prepared_state["units"] = setup

	var split := Breakdown.detach_orders(prepared_state, side, route.get("breakdowns", []),
		route.get("units", []), data)
	if not split.ok:
		return split

	var prepared_route: Dictionary = route.duplicate(true)
	prepared_route.erase("breakdowns")
	prepared_route["units"] = (route.get("units", []) as Array).duplicate()
	prepared_route["units"].append_array(split.value.get("detachedIds", []))
	return Result.success({"state": split.value.state, "route": prepared_route})


## followRetreat：按进度逐堆逐格推进；夺取/胜利挂起时返回待决进度。
static func _follow(state: Dictionary, progress: Dictionary, combat: Dictionary,
		data: Dictionary) -> Dictionary:
	var side: String = str(progress.get("side", ""))
	var routes: Array = progress.get("routes", [])
	var next_route: int = int(progress.get("nextRoute", 0))
	var next_step: int = int(progress.get("nextStep", 0))
	var raw_zoc: Array = SupplyPosition.enemy_zoc(state.get("units", {}), side, data)
	var raw_set := {}
	for hex_id: String in raw_zoc:
		raw_set[hex_id] = true
	var settled: Dictionary = state
	var worked: Array = routes.duplicate()
	for i: int in range(next_route, worked.size()):
		var first_step: int = next_step if i == next_route else 0
		var route: Dictionary = worked[i]
		if first_step == 0:
			var prepared := _prepare_route(settled, side, route, data)
			if not prepared.ok:
				return prepared
			settled = prepared.value.state
			route = prepared.value.route
			worked[i] = route
		for step: int in range(first_step, route.get("path", []).size()):
			var step_res := _retreat_step(settled, side, route, step, raw_set, data)
			if not step_res.ok:
				return step_res
			settled = step_res.value.state
			if settled.get("victory") != null:
				return Result.success({"state": settled, "pending": null})
			if settled.get("capture") != null:
				var pending := progress.duplicate(true)
				pending["routes"] = worked
				pending["nextRoute"] = i
				pending["nextStep"] = step + 1
				return Result.success({"state": settled, "pending": pending})
	# 撤退落地后逐格堆叠校验（assertScorpionStacking）。
	var destinations := {}
	for id: String in settled.get("units", {}):
		var unit: Dictionary = settled.units[id]
		if str(unit.get("side", "")) == side:
			destinations[str(unit.get("hex", ""))] = true
	for illegal: Dictionary in Stacking.overstacked_hexes(settled, side):
		if destinations.has(str(illegal.get("hex", ""))):
			return Result.failure("stacking_limit",
				"撤退后 %s 格超出堆叠上限（%d/10 RE）" % [illegal.get("hex"), illegal.get("re")])
	return Result.success({"state": settled, "pending": null})


## retreatStep：进入单格结算。进入前单位事实用于 ZOC/失序判定；移动、DG、被迫损一步依次落地。
static func _retreat_step(state: Dictionary, side: String, route: Dictionary, index: int,
		raw_zoc: Dictionary, data: Dictionary) -> Dictionary:
	var path: Array = route.get("path", [])
	var to := str(path[index])
	var from := str(route.get("origin", "")) if index == 0 else str(path[index - 1])
	var units: Dictionary = state.get("units", {})
	var moving: Array = route.get("units", []).filter(func(id): return units.has(str(id)))
	var loss: Variant = _choice_get(route.get("zocLosses", {}), index)
	if moving.is_empty():
		if loss != null:
			return Result.failure("retreat_zoc_loss_unnecessary", "撤退路径上没有单位，ZOC 损失多余")
		return Result.success({"state": state})
	var counters: Array = []
	for id: String in moving:
		counters.append(units[str(id)])
	if not _passable(state, side, from, to, counters, data):
		return Result.failure("retreat_illegal_hex", "撤退穿过非法格或敌方战斗单位")
	# retreatStepEffects（§9.12a/§9.12e）：撤退 ZOC 不可抵消；第二格强制 DG。
	var combat_present: bool = moving.any(func(id): return units[str(id)].get("combat") == true)
	var entered_zoc: bool = raw_zoc.has(to) and combat_present
	var second_hex: bool = index == 1
	var disorganize_hex: bool = entered_zoc or (second_hex and combat_present)
	var candidates: Array = []
	if entered_zoc:
		for id: String in moving:
			var unit: Dictionary = units[str(id)]
			if unit.get("combat") == true and unit.get("disorganized", false) == true:
				candidates.append(str(id))
	if candidates.size() > 0 and (loss == null or not candidates.has(str(loss))):
		var descriptor := {"kind": "retreat-zoc-loss", "origin": str(route.get("origin", "")),
			"hex": to, "step": index, "candidates": candidates, "group": str(route.get("group", ""))}
		var pending := Result.failure("retreat_zoc_loss_choice", "请选择在敌方 ZOC 内被迫损一步的 DG 单位")
		pending["pending"] = descriptor
		return pending
	if loss != null and candidates.is_empty():
		return Result.failure("retreat_zoc_loss_unnecessary", "该格没有被迫损一步的候选单位")
	# 移动入格。
	var next_units := units.duplicate(true)
	for id: String in moving:
		var moved: Dictionary = next_units[str(id)].duplicate(true)
		moved["hex"] = to
		next_units[str(id)] = moved
	var next := state.duplicate(true)
	next["units"] = next_units
	if disorganize_hex:
		_disorganize_hex(next_units, to, side)
	# 进格夺取（resolveScorpionEntry 口径）：地面控制、补给堆、工事、机场与运输队窗口。
	# 9.14 的口径是移动时机，即使这一步属于战斗后撤退。
	var route_path: Array = route.get("path", [])
	var entry_res: Dictionary = Capture.resolve_entry(next, side, to, moving, data, false,
		route_path.slice(index + 1), "manual")
	if not entry_res.ok:
		return entry_res
	next = entry_res.value
	if loss == null:
		return Result.success({"state": next})
	# ZOC 被迫损一步；残部落点随损失一并登记（apply_losses 口径）。
	var remnant_hex: Variant = _choice_get(route.get("remnantHexes", {}), index)
	var remnants: Array = []
	if remnant_hex != null:
		remnants.append({"divisionId": str(loss), "hex": str(remnant_hex)})
	var applied: Dictionary = CombatLosses.apply_losses(next, {str(loss): 1}, data, null, remnants)
	if not applied.ok:
		if applied.get("errorCode", "") in ["remnant_choice", "remnant_unmatched"]:
			var descriptor := {"kind": "retreat-remnant", "origin": str(route.get("origin", "")),
				"step": index, "divisionId": str(loss), "group": str(route.get("group", ""))}
			var detail: Variant = applied.get("pending")
			if detail is Dictionary:
				descriptor["hex"] = str(detail.get("hex", to))
				descriptor["candidates"] = detail.get("candidates", []).duplicate()
			var pending := Result.failure("retreat_remnant_choice", "请选择撤退残部落点")
			pending["pending"] = descriptor
			return pending
		return applied
	return Result.success({"state": applied.value.state})


## DG：本格本方战斗单位转失序，解除预备 / 进击标记；有机卡车解除预备。
static func _disorganize_hex(units: Dictionary, hex_id: String, side: String) -> void:
	for id: String in units:
		var unit: Dictionary = units[id]
		if str(unit.get("side", "")) != side or str(unit.get("hex", "")) != hex_id:
			continue
		var next_unit: Dictionary = unit.duplicate(true)
		if next_unit.get("combat") == true:
			next_unit["disorganized"] = true
			next_unit.erase("reserve")
			next_unit["exploit"] = false
			next_unit.erase("exploitRating")
		elif next_unit.get("organicTruck") != null and next_unit.get("reserve") != null:
			next_unit.erase("reserve")
		units[id] = next_unit


static func _replace_choices(previous: Dictionary, proposed: Dictionary, prefix: int, length: int) -> Dictionary:
	var kept := {}
	for step_key: String in previous:
		if int(step_key) < prefix:
			kept[step_key] = previous[step_key]
	for step_key: String in proposed:
		if not _is_step_key(step_key) or int(step_key) >= length:
			continue  # 非法键由校验层在合并后拒绝
		kept[str(prefix + int(step_key))] = proposed[step_key]
	return kept


static func _choice_get(choices: Dictionary, step: int) -> Variant:
	if choices.has(step):
		return choices[step]
	if choices.has(str(step)):
		return choices[str(step)]
	return null


static func _is_step_key(value: String) -> bool:
	return value.is_valid_int() and int(value) >= 0


static func _distinct(list: Array) -> Array:
	var seen := {}
	var out: Array = []
	for entry: Variant in list:
		if not seen.has(entry):
			seen[entry] = true
			out.append(entry)
	return out


static func _hex_id(source: Variant) -> String:
	var text := str(source)
	var match := RegEx.create_from_string("^s(\\d+)\\.(\\d{1,2})$").search(text)
	if match == null:
		return text
	return "s%s.%s" % [match.get_string(1), match.get_string(2).pad_zeros(2)]
