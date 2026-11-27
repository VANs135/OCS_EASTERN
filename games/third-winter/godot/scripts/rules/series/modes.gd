extends RefCounted

## OCS 通规 5.0–5.10 单位模式数值层与合法性层。
## 移植自 packages/series/src/modes.ts（作品/剧本中立）。
## 数值矩阵、生效模式、移动倍率、朝向翻转之外，本切片补齐矩阵派生判定、状态不变量、
## 阶段可动性、预备释放与模式切换合法性；专规闸门（operationalLimit）作为可选注入谓词。

const Result := preload("res://scripts/core/result.gd")

const BASE_EFFECT := {
	"attackFactor": 1, "defenseFactor": 1, "barrageFactor": 1, "actionRatingModifier": 0,
	"canAttack": true, "canBarrage": true, "canOverrun": true,
}

const MARKER_EFFECTS := {
	"reserve": {"attackFactor": 1, "defenseFactor": 0.5, "barrageFactor": 1, "actionRatingModifier": 0,
		"canAttack": false, "canBarrage": false, "canOverrun": false},
	"strat": {"attackFactor": 0, "defenseFactor": 0, "barrageFactor": 0, "actionRatingModifier": 0,
		"canAttack": false, "canBarrage": false, "canOverrun": false},
	"exploit": {"attackFactor": 1, "defenseFactor": 1, "barrageFactor": 1, "actionRatingModifier": 0,
		"canAttack": true, "canBarrage": true, "canOverrun": true},
	"dg": {"attackFactor": 0.5, "defenseFactor": 0.5, "barrageFactor": 0.5, "actionRatingModifier": -1,
		"canAttack": true, "canBarrage": true, "canOverrun": false},
}


## 基础模式效果（朝向面）。
static func base_effect() -> Dictionary:
	return BASE_EFFECT.duplicate(true)


## 四种层叠标记的效果矩阵（reserve / strat / exploit / dg）。
static func marker_effects() -> Dictionary:
	return MARKER_EFFECTS.duplicate(true)


## 通规 5.7b：已释放的预备视同无标记，效果折回朝向那一面。
static func active_marker(state: Dictionary) -> Variant:
	var marker: Variant = state.get("marker", null)
	if marker == "reserve" and state.get("released", false) == true:
		return null
	return marker


## 通规 5.4a：生效模式（被动标记替代当前模式；无标记即基础面）。
static func effective_mode(state: Dictionary) -> Variant:
	var marker: Variant = active_marker(state)
	return marker if marker != null else state.get("face", null)


## 模式战斗/炮击/AR 数值效果；keepsCombatZoc 与 actionRatingFactor 由矩阵派生。
static func ground_mode_effect(state: Dictionary) -> Dictionary:
	var marker: Variant = active_marker(state)
	var effect: Dictionary
	if marker == null:
		effect = BASE_EFFECT.duplicate(true)
	else:
		effect = MARKER_EFFECTS.get(str(marker), BASE_EFFECT).duplicate(true)
	var face: String = str(state.get("face", "combat"))
	effect["keepsCombatZoc"] = face == "combat" and (marker == null or marker == "exploit")
	effect["actionRatingFactor"] = 0 if marker == "strat" else 1
	return effect


## 单位移动预算倍率。阶段/席位合法性由命令边界校验，本函数只给倍率。
## dg/exploit ×0.5、strat ×2；预备/释放按 reserveMovementFactor 口径。
static func ground_mode_movement_factor(state: Dictionary, phase: String) -> float:
	var marker: Variant = state.get("marker", null)
	var released: bool = state.get("released", false) == true
	if marker == "dg" or marker == "exploit":
		return 0.5
	if marker == "strat":
		return 2.0
	var in_reserve: bool = marker == "reserve" and not released
	return _reserve_movement_factor(phase, in_reserve, released)


## packages/series/src/reserve.ts reserveMovementFactor。
static func _reserve_movement_factor(phase: String, in_reserve: bool, released: bool) -> float:
	if in_reserve:
		return 0.25 if phase == "movement" else 0.0
	if phase == "reaction":
		return 0.5 if released else 0.0
	if phase == "exploitation":
		return 1.0 if released else 0.5
	return 1.0


## 按模式改写单位原始数值（通规 5.5–5.10；减半不取整 6.1h）。
## raw: { attack, ar, ma, barrage? }；barrage 缺省或战略模式时结果不含 barrage 键。
static func resolve_mode_stats(raw: Dictionary, state: Dictionary, phase: String) -> Dictionary:
	var effect: Dictionary = ground_mode_effect(state)
	var marker: Variant = active_marker(state)
	var is_strat: bool = marker == "strat"
	var ma_mult: float = ground_mode_movement_factor(state, phase)
	var attack_value: float = float(raw.get("attack", 0))
	var result := {
		"attack": 0.0 if is_strat else attack_value * float(effect.get("attackFactor", 1)),
		"defense": 0.0 if is_strat else attack_value * float(effect.get("defenseFactor", 1)),
		"ar": 0 if is_strat else int(raw.get("ar", 0)) + int(effect.get("actionRatingModifier", 0)),
		"ma": float(raw.get("ma", 0)) * ma_mult,
		"canAttack": effect.get("canAttack", true),
		"canBarrage": effect.get("canBarrage", true),
		"canOverrun": effect.get("canOverrun", true),
		"exertsZoc": effect.get("keepsCombatZoc", false),
		"disorganized": marker == "dg",
		"maMultiplier": ma_mult,
		"effectiveMode": effective_mode(state),
	}
	var raw_barrage: Variant = raw.get("barrage", null)
	if not is_strat and raw_barrage != null:
		result["barrage"] = float(raw_barrage) * float(effect.get("barrageFactor", 1))
	return result


## 通规 5.4 末句：翻转朝向面；标记与释放时点原样保留。
static func flip_orientation(state: Dictionary) -> Dictionary:
	var next: Dictionary = state.duplicate(true)
	var face: String = str(state.get("face", "combat"))
	next["face"] = "move" if face == "combat" else "combat"
	return next


## 通规 5.4/5.7a/5.8：能否改变朝向。返回 TS 同款判定字典：
## 成功 { ok: true, rule }；失败 { ok: false, rule, reason }。
static func can_flip_orientation(input: Dictionary) -> Dictionary:
	var state: Dictionary = input.get("state", {})
	var phase: String = str(input.get("phase", ""))
	if phase != "movement":
		return {"ok": false, "rule": "5.4", "reason": "改变朝向只能在本方移动阶段进行"}
	var marker: Variant = active_marker(state)
	if marker == "dg":
		return {"ok": true, "rule": "5.4"}
	if marker == "reserve":
		if input.get("enteredReserveThisTurn", false) == true:
			return {"ok": false, "rule": "5.7a", "reason": "本回合刚进入预备，该朝向在下一个移动阶段之前无法再切换"}
		return {"ok": true, "rule": "5.7a"}
	if marker == "strat":
		return {"ok": false, "rule": "5.8", "reason": "战略模式朝向必须是移动面，不可更改"}
	return {"ok": false, "rule": "5.5/5.6", "reason": "战斗/移动模式下朝向即模式本身，改朝向请用模式切换"}


# ── 单位类别（只为模式合法性服务，通规 5.5c/5.6b/5.7f/5.8c/6.1b/13.2d） ──

## 通规类别判定，移植自 modes.ts modeUnitClass。profile 字段：
## noncombatKind / specialized(Array) / ma。
static func mode_unit_class(profile: Dictionary) -> String:
	var kind: String = str(profile.get("noncombatKind", ""))
	if kind in ["sp", "air_base", "hedgehog", "port"]:
		return "facility"
	if kind == "organic_truck":
		return "organicTruck"
	if kind in ["transport_point", "supply_extender"]:
		return "transportPoint"
	var specialized: Array = profile.get("specialized", [])
	if specialized.has("replacement"):
		return "repl"
	return "combat"


# ── 矩阵派生判定（通规 4.5/5.5e/5.9c/5.6a/5.5b/5.10e/5.7g/16.0f/5.8b/12.6e） ──

## 通规 4.5/5.5e/5.9c：是否投射 ZOC（进击保留基础面；DG/预备/战略一律无）。
static func exerts_zoc(state: Dictionary) -> bool:
	return ground_mode_effect(state).get("keepsCombatZoc", false)


## 通规 5.6a：能否铁路/空运/海运（须处于移动模式且无被动标记）。
static func can_use_transport(state: Dictionary) -> bool:
	return active_marker(state) == null and str(state.get("face", "")) == "move"


## 通规 5.5b/5.10e：能否工程/轨距转换（战斗模式；DG 朝向战斗面即可）。
static func can_engineer(state: Dictionary) -> bool:
	var marker: Variant = active_marker(state)
	if marker == "dg":
		return str(state.get("face", "")) == "combat"
	return marker == null and str(state.get("face", "")) == "combat"


## 通规 5.7g/16.0f：预备模式不可与环形工事堆叠。
static func can_stack_with_hedgehog(state: Dictionary) -> bool:
	return active_marker(state) != "reserve"


## 通规 5.8b/12.6e：战略模式必须在有追溯补给的格结束移动。
static func must_end_move_in_supply(state: Dictionary) -> bool:
	return active_marker(state) == "strat"


# ── 模式状态不变量（通规 5.10/5.9/5.8/5.5/5.6/5.10c） ──

## 返回问题编号数组；空数组即状态合法。issue 口径与 modes.ts ModeIssue 一致。
static func validate_mode_state(state: Dictionary, unit_class: String = "") -> Array:
	var issues: Array = []
	if state.get("marker") == "strat" and str(state.get("face", "")) != "move":
		issues.append("stratMustFaceMove")
	if unit_class == "transportPoint" and state.get("marker") == "dg":
		issues.append("transportPointInDg")
	return issues


# ── 阶段可动性（通规 6.0/6.3a/7.0a/11.0a） ──

## input: { state, side, activeSide }；phase: movement/reaction/exploitation。
## 返回 TS 同款判定字典：成功 { ok: true }；失败 { ok: false, rule, reason }。
static func can_move_in_phase(input: Dictionary, phase: String) -> Dictionary:
	var state: Dictionary = input.get("state", {})
	var side: String = str(input.get("side", ""))
	var active_side: String = str(input.get("activeSide", ""))
	if phase == "movement":
		if side != active_side:
			return {"ok": false, "rule": "6.0", "reason": "移动阶段只能移动当前阶段玩家的地面单位"}
		return {"ok": true}
	if phase == "reaction":
		if side == active_side:
			return {"ok": false, "rule": "6.3a", "reason": "反应阶段只能移动非阶段玩家的单位"}
		if state.get("released", false) != true:
			return {"ok": false, "rule": "7.0a", "reason": "反应阶段只有被释放的预备单位可以移动"}
		return {"ok": true}
	if side != active_side:
		return {"ok": false, "rule": "11.0a", "reason": "进击阶段只能移动当前阶段玩家的单位"}
	if state.get("marker") != "exploit" and state.get("released", false) != true:
		return {"ok": false, "rule": "11.0a", "reason": "进击阶段只有进击模式单位或被释放的预备可以移动"}
	return {"ok": true}


# ── 释放预备（通规 5.7b） ──

## input: { state, side, activeSide, phase }。
## 成功 { ok: true, rule, state: 已释放状态, maMult: 机动倍率 }；失败 { ok: false, rule, reason }。
static func can_release_reserve(input: Dictionary) -> Dictionary:
	var state: Dictionary = input.get("state", {})
	var side: String = str(input.get("side", ""))
	var active_side: String = str(input.get("activeSide", ""))
	var phase: String = str(input.get("phase", ""))
	if phase == "reaction":
		if side == active_side:
			return {"ok": false, "rule": "6.3a", "reason": "反应阶段只能由非阶段玩家释放自己的预备"}
	elif phase == "exploitation":
		if side != active_side:
			return {"ok": false, "rule": "11.0a", "reason": "进击阶段只能由阶段玩家释放自己的预备"}
	else:
		return {"ok": false, "rule": "5.7b", "reason": "只在反应/进击阶段释放预备"}
	if state.get("marker") != "reserve":
		return {"ok": false, "rule": "5.7b", "reason": "该单位不处于预备模式，无需释放"}
	if state.get("released", false) == true:
		return {"ok": false, "rule": "5.7b", "reason": "该单位本阶段已经释放过了"}
	var released: Dictionary = state.duplicate(true)
	released["released"] = true
	return {"ok": true, "rule": "5.7b", "state": released,
		"maMult": ground_mode_movement_factor(released, phase)}


# ── 模式切换合法性（通规 5.4/4.5a/5.5c/5.7c/f/5.8a/c；专规闸门注入） ──

## req: { to, orientation, inEnemyZoc, unitClass, side, phase,
##        adjacentEnemyAttackCapable?, operationalLimit? }。
## operationalLimit 为可选 Callable：传入 req，返回判定字典或 null；返回失败则原样带回。
## 本项目（TTW 08）暂无对应专规闸门，缺省不启用任何专规限制。
static func can_switch_mode(req: Dictionary) -> Dictionary:
	var phase: String = str(req.get("phase", ""))
	if phase != "movement":
		return {"ok": false, "rule": "5.4", "reason": "主动模式切换只能在本方移动阶段进行"}
	var to: String = str(req.get("to", ""))
	var orientation: String = str(req.get("orientation", ""))
	if to == "strat" and orientation != "move":
		return {"ok": false, "rule": "5.8", "reason": "战略模式朝向必须是移动面"}
	if to == "combat" and orientation != "combat":
		return {"ok": false, "rule": "5.5", "reason": "进入战斗模式必须朝向战斗面"}
	if to == "move" and orientation != "move":
		return {"ok": false, "rule": "5.6", "reason": "进入移动模式必须朝向移动面"}
	var unit_class: String = str(req.get("unitClass", ""))
	if unit_class == "facility":
		return {"ok": false, "rule": "6.1b", "reason": "无 MA 设施不可移动或撤退"}
	if to == "combat" and (unit_class == "repl" or unit_class == "transportPoint"):
		return {"ok": false, "rule": "5.5c", "reason": "补员单位与运输点数不能进入战斗模式"}
	if to == "reserve" and unit_class == "transportPoint":
		return {"ok": false, "rule": "5.7f", "reason": "运输点数不允许进入预备模式（编内卡车除外）"}
	if to == "strat" and unit_class == "transportPoint":
		return {"ok": false, "rule": "5.8c", "reason": "运输点数不能进入战略模式"}
	if req.get("adjacentEnemyAttackCapable", false) == true and (to == "reserve" or to == "strat"):
		return {"ok": false, "rule": "IV-B", "reason": "初设时与敌方攻击力单位相邻，不能设为预备或战略模式"}
	if to == "reserve" and req.get("inEnemyZoc", false) == true:
		return {"ok": false, "rule": "5.7c", "reason": "不可在敌方 ZOC 内进入预备模式"}
	if to == "strat" and req.get("inEnemyZoc", false) == true:
		return {"ok": false, "rule": "5.8a", "reason": "不可在敌方 ZOC 内进入战略模式"}
	var limit: Variant = req.get("operationalLimit", null)
	if limit is Callable:
		var special: Variant = limit.call(req)
		if special is Dictionary and special.get("ok", true) == false:
			return special
	return {"ok": true}
