extends RefCounted

## OCS v4.3 §9.7–9.13 战斗结算与进击（src/match/scorpion-combat-result.ts、series/tables/ground-combat.ts）。
## 掷骰行＝2d6 + 攻方 AR − 守方 AR − 工事等级；先算 odds 取列，再按 surprise/shift 移位。
## 撤退与 continue-combat-retreat 由 retreat.gd 承接（路径合法性、ZOC/DG/被迫损、续跑进度）。
## 突袭（overrun）收尾已接：守方清空自动进格，未清空保留余量；拆分订单仍未实现。

const Result := preload("res://scripts/core/result.gd")
const Crt := preload("res://scripts/rules/series/crt.gd")
const CombatLosses := preload("res://works/third-winter/rules/combat_losses.gd")
const CombatTerrain := preload("res://works/third-winter/rules/combat_terrain.gd")
const Stacking := preload("res://works/third-winter/rules/stacking.gd")
const Retreat := preload("res://works/third-winter/rules/retreat.gd")
const Capture := preload("res://works/third-winter/rules/capture.gd")
const Remnants := preload("res://works/third-winter/rules/remnants.gd")

## 战斗结果侧栏一次最多铺开的合法分配行数；超出时优先保留「不吃选项」与「吃满选项」。
const RESOLVE_OPTION_LIMIT := 24


## 掷一局正规战斗。rolls 为 CombatRolls（绑本局 rng），按 TS 顺序抽 surprise(2d6)→shift(1d6)→combat(2d6)。
## 强度按原始比值取整列（OCS 9.7–9.9 先四舍五入比值，再向下取列），不得先把双方强度取整。
## 返回 Result.success({ code, initialColumn, column, row, surpriseDice, shift, combatDice,
## attacker, defender, exploit, disorganize })。
static func roll_combat(table: Dictionary, terrain: String, attack: float, defend: float,
		modifier: int, hedgehog: int, rolls: RefCounted, overrun: bool = false) -> Dictionary:
	var columns: Variant = table.get("terrainColumns", {}).get(terrain)
	if not columns is Array or columns.is_empty() or attack < 0 or defend < 0 \
			or not is_finite(attack + defend):
		return Result.failure("combat_odds", "无效战斗兵力比（攻 %s / 守 %s）" % [str(attack), str(defend)])
	var odds: float
	if attack == defend:
		odds = 1.0
	elif defend == 0:
		odds = INF
	elif attack == 0:
		odds = 0.0
	elif attack > defend:
		odds = roundf(attack / defend)
	else:
		odds = 1.0 / roundf(defend / attack)
	var initial_column := 0
	for index: int in columns.size():
		var label: String = str(columns[index])
		var parts := label.split(":")
		if parts.size() != 2:
			return Result.failure("crt_column", "无效 CRT 列标：%s" % label)
		var a := float(parts[0])
		var b := float(parts[1])
		if a == 0 or b == 0:
			return Result.failure("crt_column", "无效 CRT 列标：%s" % label)
		if a / b <= odds:
			initial_column = index
	var surprise: Array = rolls.two({"kind": "surprise"})
	if rolls.failed():
		return rolls.error
	if surprise.size() != 2:
		return Result.failure("combat_dice", "战斗掷骰须含 2 枚 surprise 骰")
	var surprise_total: int = int(surprise[0]) + int(surprise[1]) + modifier - (1 if hedgehog > 0 else 0)
	var high := 9 if overrun else 10
	var low := 6 if overrun else 5
	var shift: int = 0
	if surprise_total >= high:
		shift = rolls.one({"kind": "surprise-shift"})
	elif surprise_total <= low:
		shift = -rolls.one({"kind": "surprise-shift"})
	if rolls.failed():
		return rolls.error
	var column: int = clampi(initial_column + shift, 0, columns.size() - 1)
	var combat: Array = rolls.two({"kind": "combat"})
	if rolls.failed():
		return rolls.error
	if combat.size() != 2:
		return Result.failure("combat_dice", "战斗掷骰须含 2 枚 combat 骰")
	var row_match := Crt.match_row_index(table.get("diceRows", []),
		int(combat[0]) + int(combat[1]) + modifier - hedgehog, "crt")
	if not row_match.ok:
		return row_match
	var row: int = int(row_match.value)
	var matrix: Array = table.get("matrix", [])
	if row < 0 or row >= matrix.size():
		return Result.failure("crt_row", "CRT 行越界：%d" % row)
	var matrix_row: Array = matrix[row]
	if column < 0 or column >= matrix_row.size():
		return Result.failure("crt_column", "CRT 列越界：%d" % column)
	var code: String = str(matrix_row[column])
	var parsed := _parse_combat_result(code)
	if not parsed.ok:
		return parsed
	var value: Dictionary = parsed.value
	return Result.success({"code": code, "initialColumn": initial_column, "column": column, "row": row,
		"surpriseDice": surprise, "shift": shift, "combatDice": combat,
		"attacker": value.attacker, "defender": value.defender,
		"exploit": value.exploit, "disorganize": value.disorganize})


## 结算一方的战斗结果（攻方或守方窗口）。action: { lossOrder, optionLosses,
## ignoreDefenderOption?, retreats, remnants? }。返回 Result.success({ state, advanced?, granted? })。
static func resolve(state: Dictionary, actor: String, action: Dictionary, data: Dictionary,
		board: Variant = null) -> Dictionary:
	var combat: Variant = state.get("combat")
	if combat == null:
		return Result.failure("combat_missing", "当前没有进行中的战斗")
	var attacker: bool = str(combat.get("step", "")) == "attacker-result"
	if combat.get("roll") == null or combat.get("retreat") != null \
			or (not attacker and str(combat.get("step", "")) != "defender-result") \
			or attacker != (actor == str(combat.get("attacker", ""))):
		return Result.failure("combat_resolve_order", "须由正确一方按顺序结算战斗结果")
	var ids: Array = combat.get("attackers", []) if attacker else combat.get("defenders", [])
	var leader: String = str(combat.get("attackerLeader") if attacker else combat.get("defenderLeader"))
	var result: Dictionary = combat.get("roll", {}).get("attacker" if attacker else "defender", {})
	var ignore: bool = action.get("ignoreDefenderOption", false) == true
	if ignore and (attacker or combat.get("defenderMayIgnore", false) != true):
		return Result.failure("combat_ignore_option", "该方不能忽略其战斗选项")
	var available := 0
	for id: String in ids:
		available += CombatLosses.remaining(state.get("units", {}).get(id, {}))
	var obligations := _combat_obligations(result, available,
		{"ignoreOption": ignore, "optionLosses": action.get("optionLosses", 0)})
	if not obligations.ok:
		return obligations
	var allocation_check: Dictionary = CombatLosses.validate_loss_order(state, ids, leader,
		action.get("lossOrder", []), obligations.value.totalLosses)
	if not allocation_check.ok:
		return allocation_check
	var settled: Dictionary = CombatLosses.apply_losses(state, allocation_check.value.allocation, data, board,
		action.get("remnants", []))
	if not settled.ok:
		return settled
	var settled_state: Dictionary = settled.value.state
	if settled_state.get("victory") != null:
		var ended := settled_state.duplicate(true)
		ended["combat"] = null
		ended["overrunMarch"] = null
		return Result.success({"state": ended, "outcome": "victory"})
	var unmet: int = obligations.value.unmetOptions
	var retreat_distance: int = obligations.value.retreatDistance
	var retreats: Array = action.get("retreats", [])
	var retreat_res: Dictionary = Retreat.retreat(settled_state, actor, ids, retreat_distance, retreats, combat, data, board)
	if not retreat_res.ok:
		return retreat_res
	settled_state = retreat_res.value.state
	if settled_state.get("victory") != null:
		var ended := settled_state.duplicate(true)
		ended.erase("combat")
		ended.erase("overrunMarch")
		ended.erase("capture")
		return Result.success({"state": ended, "outcome": "victory", "victory": settled_state.get("victory")})
	var pending: Variant = retreat_res.value.pending
	if attacker:
		var threshold: Variant = combat.get("roll", {}).get("exploit")
		var origins: Array = []
		for id: String in ids:
			if settled_state.get("units", {}).has(id) and not origins.has(settled_state.units[id].hex):
				origins.append(settled_state.units[id].hex)
		var attackers: Array = []
		for id: String in ids:
			var unit: Dictionary = settled_state.get("units", {}).get(id, {})
			if unit.is_empty():
				continue
			attackers.append({"id": id, "rating": CombatTerrain.combat_rating(unit),
				"disorganized": unit.get("disorganized", false) == true})
		var granted := _exploit_eligibility({"threshold": threshold,
			"overrun": combat.get("kind") == "overrun",
			"combatPhase": str(state.get("cursor", {}).get("phase", "")) == "combat",
			"unmetOptions": unmet, "origins": origins, "attackers": attackers, "data": data})
		var units: Dictionary = settled_state.get("units", {}).duplicate(true)
		for id: String in granted:
			var upgraded: Dictionary = units[id].duplicate(true)
			upgraded["exploit"] = true
			upgraded["exploitRating"] = threshold
			units[id] = upgraded
		var next_combat: Dictionary = combat.duplicate(true)
		next_combat["step"] = "defender-result"
		next_combat["defenderMayIgnore"] = unmet > 0
		next_combat["attackerRetreated"] = retreat_distance > 0
		if pending != null:
			next_combat["retreat"] = pending
		var next := settled_state.duplicate(true)
		next["units"] = units
		next["combat"] = next_combat
		return Result.success({"state": next, "granted": granted})
	if pending != null:
		var pending_combat: Dictionary = combat.duplicate(true)
		pending_combat["retreat"] = pending
		var pending_next: Dictionary = settled_state.duplicate(true)
		pending_next["combat"] = pending_combat
		return Result.success({"state": pending_next})
	# 守方窗口：目标格已无本方战斗单位且攻方未撤退时，进入进击步骤。
	var empty := true
	for id: String in settled_state.get("units", {}):
		var unit: Dictionary = settled_state.units[id]
		if str(unit.get("side", "")) == actor and unit.get("combat") == true \
				and str(unit.get("hex", "")) == str(combat.get("target", "")):
			empty = false
			break
	if combat.get("kind") == "overrun":
		return _finish_overrun(settled_state, combat, empty, data)
	var advance: bool = empty and combat.get("attackerRetreated", false) != true \
			and _has_survivor(settled_state, combat.get("attackers", []))
	var next_combat: Variant = null
	if advance:
		next_combat = combat.duplicate(true)
		next_combat["step"] = "advance"
	var next_state: Dictionary = settled_state.duplicate(true)
	next_state["combat"] = next_combat
	return Result.success({"state": next_state, "advanced": advance})


## continue-combat-retreat：续跑挂起的撤退路线（continueScorpionRetreatResult 口径）。
## action: { routes?: ContinueCombatRetreat['routes'] }。返回 Result.success({ state, pending? })。
static func continue_retreat(state: Dictionary, actor: String, action: Dictionary, data: Dictionary,
		board: Variant = null) -> Dictionary:
	var combat: Variant = state.get("combat")
	if combat == null:
		return Result.failure("combat_missing", "当前没有进行中的战斗")
	var retreat: Variant = combat.get("retreat")
	if retreat == null or str(retreat.get("side", "")) != actor:
		return Result.failure("combat_retreat_actor", "须由挂起撤退的一方继续撤退")
	var resume_res: Dictionary = Retreat.resume(state, retreat, action.get("routes"), combat, data, board)
	if not resume_res.ok:
		return resume_res
	var settled: Dictionary = resume_res.value.state
	if settled.get("victory") != null:
		var ended: Dictionary = settled.duplicate(true)
		ended.erase("combat")
		ended.erase("overrunMarch")
		ended.erase("capture")
		return Result.success({"state": ended, "outcome": "victory", "victory": settled.get("victory")})
	var pending: Variant = resume_res.value.pending
	var resolved: Dictionary = combat.duplicate(true)
	resolved.erase("retreat")
	if pending != null:
		resolved["retreat"] = pending
		var next_pending: Dictionary = settled.duplicate(true)
		next_pending["combat"] = resolved
		return Result.success({"state": next_pending})
	if str(resolved.get("step", "")) == "attacker-result":
		resolved["step"] = "defender-result"
		resolved["defenderMayIgnore"] = true
		resolved["attackerRetreated"] = true
		var next_attacker: Dictionary = settled.duplicate(true)
		next_attacker["combat"] = resolved
		return Result.success({"state": next_attacker})
	# 守方撤退收尾：损失在挂起前已结算；此处只重放进击/收尾判定。
	var empty := true
	for id: String in settled.get("units", {}):
		var unit: Dictionary = settled.units[id]
		if str(unit.get("side", "")) == actor and unit.get("combat") == true \
				and str(unit.get("hex", "")) == str(resolved.get("target", "")):
			empty = false
			break
	if resolved.get("kind") == "overrun":
		return _finish_overrun(settled, resolved, empty, data)
	var advance: bool = empty and resolved.get("attackerRetreated", false) != true \
			and _has_survivor(settled, resolved.get("attackers", []))
	var next_combat: Variant = null
	if advance:
		next_combat = resolved.duplicate(true)
		next_combat["step"] = "advance"
	var next_state: Dictionary = settled.duplicate(true)
	next_state["combat"] = next_combat
	return Result.success({"state": next_state, "advanced": advance})


## 进击：存活攻方单位进入目标格。orders 为拆分（breakdown）名单，本轮未实现。
static func advance(state: Dictionary, side: String, ids: Array, data: Dictionary,
		board: Variant = null, orders: Array = []) -> Dictionary:
	var combat: Variant = state.get("combat")
	if combat == null:
		return Result.failure("combat_missing", "当前没有进行中的战斗")
	var distinct := {}
	for id: String in ids:
		distinct[id] = true
	if str(combat.get("step", "")) != "advance" or str(combat.get("attacker", "")) != side \
			or ids.size() != distinct.size():
		return Result.failure("combat_advance_order", "须选择合法的存活攻方单位进击")
	for id: String in ids:
		if not state.get("units", {}).has(id) or not combat.get("attackers", []).has(id):
			return Result.failure("combat_advance_survivor", "只有存活攻方单位可以进击")
	if combat.get("kind") == "overrun":
		return Result.failure("overrun_auto_advance", "突袭由结算自动进格，不需要进击命令")
	if orders.size() > 0:
		return Result.failure("breakdown_unimplemented", "拆分单位随进击离场本轮未实现")
	var entrants: Array = ids.duplicate()
	var units: Dictionary = state.get("units", {}).duplicate(true)
	for id: String in entrants:
		var moved: Dictionary = units[id].duplicate(true)
		moved["hex"] = str(combat.get("target", ""))
		units[id] = moved
	var advanced := state.duplicate(true)
	advanced["units"] = units
	advanced["combat"] = null
	var illegal: Array = Stacking.overstacked_hexes(advanced, side)
	for stack: Dictionary in illegal:
		if str(stack.get("hex", "")) == str(combat.get("target", "")):
			return Result.failure("stacking_limit", "进击后目标格超出堆叠上限（%d/10 RE）" % int(stack.get("re", 0)))
	# 进格夺取（resolveScorpionEntry 口径，afterCombat=true）：地面控制、补给堆、工事、
	# 机场与运输队窗口；战斗夹具按手动策略（captureResolution='manual'）生成，故此处挂窗口等 settle。
	var target := str(combat.get("target", ""))
	var entry_res: Dictionary = Capture.resolve_entry(advanced, side, target, entrants, data, true, [], "manual")
	if not entry_res.ok:
		return entry_res
	advanced = entry_res.value
	advanced["combat"] = null
	return Result.success({"state": advanced, "entrants": entrants})


## 战果侧栏：把当前一方的结果义务展开成合法的 `resolve-combat` action 列表。
## 每个 action 已按 §9.11c 轮转规则排好 lossOrder；若某师会被消灭且残部有多个落点，
## 再按落点组合展开（同一条 action 里带上 `remnants`）。无效状态或超限时返回空/截断列表。
static func resolve_options(state: Dictionary, actor: String, data: Dictionary) -> Array:
	var combat: Variant = state.get("combat")
	if not (combat is Dictionary) or combat.get("roll") == null or combat.get("retreat") != null:
		return []
	var attacker_side := str(combat.get("attacker", ""))
	var attacker: bool = str(combat.get("step", "")) == "attacker-result"
	var expected := attacker_side if attacker else ("soviet" if attacker_side == "axis" else "axis")
	if actor != expected:
		return []
	var ids: Array = combat.get("attackers", []) if attacker else combat.get("defenders", [])
	var leader := str(combat.get("attackerLeader") if attacker else combat.get("defenderLeader"))
	var result: Dictionary = combat.get("roll", {}).get("attacker" if attacker else "defender", {})
	var units: Dictionary = state.get("units", {})
	var available_by_id := {}
	var available := 0
	for id: String in ids:
		var unit: Dictionary = units.get(id, {})
		if unit.is_empty():
			return []
		var remaining := CombatLosses.remaining(unit)
		available_by_id[id] = remaining
		available += remaining
	var mandatory: int = mini(available, int(result.get("loss", 0)))
	var options: int = int(result.get("option", 0))
	var max_options: int = mini(options, available - mandatory)
	var ignore_allowed: bool = not attacker and combat.get("defenderMayIgnore", false) == true
	var option_values: Array = [0]
	if max_options > 0:
		option_values.append(max_options)
		for value in range(1, max_options):
			option_values.append(value)
	var choices: Array = []
	for option_losses: int in option_values:
		choices.append({"ignore": false, "optionLosses": option_losses})
	if ignore_allowed and options > 0:
		choices.append({"ignore": true, "optionLosses": 0})
	var entries: Array = []
	for choice: Dictionary in choices:
		var obligations: Dictionary = _combat_obligations(result, available,
			{"ignoreOption": choice.ignore, "optionLosses": choice.optionLosses})
		if not obligations.ok:
			continue
		var required := int(obligations.value.totalLosses)
		var orders: Array = _loss_orders(ids, leader, required, available_by_id, RESOLVE_OPTION_LIMIT)
		for order: Array in orders:
			if entries.size() >= RESOLVE_OPTION_LIMIT:
				return entries
			var assigned := {}
			for id: String in order:
				assigned[id] = int(assigned.get(id, 0)) + 1
			var doomed: Array = []
			for id: String in ids:
				if int(available_by_id[id]) > 0 and int(assigned.get(id, 0)) >= int(available_by_id[id]):
					doomed.append(id)
			var remnant_plan: Dictionary = _remnant_plan(state, doomed, data)
			for combo: Array in remnant_plan.combos:
				if entries.size() >= RESOLVE_OPTION_LIMIT:
					return entries
				var action := {"type": "resolve-combat", "lossOrder": order.duplicate(true),
					"optionLosses": int(choice.optionLosses),
					"ignoreDefenderOption": bool(choice.ignore), "retreats": [],
					"remnants": combo.duplicate(true)}
				entries.append({"action": action, "totalLosses": required,
					"optionLosses": int(choice.optionLosses), "ignore": bool(choice.ignore),
					"retreatDistance": int(obligations.value.retreatDistance),
					"doomed": doomed.duplicate(), "remnantsFor": remnant_plan.ids.duplicate(),
					"remnants": combo.duplicate(true)})
	return entries


## §9.11c 轮转：第一点必须由 AR 领导单位承受；之后每一点只能落在累计点数最少且未耗尽的参战单位上。
static func _loss_orders(ids: Array, leader: String, required: int, remaining: Dictionary,
		limit: int) -> Array:
	if required <= 0:
		return [[]]
	if leader == "" or not ids.has(leader):
		return []
	var assigned := {}
	for id: String in ids:
		assigned[id] = 0
	var out: Array = []
	_walk_loss_orders(out, [], assigned, ids, leader, required, remaining, limit)
	return out


static func _walk_loss_orders(out: Array, order: Array, assigned: Dictionary, ids: Array,
		leader: String, required: int, remaining: Dictionary, limit: int) -> void:
	if order.size() >= required:
		out.append(order.duplicate(true))
		return
	if out.size() >= limit:
		return
	var least := 1 << 30
	for id: String in ids:
		if int(assigned[id]) < int(remaining[id]):
			least = mini(least, int(assigned.get(id, 0)))
	for id: String in ids:
		if int(assigned[id]) >= int(remaining[id]) or int(assigned[id]) != least:
			continue
		if order.is_empty() and id != leader:
			continue
		order.append(id)
		assigned[id] = int(assigned.get(id, 0)) + 1
		_walk_loss_orders(out, order, assigned, ids, leader, required, remaining, limit)
		assigned[id] = int(assigned.get(id, 0)) - 1
		order.pop_back()


## 多落点残部按组合展开；无可放置残部的被毁单位不进入 `ids`，单落点仍由规则层自动处理。
static func _remnant_plan(state: Dictionary, doomed: Array, data: Dictionary) -> Dictionary:
	var groups: Array = []
	var ids: Array = []
	for id: String in doomed:
		var unit: Dictionary = state.get("units", {}).get(id, {})
		var choices: Array = Remnants.destinations(state, unit, data)
		if choices.is_empty():
			continue
		ids.append(id)
		if choices.size() > 1:
			groups.append({"divisionId": id, "choices": choices})
	var combos: Array = [[]]
	for group: Dictionary in groups:
		var next: Array = []
		for base: Array in combos:
			for hex: String in group.choices:
				var item: Array = base.duplicate(true)
				item.append({"divisionId": str(group.divisionId), "hex": hex})
				next.append(item)
		combos = next
	return {"ids": ids, "combos": combos}


## OCS 8.1g / 突袭收尾：守方清空且攻方未撤时全部存活者自动进格（无拆分订单），
## 否则只清战斗、保留 `overrunMarch` 让幸存者用余量继续走。
static func _finish_overrun(state: Dictionary, combat: Dictionary, empty: bool, data: Dictionary) -> Dictionary:
	var march: Variant = state.get("overrunMarch")
	if not (march is Dictionary):
		return Result.failure("overrun_march", "突袭缺少余量账本")
	var survivors: Array = []
	var remaining := {}
	for id: String in combat.get("attackers", []):
		var unit: Variant = state.get("units", {}).get(id)
		if unit == null:
			continue
		survivors.append(id)
		remaining[id] = int((march as Dictionary).get("remaining", {}).get(id, unit.get("allowance", 0)))
	var next: Dictionary = state.duplicate(true)
	next["combat"] = null
	if survivors.is_empty() or combat.get("attackerRetreated", false) == true:
		next["overrunMarch"] = null
		return Result.success({"state": next})
	next["overrunMarch"] = {"remaining": remaining,
		"enteredHex": (march as Dictionary).get("enteredHex", false) == true}
	if not empty:
		return Result.success({"state": next})
	var target := str(combat.get("target", ""))
	var units: Dictionary = next.get("units", {}).duplicate(true)
	for id: String in survivors:
		var moved: Dictionary = units[id].duplicate(true)
		moved["hex"] = target
		units[id] = moved
	next["units"] = units
	var illegal: Array = Stacking.overstacked_hexes(next, str(combat.get("attacker", "")))
	for stack: Dictionary in illegal:
		if str(stack.get("hex", "")) == target:
			return Result.failure("overrun_stacking", "突袭进格后目标格超出堆叠上限（%d/10 RE）" % int(stack.get("re", 0)))
	var entry_res: Dictionary = Capture.resolve_entry(next, str(combat.get("attacker", "")), target,
		survivors, data, true, [], "manual")
	if not entry_res.ok:
		return entry_res
	var entered: Dictionary = entry_res.value
	entered["combat"] = null
	entered["overrunMarch"] = {"remaining": remaining, "enteredHex": true}
	return Result.success({"state": entered, "entrants": survivors})


## §9.10/§9.11b 结果义务：强制损失截断到剩余步数；选项损失不得超过 min(选项, 剩余−强制)。
static func _combat_obligations(result: Dictionary, available: int, choice: Dictionary) -> Dictionary:
	var mandatory: int = mini(available, int(result.get("loss", 0)))
	var options: int = 0 if choice.get("ignoreOption", false) == true else int(result.get("option", 0))
	var option_losses: int = int(choice.get("optionLosses", 0))
	if option_losses < 0 or option_losses > mini(options, available - mandatory):
		return Result.failure("combat_option_losses", "战斗选项损失分配无效")
	var losses: int = mandatory + option_losses
	var unmet: int = options - option_losses
	var retreat_distance: int = unmet if available > losses else 0
	return Result.success({"mandatoryLosses": mandatory, "availableOptions": options,
		"optionLosses": option_losses, "totalLosses": losses, "unmetOptions": unmet,
		"retreatDistance": retreat_distance})


## §9.10d/§9.13b 进击标记资格：CRT 给 e#、非突袭、战斗阶段、选项全吃损失、至多两相邻原点、
## 逐单位 AR≥阈值且非 DG。
static func _exploit_eligibility(input: Dictionary) -> Array:
	var threshold: Variant = input.get("threshold")
	if threshold == null or input.get("overrun", false) == true \
			or input.get("combatPhase", false) != true or int(input.get("unmetOptions", 0)) != 0:
		return []
	var origins: Array = input.get("origins", [])
	if origins.is_empty() or origins.size() > 2:
		return []
	if origins.size() == 2 and not _adjacent(input.get("data", {}), str(origins[0]), str(origins[1])):
		return []
	var granted: Array = []
	for unit: Dictionary in input.get("attackers", []):
		if unit.get("disorganized", false) != true and int(unit.get("rating", 0)) >= int(threshold):
			granted.append(str(unit.get("id", "")))
	return granted


static func _adjacent(data: Dictionary, a: String, b: String) -> bool:
	var neighbors: Variant = data.get("view", {}).get("mapGraph", {}).get("neighbors", {})
	if neighbors is Dictionary:
		return neighbors.get(a, []).has(b)
	return false


static func _has_survivor(state: Dictionary, attackers: Array) -> bool:
	for id: String in attackers:
		if state.get("units", {}).has(id):
			return true
	return false


## 解析 OCS 战斗结果码（series/tables/ground-combat.ts parseCombatResult）。
static func _parse_combat_result(code: String) -> Dictionary:
	var regex := RegEx.create_from_string(
		"^A(?:L([1-9]))?(?:o([1-9]))?(?:\\s*e([1-5]))?(?:\\s+D(?:L([1-9]))?(?:o([1-9]))?(DG)?)?$")
	var match: Variant = regex.search(code)
	if match == null:
		return Result.failure("combat_result_code", "无效 OCS 战斗结果：%s" % code)
	var captured := false
	for group_index in range(1, 7):
		if match.get_string(group_index) != "":
			captured = true
	if not captured:
		return Result.failure("combat_result_code", "无效 OCS 战斗结果：%s" % code)
	var attacker_loss := int(match.get_string(1)) if match.get_string(1) != "" else 0
	var attacker_option := int(match.get_string(2)) if match.get_string(2) != "" else 0
	var exploit: Variant = int(match.get_string(3)) if match.get_string(3) != "" else null
	var defender_loss := int(match.get_string(4)) if match.get_string(4) != "" else 0
	var defender_option := int(match.get_string(5)) if match.get_string(5) != "" else 0
	var disorganize: bool = match.get_string(6) != ""
	return Result.success({"attacker": {"loss": attacker_loss, "option": attacker_option},
		"defender": {"loss": defender_loss, "option": defender_option},
		"exploit": exploit, "disorganize": disorganize})
