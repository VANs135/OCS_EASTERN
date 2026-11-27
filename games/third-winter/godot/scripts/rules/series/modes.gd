extends RefCounted

## OCS 通规 5.0–5.10 单位模式数值层。
## 移植自 packages/series/src/modes.ts（作品/剧本中立）。
## 合法性层（can_switch_mode / can_release_reserve / validate_mode_state）由后续切片在本文件补齐，
## 本切片只落地数值矩阵、生效模式、移动倍率与朝向翻转。

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
