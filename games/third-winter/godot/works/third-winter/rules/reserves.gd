extends RefCounted

## TTW 08 预备三命令：`mark-reserve` / `leave-reserve` / `release-reserve`。
## 对应 src/match/scorpion-reserves.ts：prepareScorpionReserve（朝向参数 current/combat/move、
## 禁入条件）、leave-reserve 清标记、release-reserve 置 released=true 并按阶段给机动倍率。
## 合法性口径另见 scripts/rules/series/modes.gd 的 can_release_reserve。

const Result := preload("res://scripts/core/result.gd")
const Modes := preload("res://scripts/rules/series/modes.gd")
const SupplyPosition := preload("res://works/third-winter/rules/supply_position.gd")
const GroundModeActions := preload("res://works/third-winter/rules/ground_mode_actions.gd")

const RESERVE_MARKER_LIMIT := 6


## `mark-reserve`：本方合格算子在移动阶段进入预备，可同时指定预备朝向。
static func mark_reserve(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var prepared := _prepare(state, actor, action, data)
	if not prepared.ok:
		return prepared
	var unit_id: String = str(action.get("unitId", ""))
	var oriented: Dictionary = prepared.value.duplicate(true)
	oriented["reserve"] = unit_id
	var next_units: Dictionary = state.get("units", {}).duplicate(true)
	next_units[unit_id] = oriented
	state.units = next_units
	if _reserve_hexes(next_units, actor).size() > RESERVE_MARKER_LIMIT:
		return Result.failure("reserve_capacity", "本方预备标记已用完")
	return Result.success(state)


## `leave-reserve`：清除预备标记；可借该命令重选朝向。
static func leave_reserve(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var unit_id: String = str(action.get("unitId", ""))
	var units: Dictionary = state.get("units", {})
	var unit: Dictionary = units.get(unit_id, {})
	if unit.is_empty() or unit.get("reserve") == null:
		return Result.failure("reserve_not_reserve", "请选择处于预备的算子")
	var prepared := _prepare(state, actor, action, data)
	if not prepared.ok:
		return prepared
	var oriented: Dictionary = prepared.value.duplicate(true)
	oriented["reserve"] = null
	var next_units: Dictionary = units.duplicate(true)
	next_units[unit_id] = oriented
	state.units = next_units
	return Result.success(state)


## `release-reserve`：反应/进击阶段释放本方预备；置 released=true，返回阶段机动倍率。
static func release_reserve(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	if state.get("kind") != "playing":
		return Result.failure("match_not_started", "请先开始 08 对局")
	if state.get("victory") != null:
		return Result.failure("match_over", "对局已结束")
	var unit_id: String = str(action.get("unitId", ""))
	var units: Dictionary = state.get("units", {})
	var unit: Dictionary = units.get(unit_id, {})
	if unit.is_empty() or str(unit.get("side", "")) != actor or unit.get("reserve") == null:
		return Result.failure("reserve_release", "只能释放本方处于预备的算子")
	if unit.get("disorganized") == true:
		return Result.failure("reserve_release", "混乱算子不能释放预备")
	var cursor: Dictionary = state.get("cursor", {})
	var phase: String = str(cursor.get("phase", ""))
	var acting: String = str(cursor.get("phasing", ""))
	if phase == "reaction":
		acting = "axis" if acting == "soviet" else "soviet"
	if acting != actor:
		return Result.failure("reserve_release", "该方现在不能释放预备")
	if phase != "reaction" and phase != "exploitation":
		return Result.failure("reserve_release", "只能在反应或进击阶段释放预备")
	if phase == "exploitation" and state.get("combatTargets", []).size() > 0:
		return Result.failure("reserve_release", "进击阶段须先结算本轮战斗")
	if unit.get("released", false) == true:
		return Result.failure("reserve_released", "该算子本阶段已经释放过了")
	var verdict: Dictionary = Modes.can_release_reserve({
		"state": _mode_state(unit), "side": actor, "activeSide": str(cursor.get("phasing", "")),
		"phase": phase,
	})
	if not verdict.get("ok", false):
		return Result.failure("reserve_release", str(verdict.get("reason", "预备释放不合法")))
	var next_unit: Dictionary = unit.duplicate(true)
	next_unit["reserve"] = null
	next_unit["released"] = true
	var next_units: Dictionary = units.duplicate(true)
	next_units[unit_id] = next_unit
	state.units = next_units
	return Result.success(state)


## prepareScorpionReserve 共用门禁：阶段/席位、合格性、敌 ZOC、朝向与逐面模板。
## 成功 value 为已按朝向投影（尚未写入 reserve 标记）的算子字典。
static func _prepare(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	if state.get("kind") != "playing":
		return Result.failure("match_not_started", "请先开始 08 对局")
	if state.get("victory") != null:
		return Result.failure("match_over", "对局已结束")
	var cursor: Dictionary = state.get("cursor", {})
	if str(cursor.get("phase", "")) != "movement":
		return Result.failure("movement_phase", "预备只能在本方移动阶段进入")
	if str(cursor.get("phasing", "")) != actor:
		return Result.failure("wrong_actor", "该方不能执行预备命令")
	var unit_id: String = str(action.get("unitId", ""))
	var units: Dictionary = state.get("units", {})
	var unit: Dictionary = units.get(unit_id, {})
	var organic: bool = unit.get("organicTruck") != null
	var eligible: bool = unit.get("combat") == true or organic
	var activity: Dictionary = GroundModeActions._activity(state)
	var moved: Array = state.get("moved", [])
	if unit.is_empty() or str(unit.get("side", "")) != actor or not eligible \
			or unit.get("disorganized") == true or unit.get("exploit") == true \
			or moved.has(unit_id) or activity.get("airlifted", []).has(unit_id):
		return Result.failure("reserve_unit", "预备需要本方在移动阶段尚未移动的合格地面算子")
	if unit.get("reserve") == null:
		var zoc: Array = SupplyPosition.enemy_zoc(units, actor, data)
		if SupplyPosition.zoc_affects("reserveMode", zoc.has(str(unit.get("hex", ""))), false):
			return Result.failure("reserve_zoc", "不可在敌方 ZOC 内进入预备模式")
	var face: String = str(action.get("face", "current"))
	if face != "current" and face != "combat" and face != "move":
		return Result.failure("reserve_orientation", "预备朝向只能是当前面、战斗面或移动面")
	if face == "current":
		return Result.success(unit.duplicate(true))
	var projected: Variant = GroundModeActions.project_face(unit, str(unit.get("definition", "")), face, data)
	if projected == null:
		return Result.failure("mode_face_unavailable", "该算子没有印刷的%s朝向" % (
			"移动面" if face == "move" else "战斗面"))
	return Result.success(projected)


## 盘上模式状态，对应 scorpionGroundMode：moveMode→move 面；reserve/dg/exploit 标记。
static func _mode_state(unit: Dictionary) -> Dictionary:
	var marker: Variant = null
	if unit.get("disorganized") == true:
		marker = "dg"
	elif unit.get("reserve") != null:
		marker = "reserve"
	elif unit.get("exploit") == true:
		marker = "exploit"
	return {"face": "move" if unit.get("moveMode") == true else "combat",
		"marker": marker, "released": unit.get("released", false) == true}


static func _reserve_hexes(units: Dictionary, side: String) -> Dictionary:
	var hexes := {}
	for unit_id: String in units:
		var unit: Dictionary = units[unit_id]
		if str(unit.get("side", "")) == side and unit.get("reserve") != null:
			hexes[str(unit.get("hex", ""))] = true
	return hexes
