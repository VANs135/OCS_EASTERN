extends RefCounted

## OCS v4.3 §9.5–9.13 正规战斗七步状态机（src/match/scorpion-combat.ts、scorpion-combat-actions.ts）。
## 步骤序列：defender-supply → attacker-rating → defender-rating → defender-terrain
## → attacker-result → defender-result → advance。
## 本模块只做窗口校验、领导/地形选择与状态迁移；供应口径见 combat_supply.gd，
## 损失落地见 combat_losses.gd，掷骰/结果/进击见 combat_result.gd。

const Result := preload("res://scripts/core/result.gd")
const Modes := preload("res://scripts/rules/series/modes.gd")
const CombatSupply := preload("res://works/third-winter/rules/combat_supply.gd")
const CombatResult := preload("res://works/third-winter/rules/combat_result.gd")
const SupplyPayment := preload("res://works/third-winter/rules/sp_payment.gd")
const CombatTerrain := preload("res://works/third-winter/rules/combat_terrain.gd")
const CombatRolls := preload("res://works/third-winter/rules/combat_rolls.gd")
const GroundActivity := preload("res://works/third-winter/rules/ground_activity.gd")
const TerrainCost := preload("res://works/third-winter/rules/terrain_cost.gd")
const Stacking := preload("res://works/third-winter/rules/stacking.gd")

const PHASES := ["combat", "exploitation"]


## 第一步·宣告（declare-combat）：攻方在战斗/ exploitation 阶段选择目标格与攻方名单并付战斗补给。
static func declare(state: Dictionary, actor: String, action: Dictionary, data: Dictionary,
		board: Dictionary = {}) -> Dictionary:
	var cursor: Dictionary = state.get("cursor", {})
	var overrun := str(action.get("kind", "")) == "overrun"
	var phases: Array = PHASES.duplicate()
	if overrun:
		phases.append("movement")
		phases.append("reaction")
	if str(cursor.get("phasing", "")) != actor or not phases.has(str(cursor.get("phase", ""))) \
			or state.get("combat") != null:
		return Result.failure("combat_unavailable", "当前阶段不能宣告战斗")
	var map_graph: Dictionary = data.get("view", {}).get("mapGraph", {})
	var target := _hex_id(str(action.get("target", "")))
	if not map_graph.get("terrains", {}).has(target):
		return Result.failure("combat_target", "目标格不在地图上：%s" % target)
	var combat_targets: Array = state.get("combatTargets", [])
	if combat_targets.has(target) and not overrun:
		return Result.failure("combat_target_used", "该格本回合已被攻击")
	var attackers: Array = action.get("attackers", [])
	if attackers.is_empty():
		return Result.failure("combat_attacker_empty", "战斗至少需要一枚攻方单位")
	var seen := {}
	for id: String in attackers:
		if seen.has(id):
			return Result.failure("combat_attacker_duplicate", "攻方名单重复：%s" % id)
		seen[id] = true
	if str(cursor.get("phase", "")) == "exploitation" and not overrun:
		var end_check := _assert_movement_end(state, actor, board)
		if not end_check.ok:
			return end_check
	var opposite := _opponent(actor)
	var sources: Variant = data.get("view", {}).get("supplySources", {}).get(opposite, [])
	if sources is Array and sources.has(target):
		return Result.failure("combat_supply_source", "敌方补给源格不能作为战斗目标")
	var airlifted: Array = _airlifted(state)
	var weather := "freeze" if str(state.get("turn", {}).get("weather", {}).get("ground", "")) == "freeze" else "dry"
	for id: String in attackers:
		var unit: Dictionary = state.get("units", {}).get(id, {})
		if unit.is_empty() or unit.get("attackCapable", false) != true or str(unit.get("side", "")) != actor:
			return Result.failure("combat_attacker_eligible", "攻方单位资格不符：%s" % id)
		var mode := Modes.ground_mode_effect(CombatTerrain._ground_state(unit))
		if mode.get("canAttack", true) != true:
			return Result.failure("combat_attacker_eligible", "该模式单位不能攻击：%s" % id)
		if state.get("combatAttackers", []).has(id) and not overrun:
			return Result.failure("combat_attacker_eligible", "该单位本回合已参战：%s" % id)
		if str(cursor.get("phase", "")) == "exploitation" and unit.get("released", false) != true \
				and (unit.get("exploit", false) != true or airlifted.has(id)):
			return Result.failure("combat_attacker_eligible", "未释放预备不能在 exploitation 攻击：%s" % id)
		if TerrainCost.step_cost(map_graph, str(unit.get("hex", "")), target,
				str(unit.get("mobility", "truck")), weather) == null:
			return Result.failure("combat_attacker_path", "攻方单位无路可达目标格：%s" % id)
	var defenders: Array = []
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if unit.get("combat") == true and str(unit.get("side", "")) != actor and str(unit.get("hex", "")) == target:
			defenders.append(id)
	if defenders.is_empty():
		return Result.failure("combat_defender_empty", "目标格没有守方战斗单位")
	var hedgehog: Variant = _hedgehog_level(state, target, board)
	var ledger := SupplyPayment.new(state, actor, data)
	var supply: Dictionary = CombatSupply.attack_with_supply(state, ledger, attackers,
		action.get("payments", []), action.get("internalUnitIds", []))
	if not supply.ok:
		return supply
	var held := _held_at_start(state)
	var settled: Dictionary = ledger.settle(supply.value.units)
	var action_kind: Variant = action.get("kind")
	var combat := {
		"target": target, "attacker": actor, "attackers": attackers, "defenders": defenders,
		"hedgehog": hedgehog, "heldAtStart": held, "step": "defender-supply",
	}
	if action_kind != null:
		combat["kind"] = action_kind
	var next := state.duplicate(true)
	next["units"] = settled.get("units", state.get("units", {}))
	next["dumps"] = settled.get("dumps", state.get("dumps", {}))
	next["combat"] = combat
	next["overrunMarch"] = null
	next["combatTargets"] = combat_targets.duplicate()
	if not overrun:
		next.combatTargets.append(target)
		next["combatAttackers"] = state.get("combatAttackers", []).duplicate()
		for id: String in attackers:
			next.combatAttackers.append(id)
	else:
		next["combatAttackers"] = state.get("combatAttackers", []).duplicate()
	return Result.success(next)


## 第二步·守方补给（defend-combat）：守方按整堆口径付盘上补给或消耗内部库存。
static func defend(state: Dictionary, actor: String, action: Dictionary, data: Dictionary,
		_board: Dictionary = {}) -> Dictionary:
	var combat: Variant = state.get("combat")
	if combat == null or str(combat.get("step", "")) != "defender-supply" \
			or actor == str(combat.get("attacker", "")):
		return Result.failure("combat_defender_turn", "当前不是守方补给窗口")
	var ledger := SupplyPayment.new(state, actor, data)
	var internal: Array = action.get("internalUnitIds", [])
	var supply: Dictionary = CombatSupply.defend_with_supply(state, ledger, combat.get("defenders", []),
		action.get("payments", []), internal)
	if not supply.ok:
		return supply
	var settled: Dictionary = ledger.settle(supply.value.units)
	var next_combat: Dictionary = combat.duplicate(true)
	next_combat["defenseSupplied"] = supply.value.supplied
	next_combat["defenseInternalUnits"] = internal.duplicate()
	next_combat["step"] = "attacker-rating"
	var next := state.duplicate(true)
	next["units"] = settled.get("units", state.get("units", {}))
	next["dumps"] = settled.get("dumps", state.get("dumps", {}))
	next["combat"] = next_combat
	return Result.success(next)


## 第三步/第四步·选择行动值单位（select-combat-rating）：攻方先选，守方后选。
static func select_rating(state: Dictionary, actor: String, id: String) -> Dictionary:
	var combat: Variant = state.get("combat")
	if combat == null:
		return Result.failure("combat_missing", "当前没有进行中的战斗")
	var next_combat: Dictionary = combat.duplicate(true)
	if str(combat.get("step", "")) == "attacker-rating" and actor == str(combat.get("attacker", "")) \
			and combat.get("attackers", []).has(id):
		next_combat["attackerLeader"] = id
		next_combat["step"] = "defender-rating"
	elif str(combat.get("step", "")) != "defender-rating" or actor == str(combat.get("attacker", "")) \
			or not combat.get("defenders", []).has(id):
		return Result.failure("combat_rating_order", "须按攻方→守方顺序选择行动值单位")
	else:
		next_combat["defenderLeader"] = id
		next_combat["step"] = "defender-terrain"
	var next := state.duplicate(true)
	next["combat"] = next_combat
	return Result.success(next)


## 第五步·守方选择战斗地形（choose-combat-terrain）：算双方强度、掷骰取表并落到战斗记录。
## 掷骰按 TS 顺序消耗本局 rng：surprise(2d6) → shift(1d6，仅极端时) → combat(2d6)。
static func choose_terrain(state: Dictionary, actor: String, action: Dictionary, data: Dictionary,
		board: Dictionary = {}, offer: Dictionary = {}) -> Dictionary:
	var combat: Variant = state.get("combat")
	if combat == null:
		return Result.failure("combat_missing", "当前没有进行中的战斗")
	if str(combat.get("step", "")) != "defender-terrain" or actor == str(combat.get("attacker", "")) \
			or combat.get("attackerLeader") == null or combat.get("defenderLeader") == null:
		return Result.failure("combat_terrain_order", "当前不是守方选地形窗口")
	var map_graph: Dictionary = data.get("view", {}).get("mapGraph", {})
	var terrains: Array = map_graph.get("terrains", {}).get(combat.get("target", ""), [])
	var terrain := str(action.get("terrain", ""))
	if not terrains.has(terrain):
		return Result.failure("combat_terrain_choice", "该格没有此地形：%s" % terrain)
	var attacking_terrain: Dictionary = action.get("attackingTerrain", {})
	var origins: Array = []
	for id: String in combat.get("attackers", []):
		var unit: Dictionary = state.get("units", {}).get(id, {})
		if not origins.has(unit.get("hex", "")):
			origins.append(unit.get("hex", ""))
	for from: String in origins:
		var selected: Variant = attacking_terrain.get(from)
		if selected == null:
			return Result.failure("combat_attack_terrain", "须为每个攻方原点选择进攻地形")
		if terrains.has(str(selected)):
			continue
		var edge: Variant = TerrainCost.edge_between(map_graph, from, str(combat.get("target", "")))
		var river: Variant = edge.get("river") if edge is Dictionary else null
		if river != null and str(selected) == "%s-river" % str(river):
			continue
		return Result.failure("combat_attack_terrain", "进攻地形与边界河流不符：%s" % from)
	var frozen := str(state.get("turn", {}).get("weather", {}).get("ground", "")) == "freeze"
	var anti_tank := 2 if int(combat.get("hedgehog", 0)) > 0 else 0
	for id: String in combat.get("defenders", []):
		var defender: Dictionary = state.get("units", {}).get(id, {})
		anti_tank = maxi(anti_tank, int(defender.get("antiTank", 0)))
	var attack := 0.0
	for id: String in combat.get("attackers", []):
		var attacker: Dictionary = state.get("units", {}).get(id, {})
		attack += CombatTerrain.combat_strength(_facts(attacker, true,
			str(attacking_terrain.get(attacker.get("hex", ""), terrain)), frozen, true, anti_tank))
	var defend := 0.0
	var internal_units: Array = combat.get("defenseInternalUnits", [])
	for id: String in combat.get("defenders", []):
		var defender_unit: Dictionary = state.get("units", {}).get(id, {})
		var supplied: bool = combat.get("defenseSupplied", false) == true or internal_units.has(id)
		defend += CombatTerrain.combat_strength(_facts(defender_unit, false, terrain, frozen, supplied, 0))
	var attacker_leader: Dictionary = state.get("units", {}).get(str(combat.get("attackerLeader", "")), {})
	var defender_leader: Dictionary = state.get("units", {}).get(str(combat.get("defenderLeader", "")), {})
	var modifier := CombatTerrain.combat_rating(attacker_leader) - CombatTerrain.combat_rating(defender_leader)
	var rolls := CombatRolls.new(state.get("rng", {}), offer)
	var roll: Dictionary = CombatResult.roll_combat(board.get("table", {}),
		CombatTerrain.combat_terrain_category(terrain), attack, defend,
		modifier, int(combat.get("hedgehog", 0)), rolls, combat.get("kind") == "overrun")
	if not roll.ok:
		return roll
	var units: Dictionary = state.get("units", {}).duplicate(true)
	var roll_value: Dictionary = roll.value
	if roll_value.get("disorganize", false) == true:
		_disorganize_hex(units, str(combat.get("target", "")), actor)
	elif int(roll_value.get("defender", {}).get("loss", 0)) > 0 \
			or int(roll_value.get("defender", {}).get("option", 0)) > 0:
		for id: String in combat.get("defenders", []):
			if units.has(id):
				var cleared: Dictionary = units[id].duplicate(true)
				cleared.erase("reserve")
				units[id] = cleared
	var next_combat: Dictionary = combat.duplicate(true)
	next_combat["roll"] = roll_value
	next_combat["step"] = "attacker-result"
	var next := state.duplicate(true)
	next["units"] = units
	next["combat"] = next_combat
	next["rng"] = rolls.rng
	return Result.success(next)


## 待决窗口投影（scorpionPendingCombatDecision）；其他待决态（重掷/夺取/空中任务/炮击/机场容量）优先。
static func pending_decision(state: Dictionary) -> Variant:
	if state.get("combat") == null or state.get("reroll") != null or state.get("capture") != null \
			or state.get("airMission") != null or state.get("barrage") != null \
			or state.get("airfieldCapacityChoice") != null:
		return null
	return decision(state.combat)


## 战斗窗口字典（scorpionCombatDecision）：step → 责任方与动作类型。
static func decision(combat: Dictionary) -> Dictionary:
	var kind: String = str(combat.get("kind", "regular"))
	if combat.get("retreat") != null:
		return {"kind": kind, "target": combat.get("target"), "step": "retreat",
			"actor": combat.get("retreat", {}).get("side"), "actionType": "continue-combat-retreat"}
	var attacker: String = str(combat.get("attacker", ""))
	var step := str(combat.get("step", ""))
	match step:
		"attacker-result":
			return {"kind": kind, "target": combat.get("target"), "step": step, "actor": attacker,
				"actionType": "resolve-combat"}
		"defender-result":
			return {"kind": kind, "target": combat.get("target"), "step": step, "actor": _opponent(attacker),
				"actionType": "resolve-combat"}
		"advance":
			return {"kind": kind, "target": combat.get("target"), "step": step, "actor": attacker,
				"actionType": "advance-after-combat"}
		"defender-supply":
			return {"kind": kind, "target": combat.get("target"), "step": step, "actor": _opponent(attacker),
				"actionType": "defend-combat"}
		"attacker-rating":
			return {"kind": kind, "target": combat.get("target"), "step": step, "actor": attacker,
				"actionType": "select-combat-rating"}
		"defender-rating":
			return {"kind": kind, "target": combat.get("target"), "step": step, "actor": _opponent(attacker),
				"actionType": "select-combat-rating"}
		"defender-terrain":
			return {"kind": kind, "target": combat.get("target"), "step": step, "actor": _opponent(attacker),
				"actionType": "choose-combat-terrain"}
	return {}


static func _facts(unit: Dictionary, attacking: bool, terrain: String, frozen: bool,
		supplied: bool, enemy_anti_tank: int) -> Dictionary:
	var artillery: Variant = unit.get("artillery")
	var artillery_division: bool = artillery is Dictionary and artillery.get("independentRe") == true
	return {"attacking": attacking, "terrain": terrain, "frozen": frozen, "supplied": supplied,
		"enemyAntiTank": enemy_anti_tank, "combatClass": str(unit.get("combatClass", "other")),
		"strength": int(unit.get("strength", 0)), "printedRe": int(unit.get("printedRe", 0)),
		"stepsLost": int(unit.get("stepsLost", 0)), "antiTank": int(unit.get("antiTank", 0)),
		"outOfSupply": unit.get("outOfSupply", false) == true, "artilleryDivision": artillery_division,
		"attackFactor": 1.0, "defenseFactor": 1.0}


static func _held_at_start(state: Dictionary) -> Dictionary:
	var held := {"axis": [], "soviet": []}
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if unit.get("combat") != true:
			continue
		var side := str(unit.get("side", ""))
		if held.has(side):
			held[side].append(unit.get("hex", ""))
	return held


## scorpion-ground-activity.ts：只认同一 回合/席位/阶段 的活动记录，过期记录一律忽略。
static func _airlifted(state: Dictionary) -> Array:
	return GroundActivity.airlifted(state)


static func _hedgehog_level(state: Dictionary, target: String, board: Dictionary) -> Variant:
	var hedgehogs: Dictionary = state.get("hedgehogs", {})
	if hedgehogs.has(target):
		# TS 在工事被削到 0 级时留 null 条目；null 等价 0 级，不能当字典取 level。
		var entry: Variant = hedgehogs[target]
		return int(entry.get("level", 0)) if entry is Dictionary else 0
	var hedgehog_at: Variant = board.get("hedgehogAt")
	if hedgehog_at is Callable:
		return hedgehog_at.call(target)
	return 0


## exploitation 阶段收尾检查：预备单位不得留在工事格；目标格堆叠不得超限。
static func _assert_movement_end(state: Dictionary, actor: String, board: Dictionary = {}) -> Dictionary:
	var reserve_hexes: Array = []
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if str(unit.get("side", "")) != actor or unit.get("reserve") == null:
			continue
		var hex := str(unit.get("hex", ""))
		if not reserve_hexes.has(hex):
			reserve_hexes.append(hex)
	for hex: String in reserve_hexes:
		# 0 级（含 TS 的 null 条目）不算工事格。
		if int(_hedgehog_level(state, hex, board)) > 0:
			return Result.failure("reserve_hedgehog", "预备单位不能留在工事格：%s" % hex)
	var illegal: Array = Stacking.overstacked_hexes(state, actor)
	if not illegal.is_empty():
		return Result.failure("stacking_limit", "移动收尾存在超堆叠格")
	return Result.success({})


## DG：本格本方战斗单位转失序（解除预备、exploit 与进击评级）；有机卡车预备解除预备。
static func _disorganize_hex(units: Dictionary, hex_id: String, actor: String) -> void:
	for id: String in units:
		var unit: Dictionary = units[id]
		if str(unit.get("side", "")) != actor or str(unit.get("hex", "")) != hex_id:
			continue
		var next: Dictionary = unit.duplicate(true)
		if next.get("combat") == true:
			next["disorganized"] = true
			next.erase("reserve")
			next["exploit"] = false
			next.erase("exploitRating")
		elif next.get("organicTruck") != null and next.get("reserve") != null:
			next.erase("reserve")
		units[id] = next


static func _opponent(side: String) -> String:
	return "soviet" if side == "axis" else "axis"


static func _hex_id(source: String) -> String:
	var match := RegEx.create_from_string("^s(\\d+)\\.(\\d{1,2})$").search(source)
	if match == null:
		return source
	return "s%s.%s" % [match.get_string(1), match.get_string(2).pad_zeros(2)]
