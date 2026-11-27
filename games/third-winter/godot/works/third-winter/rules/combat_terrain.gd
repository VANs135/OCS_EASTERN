extends RefCounted

## TTW 战斗地形 / 战斗强度数值层。
## 移植自 games/third-winter/src/ttw/combat-terrain.ts 与 games/third-winter/src/ttw/scorpion/combat-terrain.ts。
## 只做倍率与强度结算；战斗状态机、命令与界面由后续切片接入。

const Modes := preload("res://scripts/rules/series/modes.gd")

const CLASS_INDEX := {"armor": 0, "mech": 1, "other": 2}

## TTW Terrain Effects Chart（战斗倍率）。括号倍率只适用于进攻方；守方倍率缺省即 ×1。
const TERRAIN_COMBAT := {
	"Open": {"crt": "Open", "attack": [2, 2, 1]},
	"Hills": {"crt": "Close", "attack": [1, 1, 1]},
	"Woods": {"crt": "Close", "attack": [1, 1, 1]},
	"Forest": {"crt": "Close", "attack": [0.5, 1, 1], "defense": [0.5, 1, 1]},
	"Rough": {"crt": "Very Close", "attack": [0.5, 0.5, 1]},
	"Mountain": {"crt": "Extr Close", "attack": [1.0 / 3.0, 0.5, 1], "defense": [1.0 / 3.0, 1, 1]},
	"Swamp": {"crt": "Very Close", "attack": [0.5, 0.5, 1], "defense": [0.5, 0.5, 1]},
	"Village": {"crt": "Close", "attack": [1, 1, 1]},
	"Minor City": {"crt": "Very Close", "attack": [0.5, 0.5, 1], "defense": [0.5, 1, 1]},
	"Major City": {"crt": "Extr Close", "attack": [1.0 / 3.0, 0.5, 1], "defense": [1.0 / 3.0, 1, 1]},
}


## 地形对应的 CRT 类别（Extr Close / Very Close / Close / Open）。
static func combat_terrain_category(terrain: String) -> String:
	var entry: Dictionary = TERRAIN_COMBAT.get(terrain, {})
	return str(entry.get("crt", ""))


## 战斗强度结算（OCS 9.5/9.11d + TTW 1.6d）。
## facts 字段同 TS CombatStrengthFacts：attacking, terrain, frozen, supplied, enemyAntiTank,
## combatClass, strength, printedRe, stepsLost, antiTank, outOfSupply, artilleryDivision,
## attackFactor, defenseFactor。
static func combat_strength(facts: Dictionary) -> float:
	var attacking: bool = facts.get("attacking", false) == true
	## TTW 1.6d：苏军炮兵师/卡秋莎师防御时防御力＝当前 RE，不另按步损减半。
	var artillery_division: bool = not attacking and facts.get("artilleryDivision", false) == true
	var strength: float
	if artillery_division:
		strength = float(facts.get("printedRe", 0)) - float(facts.get("stepsLost", 0))
	else:
		strength = float(facts.get("strength", 0))
	var mode_factor: float = float(facts.get("attackFactor", 1)) if attacking \
		else float(facts.get("defenseFactor", 1))
	## OCS 9.5a：断补 ×½。
	var base: float = strength * mode_factor * (0.5 if facts.get("outOfSupply", false) == true else 1.0)

	var steps_lost: int = int(facts.get("stepsLost", 0))
	var printed_re: float = float(facts.get("printedRe", 0))
	## OCS 9.11d：进攻有任何步损即减半；防御步损≥印刷一半才减半；炮兵师防御不叠此减半。
	var steps: bool = not artillery_division and (
		(attacking and steps_lost > 0) or
		(not attacking and steps_lost > 0 and steps_lost >= printed_re / 2.0))

	var index: int = CLASS_INDEX.get(str(facts.get("combatClass", "other")), 2)
	var terrain: String = str(facts.get("terrain", ""))
	var list: Variant = null
	if terrain == "minor-river":
		list = [0.5, 1, 1] if facts.get("frozen", false) == true else [0.5, 0.5, 0.5]
	elif terrain == "major-river":
		list = [0.5, 0.5, 0.5] if facts.get("frozen", false) == true else [0.25, 1.0 / 3.0, 0.5]
	else:
		var entry: Dictionary = TERRAIN_COMBAT.get(terrain, {})
		list = entry.get("attack" if attacking else "defense", null)

	var terrain_factor: float = 1.0
	if list is Array and index >= 0 and index < list.size() and list[index] != null:
		terrain_factor = float(list[index])

	## 开阔地装甲/机步 ×2；守方反坦克≥攻方时降为 ×1.5。
	var anti_tank: int = int(facts.get("antiTank", 0))
	var enemy_at: int = int(facts.get("enemyAntiTank", 0))
	if attacking and terrain_factor == 2.0 and anti_tank > 0 and enemy_at >= anti_tank:
		terrain_factor = 1.5

	var supplied: bool = facts.get("supplied", true) == true
	return base * (0.5 if steps else 1.0) * (0.5 if not supplied else 1.0) * terrain_factor


## 行动值（OCS 9.4a 口径）：AR × 模式 AR 系数 + 模式 AR 修正。
static func combat_rating(unit: Dictionary) -> int:
	var state: Dictionary = _ground_state(unit)
	var effect: Dictionary = Modes.ground_mode_effect(state)
	var ar: int = int(unit.get("actionRating", 0))
	return ar * int(effect.get("actionRatingFactor", 1)) + int(effect.get("actionRatingModifier", 0))


## scorpion-mode-face.ts scorpionGroundMode：把盘上算子标记折成 GroundModeState。
static func _ground_state(unit: Dictionary) -> Dictionary:
	var marker: Variant = null
	if unit.get("disorganized", false) == true:
		marker = "dg"
	elif unit.get("reserve", false) == true:
		marker = "reserve"
	elif unit.get("exploit", false) == true:
		marker = "exploit"
	return {
		"face": "move" if unit.get("moveMode", false) == true else "combat",
		"marker": marker,
		"released": unit.get("released", false) == true,
	}
