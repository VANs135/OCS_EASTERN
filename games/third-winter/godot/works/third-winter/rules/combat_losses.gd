extends RefCounted

## OCS v4.3 §9.11 战斗损失分配与落地（src/match/scorpion-combat-losses.ts、scorpion-losses.ts）。
## AR 领导单位承受第一点损失；损失超过单位数时先各摊一点再允许第二点（逐轮均摊）。
## 步损经 step_loss.gd 分流：残部回池 / 警戒营回池 / 死人堆；合格轴心师打光即按 TTW 2.4d
## 在盘面生成残部。
## 本轮缺口：Kessel 司令部离场后的 kesselReturns 返还回合未结算。

const Result := preload("res://scripts/core/result.gd")
const StepLoss := preload("res://scripts/rules/series/step_loss.gd")
const SupplyPosition := preload("res://works/third-winter/rules/supply_position.gd")
const SupplyTrace := preload("res://works/third-winter/rules/supply_trace.gd")
const Remnants := preload("res://works/third-winter/rules/remnants.gd")


## 存活步数（TTW 2.4b 口径，下限 1）。
static func remaining(unit: Dictionary) -> int:
	return StepLoss.remaining(unit)


## §9.11c 军力损失分配校验。order 为逐点承受序列，长度须恰为 required，首点须为 AR 领导单位。
## 返回 Result.success({ allocation: { unitId: steps } })。
static func validate_loss_order(state: Dictionary, participants: Array, leader: String,
		order: Array, required: int) -> Dictionary:
	var remaining := {}
	for id: String in participants:
		var unit: Dictionary = state.get("units", {}).get(id, {})
		if unit.is_empty():
			return Result.failure("loss_participant", "参战算子不在盘面：%s" % id)
		remaining[id] = StepLoss.remaining(unit)
	if order.size() != required or (required > 0 and str(order[0]) != str(leader)):
		return Result.failure("loss_order_leader", "战斗损失须全部分配，且由行动值单位先承受第一点")
	var assigned := {}
	for id: String in order:
		var received: int = int(assigned.get(id, 0))
		var least := INF
		for key: String in remaining:
			if int(assigned.get(key, 0)) < int(remaining[key]):
				least = minf(least, float(int(assigned.get(key, 0))))
		if int(remaining.get(id, 0)) <= received or received > least:
			return Result.failure("loss_order_round_robin", "每枚参战单位先各承受一点，存活单位再承受下一点")
		assigned[id] = received + 1
	return Result.success({"allocation": assigned})


## 按分配落地步损。allocation 为 { unitId: steps }；remnants 为本轮玩家指定的残部落点
## 名单 [{ divisionId, hex }]。返回 Result.success({ state, vp, isolated, remnants, pendingKessel })。
static func apply_losses(state: Dictionary, allocation: Dictionary, data: Dictionary,
		_board: Variant = null, remnants: Array = []) -> Dictionary:
	var vp: int = int(state.get("arrival", {}).get("sovietVp", 0))
	var choices := {}
	for remnant: Dictionary in remnants:
		choices[str(remnant.get("divisionId", ""))] = str(remnant.get("hex", ""))
	if remnants.size() > 0 and choices.size() != remnants.size():
		return Result.failure("remnant_choice", "每枚可生成残部的师只能选择一个落点")
	var current: Dictionary = state.duplicate(true)
	var isolated: Array = []
	var placed_remnants: Array = []
	var pending_kessel: Array = []
	for id: String in allocation:
		var steps := int(allocation[id])
		var unit: Dictionary = current.get("units", {}).get(id, {})
		if unit.is_empty():
			return Result.failure("loss_unit", "承受损失的算子不在盘面：%s" % id)
		var isolated_flag := false
		if str(unit.get("side", "")) == "axis":
			var position := SupplyPosition.position(current.get("units", {}),
				current.get("railControl", {}), "axis", data)
			var weather := str(current.get("turn", {}).get("weather", {}).get("ground", "dry"))
			var network := SupplyTrace.network(data.get("view", {}).get("mapGraph", {}), position, "axis", weather)
			var mobility := str(unit.get("traceDrawMobility", unit.get("mobility", "truck")))
			isolated_flag = not network.has_trace(unit.hex, mobility)
		var lost: Dictionary = StepLoss.apply(current, {id: steps}, data)
		if not lost.ok:
			return lost
		current = lost.value
		var headquarters: Variant = unit.get("headquarters")
		if headquarters is Dictionary and headquarters.get("kessel") == true and not current.get("units", {}).has(id):
			# 缺口：Kessel 司令部离场后的 kesselReturns 返还回合未结算。
			pending_kessel.append({"unitId": id, "definition": str(unit.get("definition", ""))})
		var placed_remnant := false
		if str(unit.get("side", "")) == "axis" and not current.get("units", {}).has(id):
			## TTW 2.4d：合格轴心师打光即生成残部；非师级 / 非合格单位留在死人堆，不进残部。
			var requested: Variant = choices.get(id, null)
			if requested == null:
				var candidates: Array = Remnants.destinations(current, unit, data)
				if candidates.size() > 1:
					var choice_failure := Result.failure("remnant_choice", "请为该师选择残部落点")
					choice_failure["pending"] = {"kind": "combat-remnant", "divisionId": id,
						"hex": str(unit.get("hex", "")), "candidates": candidates}
					return choice_failure
			var place_res: Dictionary = Remnants.place(current, id, unit, requested, data)
			if not place_res.ok:
				return place_res
			current = place_res.value.state
			placed_remnant = place_res.value.placed
			if placed_remnant:
				placed_remnants.append({"divisionId": id,
					"remnantId": str(place_res.value.get("remnantId", "")),
					"hex": str(place_res.value.get("hex", ""))})
		## 剧本册 p.53：断补轴心单位按损失步数计 VP；否则生成残部的师记 1 VP。
		if isolated_flag:
			isolated.append({"unitId": id, "steps": steps})
			vp += steps
		elif placed_remnant:
			vp += 1
	if choices.size() > 0:
		for division_id: String in choices:
			var matched := false
			for entry: Dictionary in placed_remnants:
				if str(entry.get("divisionId", "")) == division_id:
					matched = true
					break
			if not matched:
				return Result.failure("remnant_unmatched", "残部落点须对应一枚被消灭的合格师")
	var victory: Variant = _sudden_death(int(current.get("turn", {}).get("number", 1)), vp)
	var arrival: Dictionary = current.get("arrival", {}).duplicate(true)
	arrival["sovietVp"] = vp
	current["arrival"] = arrival
	current["victory"] = victory
	return Result.success({"state": current, "vp": vp, "isolated": isolated,
		"remnants": placed_remnants, "pendingKessel": pending_kessel})


## 剧本册 p.53 突然死亡：第 3 回合起，VP ≤ -4 轴心大胜，≥ 20 苏军大胜。
static func _sudden_death(turn_number: int, vp: int) -> Variant:
	if turn_number < 3:
		return null
	if vp < -4:
		return {"outcome": "axis", "level": "major"}
	if vp > 19:
		return {"outcome": "soviet", "level": "major"}
	return null
