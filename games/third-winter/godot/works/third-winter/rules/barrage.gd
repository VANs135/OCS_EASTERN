extends RefCounted

## 第三冬地面炮兵炮击（OCS 10.0 / TTW 2.2f）。
## 移植自 games/third-winter/src/match/scorpion-barrage.ts 的普通地面炮兵炮击路径：
## `declare-artillery-barrage` / `choose-barrage-terrain` / `assign-barrage-loss` 三个动作。
## 本切片不含：空中炮击（scorpion-air-barrage.ts）、机场炮击（scorpion-airfield-barrage.ts）、
## 前沿炮击（declare-front-barrage / ScorpionFrontBarrage）。

const Result := preload("res://scripts/core/result.gd")
const Rng := preload("res://scripts/core/rng.gd")
const Modes := preload("res://scripts/rules/series/modes.gd")
const CombatTerrain := preload("res://works/third-winter/rules/combat_terrain.gd")
const SpPayment := preload("res://works/third-winter/rules/sp_payment.gd")
const StepLoss := preload("res://scripts/rules/series/step_loss.gd")
const Stacking := preload("res://works/third-winter/rules/stacking.gd")

const DEFAULT_TABLE_REL := "../../../dist/ocs-v43-barrage.json"
## OCS v4.3 通规：地面炮兵可在反应 / 战斗 / 追击阶段开火（series fire-timing.ts）。
const ARTILLERY_PHASES := ["reaction", "combat", "exploitation"]


# ---------- 公开入口 ----------

## 与 src/match/scorpion-barrage.ts `applyScorpionBarrage` 对齐。
## 成功返回 Result.success(新状态字典)；拒绝返回 Result.failure(errorCode, errorMessage)。
static func apply(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var action_type := str(action.get("type", ""))
	match action_type:
		"declare-artillery-barrage":
			return _declare(state, actor, action, data)
		"choose-barrage-terrain", "assign-barrage-loss":
			return _respond(state, actor, action, data)
		_:
			return Result.failure("barrage_unsupported", "该炮击动作尚未接入本切片")


## src/match/scorpion-barrage.ts `targetUnits`：目标格内本方指定阵营的战斗算子。
static func target_units(state: Dictionary, side: String, at: String) -> Array:
	var result: Array = []
	for unit_id: String in state.get("units", {}):
		var unit: Dictionary = state.units[unit_id]
		if unit.get("combat") == true and str(unit.get("side")) == side and str(unit.get("hex")) == at:
			result.append([unit_id, unit])
	return result


## 只读预览：复用声明资格核查与齐射强度/列位/费用计算，供菜单草案列出合格炮兵与费用；不改盘面。
static func volley_preview(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var fired: Array = _phase_battery_history(state)
	var target := _hex_id(str(action.get("target", "")))
	return _prepare_barrage(state, actor, action, data, fired, target)


## src/match/scorpion-barrage.ts `hasScorpionBarrageSpotter`：目标格邻格内有本方战斗算子。
static func has_spotter(state: Dictionary, side: String, target: String, data: Dictionary) -> bool:
	var graph: Dictionary = data.view.get("mapGraph", {})
	var near: Array = graph.get("neighbors", {}).get(target, [])
	for unit_id: String in state.get("units", {}):
		var unit: Dictionary = state.units[unit_id]
		if unit.get("combat") == true and str(unit.get("side")) == side and near.has(str(unit.get("hex"))):
			return true
	return false


# ---------- 声明炮击 ----------

static func _declare(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var cursor: Dictionary = state.get("cursor", {})
	var phase := str(cursor.get("phase"))
	var defender := "soviet" if actor == "axis" else "axis"
	var target := _hex_id(str(action.get("target", "")))
	if target == "":
		return Result.failure("barrage_target", "炮击目标格号无效")
	var target_exists := target_units(state, defender, target).size() > 0
	var busy: bool = state.get("barrage") != null or state.get("combat") != null \
		or (state.get("combatTargets", []) as Array).size() > 0
	var regular: Dictionary = _regular_targets(state)
	if busy or _acting_side(cursor) != actor or not _allows_source(phase, "artillery") \
		or not _map_has_hex(data, target) or not target_exists or regular.has(target):
		return Result.failure("barrage_phase", "炮兵每阶段只能在常规战斗前炮击一次敌方目标")
	# OCS 5.11 / assertScorpionMovementEnd：非战斗阶段收口前先核堆叠（刺猬核查 08 无刺猬）。
	if phase != "combat":
		var stacked := Stacking.assert_phase_stacking(state, actor)
		if not stacked.ok:
			return stacked
	var fired: Array = _phase_battery_history(state)
	var prepared := _prepare_barrage(state, actor, action, data, fired, target)
	if not prepared.ok:
		return prepared
	var barrage: Dictionary = prepared.value
	var cost := int(barrage.get("cost", 0))
	var batteries: Array = barrage.get("batteries", [])
	var supply: Dictionary = action.get("supply", {})
	var payments: Array = supply.get("payments", [])
	var total := _total_tokens(payments)
	var dump_ids := {}
	for row: Dictionary in payments:
		dump_ids[str(row.get("dumpId", ""))] = true
	var direct_multi: bool = str(supply.get("kind")) == "direct" and batteries.size() > 1 \
		and dump_ids.size() != 1
	if total != cost or direct_multi:
		return Result.failure("barrage_supply", "初始列位费用须经共同 HQ 或同一个补给堆支付")
	var ledger := SpPayment.new(state, actor, data)
	var method := {}
	if str(supply.get("kind")) == "hq":
		method = {"headquartersId": str(supply.get("hqId", ""))}
	var permitted := func(row: Dictionary) -> bool:
		var dump_id := str(row.get("dumpId", ""))
		for battery: Dictionary in batteries:
			var unit: Dictionary = state.get("units", {}).get(str(battery.get("unitId", "")), {})
			if not ledger.can_use(unit, dump_id, method):
				return false
		return true
	var spent := ledger.spend(payments, permitted)
	if not spent.ok:
		return Result.failure("barrage_supply", str(spent.get("errorMessage", "")))
	var settled: Dictionary = ledger.settle(state.get("units", {}))
	var paid := state.duplicate(true)
	paid.units = settled.units
	paid.dumps = settled.dumps
	paid.barrage = barrage
	return Result.success(paid)


## src/match/scorpion-barrage.ts `prepareBarrage`：资格核查、齐射强度合计与列位/费用。
static func _prepare_barrage(state: Dictionary, actor: String, action: Dictionary, data: Dictionary,
		fired: Array, target: String) -> Dictionary:
	var cursor: Dictionary = state.get("cursor", {})
	var phase := str(cursor.get("phase"))
	var activity := _activity(state)
	var volley_batteries: Array = action.get("batteries", [])
	if volley_batteries.is_empty():
		return Result.failure("barrage_battery", "选择一枚或多枚不同的炮兵算子")
	var ids := {}
	for battery: Dictionary in volley_batteries:
		var bid := str(battery.get("unitId", ""))
		if ids.has(bid):
			return Result.failure("barrage_battery", "炮兵算子不得重复选择")
		ids[bid] = true
	var facts: Array = []
	for battery: Dictionary in volley_batteries:
		var bid := str(battery.get("unitId", ""))
		var unit: Dictionary = state.get("units", {}).get(bid, {})
		var face: Variant = unit.get("artillery")
		var mode: Dictionary = Modes.ground_mode_effect(_ground_state(unit))
		var eligible: bool = not unit.is_empty() and str(unit.get("side")) == actor \
			and mode.get("canBarrage", true) == true and face != null \
			and int(face.get("strength", 0)) > 0 and int(face.get("range", 0)) > 0 \
			and str(unit.get("hex")) != target \
			and _hex_distance(str(unit.get("hex")), target) <= int(face.get("range"))
		# 阶段资格：反应阶段须已释放；追击阶段未释放时须为 exploit 且非空运；移动面/混乱不得炮击。
		if phase == "reaction" and unit.get("released") != true:
			eligible = false
		if phase == "exploitation" and unit.get("released") != true \
			and (unit.get("exploit") != true or activity.airlifted.has(bid)):
			eligible = false
		if phase == "movement" and (unit.get("moveMode") == true or unit.get("disorganized") == true):
			eligible = false
		if not eligible:
			return Result.failure("barrage_battery", "选择射程内合格的炮兵算子")
		var used_re := 0
		for fb: Dictionary in fired:
			if str(fb.get("unitId")) == bid:
				used_re += int(fb.get("re", 0))
		facts.append({
			"id": bid, "strength": int(face.get("strength", 0)),
			"printedRe": int(unit.get("printedRe", 0)),
			"independentRe": face.get("independentRe") == true,
			"remainingSteps": StepLoss.remaining(unit), "usedRe": used_re,
			"barrageFactor": float(mode.get("barrageFactor", 1)),
			"firingRe": battery.get("re"),
		})
	var volley := _volley_strength(facts)
	if not volley.ok:
		return volley
	var strength: float = volley.value.strength
	var batteries: Array = []
	for fired_battery: Dictionary in volley.value.batteries:
		batteries.append({"unitId": fired_battery.get("id"), "re": fired_battery.get("re")})
	var table := _table(data)
	var column := _barrage_column(table, strength)
	if not column.ok:
		return column
	var hedgehog := _hedgehog_level(state, target)
	if hedgehog < 0 or hedgehog > 4:
		return Result.failure("barrage_battery", "刺猬等级无效")
	var barrage := {
		"target": target, "defender": "soviet" if actor == "axis" else "axis",
		"batteries": batteries, "strength": strength,
		"initialColumn": column.value.initialColumn, "cost": column.value.cost,
		"hedgehog": hedgehog,
	}
	return Result.success(barrage)


# ---------- 被炮击方应答 ----------

static func _respond(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var barrage: Variant = state.get("barrage")
	if barrage == null or str(actor) != str(barrage.get("defender")):
		return Result.failure("barrage_pending", "由被炮击方应答本次炮击")
	var action_type := str(action.get("type"))
	if action_type == "choose-barrage-terrain":
		if barrage.get("roll") != null:
			return Result.failure("barrage_terrain", "炮击地形已经结算")
		return _settle_terrain(state, actor, barrage, str(action.get("terrain", "")), data)
	return _assign_loss(state, actor, barrage, action, data)


## src/match/scorpion-barrage.ts `settleTerrain`：掷炮击表、定损失、写炮击历史。
static func _settle_terrain(state: Dictionary, actor: String, barrage: Dictionary, terrain: String,
		data: Dictionary) -> Dictionary:
	var graph: Dictionary = data.view.get("mapGraph", {})
	var target := str(barrage.get("target", ""))
	var hex_terrains: Array = graph.get("terrains", {}).get(target, [])
	if not hex_terrains.has(terrain):
		return Result.failure("barrage_terrain", "选择目标格内印刷的地形")
	var defenders := target_units(state, actor, target)
	var density_units: Array = []
	for entry: Array in defenders:
		var unit: Dictionary = entry[1]
		density_units.append({"re": int(unit.get("printedRe", 0)) - int(unit.get("stepsLost", 0)),
			"formation": str(unit.get("formation", ""))})
	var density := _barrage_density(density_units)
	var attacker := "soviet" if actor == "axis" else "axis"
	var spotter := has_spotter(state, attacker, target, data)
	var table := _table(data)
	var category := CombatTerrain.combat_terrain_category(terrain)
	var rolled := _roll_ground_barrage(table, int(barrage.get("initialColumn", 0)), {
		"density": density, "hedgehog": int(barrage.get("hedgehog", 0)), "terrain": category,
		"spotter": spotter, "air": barrage.get("air"), "dieModifier": 0,
	}, state.get("rng", {}))
	if not rolled.ok:
		return rolled
	var roll: Dictionary = rolled.value.roll
	var units: Dictionary = state.units.duplicate(true)
	if roll.get("disorganize") == true:
		_disorganize(units, target, actor)
	var remaining_total := 0
	for entry: Array in defenders:
		remaining_total += StepLoss.remaining(entry[1])
	var losses_due := mini(int(roll.get("loss", 0)), remaining_total)
	var result: Dictionary = barrage.duplicate(true)
	result["roll"] = roll
	result["lossesDue"] = losses_due
	# lossCandidates 仅空中 tank-buster 产生；地面炮击不筛选候选单位。
	var cursor: Dictionary = state.get("cursor", {})
	var history: Array = state.get("barrageHistory", []).duplicate()
	var record: Dictionary = result.duplicate(true)
	record["turn"] = int(cursor.get("turn", 0))
	record["phasing"] = str(cursor.get("phasing", ""))
	record["phase"] = str(cursor.get("phase", ""))
	record["terrain"] = terrain
	history.append(record)
	var settled := state.duplicate(true)
	settled.units = units
	settled.rng = rolled.value.rng
	settled.barrage = result
	settled.barrageHistory = history
	if losses_due > 0:
		return Result.success(settled)
	return Result.success(_finish_barrage(settled))


## src/match/scorpion-barrage.ts `assign-barrage-loss` 分支：分配校验后走 step_loss 落地。
static func _assign_loss(state: Dictionary, actor: String, barrage: Dictionary, action: Dictionary,
		data: Dictionary) -> Dictionary:
	var losses_due: Variant = barrage.get("lossesDue")
	var allocation: Array = action.get("allocation", [])
	var ids := {}
	var total := 0
	for row: Dictionary in allocation:
		var uid := str(row.get("unitId", ""))
		if ids.has(uid):
			return Result.failure("barrage_allocation", "同一单位不得重复分配")
		ids[uid] = true
		total += int(row.get("steps", 0))
	if losses_due == null or total != int(losses_due):
		return Result.failure("barrage_allocation", "须恰好分配强制炮击损失")
	var defenders := {}
	for entry: Array in target_units(state, actor, str(barrage.get("target", ""))):
		defenders[entry[0]] = entry[1]
	var allocation_map := {}
	for row: Dictionary in allocation:
		var uid := str(row.get("unitId", ""))
		var steps := int(row.get("steps", 0))
		var unit: Dictionary = defenders.get(uid, {})
		if unit.is_empty() or steps < 1 or steps > StepLoss.remaining(unit):
			return Result.failure("barrage_allocation", "只能由目标格内的战斗单位承受炮击损失")
		allocation_map[uid] = steps
	var settled := state.duplicate(true)
	var applied := StepLoss.apply(settled, allocation_map, data)
	if not applied.ok:
		return applied
	return Result.success(_finish_barrage(settled))


## src/match/scorpion-barrage.ts `finishBarrage`：无前沿炮击轮转时清空待决炮击。
static func _finish_barrage(state: Dictionary) -> Dictionary:
	state.barrage = null
	return state


# ---------- 炮击表（series/tables/barrage.ts） ----------

static func _barrage_column(table: Dictionary, strength: float) -> Dictionary:
	if not is_finite(strength) or strength < 1:
		return Result.failure("barrage_table", "炮击强度至少为 1 点")
	var columns: Array = table.get("columns", [])
	var idx := _match_row_index(columns, int(roundi(strength)))
	if idx < 0:
		return Result.failure("barrage_table", "炮击强度无匹配列位")
	var costs: Array = table.get("costs", [])
	var cost: int = int(costs[idx]) if idx < costs.size() else 0
	if cost <= 0:
		return Result.failure("barrage_table", "炮击表补给费用无效")
	return Result.success({"initialColumn": idx, "cost": cost})


## series/tables/barrage.ts `barrageDensity`：同编队 RE 合并，单列封顶 3。
static func _barrage_density(units: Array) -> int:
	var formations := {}
	var total := 0
	for entry: Dictionary in units:
		var re := int(entry.get("re", 0))
		var formation := str(entry.get("formation", ""))
		if formation != "":
			formations[formation] = int(formations.get(formation, 0)) + re
		else:
			total += mini(re, 3)
	for re: int in formations.values():
		total += mini(re, 3)
	return total


## series/tables/barrage.ts `barrageVolleyStrength`：独立 RE 炮兵按实射 RE/印刷 RE 折算强度。
static func _volley_strength(batteries: Array) -> Dictionary:
	var strength := 0.0
	var fired: Array = []
	for battery: Dictionary in batteries:
		var remaining: int = (int(battery.get("remainingSteps", 0)) if battery.get("independentRe") == true \
			else 1) - int(battery.get("usedRe", 0))
		var firing: Variant = battery.get("firingRe")
		var firing_re: int = remaining if firing == null else int(firing)
		if firing_re < 1 or firing_re > remaining:
			return Result.failure("barrage_battery", "选择未使用过的可用炮兵 RE")
		var divisor: int = int(battery.get("printedRe", 1)) if battery.get("independentRe") == true else 1
		strength += float(battery.get("strength", 0)) * float(firing_re) / float(divisor) \
			* float(battery.get("barrageFactor", 1))
		fired.append({"id": battery.get("id"), "re": firing_re})
	return Result.success({"strength": strength, "batteries": fired})


## series/tables/barrage.ts `rollGroundBarrage`：修正列位、掷骰、定代码/损失/混乱。
static func _roll_ground_barrage(table: Dictionary, initial_column: int, facts: Dictionary,
		rng_state: Dictionary) -> Dictionary:
	var density: int = int(facts.get("density", 0))
	var hedgehog: int = int(facts.get("hedgehog", 0))
	var terrain := str(facts.get("terrain", ""))
	var spotter: bool = facts.get("spotter", false) == true
	var air: Variant = facts.get("air")
	var die_modifier := int(facts.get("dieModifier", 0))
	var density_shift: float
	if density <= 1:
		density_shift = -1.0
	elif density <= 3:
		density_shift = 0.0
	else:
		density_shift = minf(ceil(float(density)) - 3.0, 4.0)
	var terrain_shift: float
	if terrain == "Open":
		terrain_shift = 0.0
	elif terrain == "Extr Close":
		terrain_shift = -2.0
	else:
		terrain_shift = -1.0
	var hedgehog_shift: float = -1.0 if hedgehog > 0 else 0.0
	var spotter_shift: float = 0.0 if spotter else -3.0
	var strategic_shift: float = 3.0 if facts.get("strategicTarget") == true else 0.0
	var shift_sum := int(roundi(density_shift + terrain_shift + hedgehog_shift + spotter_shift \
		+ strategic_shift))
	var columns: Array = table.get("columns", [])
	var column := clampi(initial_column + shift_sum, 0, columns.size() - 1)
	var dice_draw := Rng.roll_dice(rng_state, 2)
	if not dice_draw.ok:
		return dice_draw
	var dice: Array = dice_draw.value.value.faces
	var rng_next: Dictionary = dice_draw.value.rng
	var adjusted := clampi(int(dice[0]) + int(dice[1]) + die_modifier, 2, 12)
	var matrix: Array = table.get("matrix", [])
	var row: Array = matrix[adjusted - 2]
	if not row is Array or column < 0 or column >= row.size():
		return Result.failure("barrage_table", "炮击表行列越界")
	var printed_code := str(row[column])
	var overrides: Variant = facts.get("resultOverrides")
	var code := printed_code
	if overrides != null and overrides is Dictionary and overrides.has(printed_code):
		code = str(overrides.get(printed_code))
	var need_half: bool = code == "1/2" or (code == "[1/2]" and air == null and hedgehog < 3 and spotter)
	var half_die: Variant = null
	if need_half:
		var half := Rng.roll_die(rng_next)
		if not half.ok:
			return half
		half_die = int(half.value.value)
		rng_next = half.value.rng
	var loss: int
	if half_die != null:
		loss = 1 if int(half_die) >= 4 else 0
	elif code == "1" or code == "2" or code == "3":
		loss = int(code)
	else:
		loss = 0
	var roll := {
		"code": code, "column": column,
		"shifts": {"density": density_shift, "terrain": terrain_shift, "hedgehog": hedgehog_shift,
			"spotter": spotter_shift, "strategicTarget": strategic_shift},
		"dice": dice, "halfDie": half_die, "loss": loss,
		"disorganize": code != "-",
	}
	return Result.success({"roll": roll, "rng": rng_next})


# ---------- 内部辅助 ----------

static func _acting_side(cursor: Dictionary) -> String:
	var phasing := str(cursor.get("phasing"))
	if str(cursor.get("phase")) != "reaction":
		return phasing
	return "soviet" if phasing == "axis" else "axis"


static func _allows_source(phase: String, source: String) -> bool:
	if source != "artillery":
		return false
	return ARTILLERY_PHASES.has(phase)


static func _phase_battery_history(state: Dictionary) -> Array:
	var result: Array = []
	for entry: Dictionary in _phase_barrages(state):
		for battery: Dictionary in entry.get("batteries", []):
			result.append(battery)
	return result


static func _phase_barrages(state: Dictionary) -> Array:
	var cursor: Dictionary = state.get("cursor", {})
	var history: Array = state.get("barrageHistory", [])
	var result: Array = []
	for entry: Dictionary in history:
		if int(entry.get("turn", -1)) == int(cursor.get("turn", -1)) \
			and str(entry.get("phasing")) == str(cursor.get("phasing")) \
			and str(entry.get("phase")) == str(cursor.get("phase")):
			result.append(entry)
	return result


static func _regular_targets(state: Dictionary) -> Dictionary:
	var targets := {}
	for entry: Dictionary in _phase_barrages(state):
		var air: Variant = entry.get("air")
		var hip: bool = air != null and air.get("hipShoot") == true
		if not hip:
			targets[str(entry.get("target", ""))] = true
	return targets


static func _hedgehog_level(state: Dictionary, hex: String) -> int:
	var hedgehogs: Variant = state.get("hedgehogs")
	if hedgehogs != null and hedgehogs is Dictionary and hedgehogs.has(hex):
		var entry: Variant = hedgehogs[hex]
		if entry != null and entry is Dictionary:
			return int(entry.get("level", 0))
	return 0


static func _disorganize(units: Dictionary, hex: String, side: String) -> void:
	for unit_id: String in units:
		var unit: Dictionary = units[unit_id]
		if str(unit.get("hex")) != hex or str(unit.get("side")) != side:
			continue
		if unit.get("combat") == true:
			unit["disorganized"] = true
			unit["reserve"] = null
			unit["exploit"] = false
			unit["exploitRating"] = null
			units[unit_id] = unit
		elif unit.has("organicTruck") and unit.get("reserve") == true:
			unit["reserve"] = null
			units[unit_id] = unit


static func _activity(state: Dictionary) -> Dictionary:
	var cursor: Dictionary = state.get("cursor", {})
	var stored: Variant = state.get("groundActivity")
	if stored is Dictionary and int(stored.get("turn", -1)) == int(cursor.get("turn", -1)) \
		and str(stored.get("phasing")) == str(cursor.get("phasing")) \
		and str(stored.get("phase")) == str(cursor.get("phase")):
		var kept: Dictionary = stored.duplicate(true)
		kept.spent = kept.get("spent", {}).duplicate()
		kept.airlifted = kept.get("airlifted", []).duplicate()
		return kept
	return {"turn": int(cursor.get("turn", 0)), "phasing": str(cursor.get("phasing", "")),
		"phase": str(cursor.get("phase", "")), "spent": {}, "airlifted": []}


static func _ground_state(unit: Dictionary) -> Dictionary:
	var marker: Variant = null
	if unit.get("disorganized") == true:
		marker = "dg"
	elif unit.get("reserve") == true:
		marker = "reserve"
	elif unit.get("exploit") == true:
		marker = "exploit"
	return {"face": "move" if unit.get("moveMode") == true else "combat",
		"marker": marker, "released": unit.get("released", false) == true}


static func _total_tokens(payments: Array) -> int:
	var total := 0
	for row: Dictionary in payments:
		total += int(row.get("tokens", 0))
	return total


static func _map_has_hex(data: Dictionary, hex: String) -> bool:
	var graph: Dictionary = data.view.get("mapGraph", {})
	return graph.get("terrains", {}).has(hex)


static func _hex_id(source: String) -> String:
	var match := RegEx.create_from_string("^s(\\d+)\\.(\\d{1,2})$").search(source)
	if match == null:
		return ""
	return "s%s.%s" % [match.get_string(1), match.get_string(2).pad_zeros(2)]


## 与 src/import/hex-id.ts `scorpionHexDistance` 同口径的轴向格距。
static func _hex_distance(from: String, to: String) -> int:
	var from_id := _hex_id(from)
	var to_id := _hex_id(to)
	if from_id == "" or to_id == "":
		return 999
	var from_col := int(from_id.substr(1).split(".")[0])
	var from_row := int(from_id.substr(1).split(".")[1])
	var to_col := int(to_id.substr(1).split(".")[0])
	var to_row := int(to_id.substr(1).split(".")[1])
	var aq := from_col
	var ar := from_row - int(floor(float(from_col - 1) / 2.0))
	var bq := to_col
	var br := to_row - int(floor(float(to_col - 1) / 2.0))
	var q := aq - bq
	var r := ar - br
	return maxi(maxi(absi(q), absi(r)), absi(q + r))


static func _match_row_index(rows: Array, value: int) -> int:
	for index: int in rows.size():
		var range := _numeric_range(str(rows[index]))
		if range.is_empty():
			continue
		if value >= float(range.get("min", 0)) and value <= float(range.get("max", 0)):
			return index
	return -1


static func _numeric_range(label: String) -> Dictionary:
	var number_re := RegEx.create_from_string("^(\\d+)$")
	var range_re := RegEx.create_from_string("^(\\d+)-(\\d+)$")
	var more_re := RegEx.create_from_string("^(\\d+)(?:\\+\\s*|\\s+or\\s+more)$")
	var less_re := RegEx.create_from_string("^(\\d+)\\s+or\\s+less$")
	var found: Variant = number_re.search(label)
	if found:
		return {"min": float(found.get_string(1)), "max": float(found.get_string(1))}
	found = range_re.search(label)
	if found:
		return {"min": float(found.get_string(1)), "max": float(found.get_string(2))}
	found = more_re.search(label)
	if found:
		return {"min": float(found.get_string(1)), "max": INF}
	found = less_re.search(label)
	if found:
		return {"min": -INF, "max": float(found.get_string(1))}
	return {}


static func _table(data: Dictionary) -> Dictionary:
	var override: Variant = data.get("barrageTable")
	if override != null and override is Dictionary:
		return override
	var env: String = OS.get_environment("OCS_V43_BARRAGE")
	var path := env if FileAccess.file_exists(env) else _default_table_path()
	var raw := FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(raw)
	return parsed if parsed is Dictionary else {}


static func _default_table_path() -> String:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	return (base + "/" + DEFAULT_TABLE_REL).simplify_path()
