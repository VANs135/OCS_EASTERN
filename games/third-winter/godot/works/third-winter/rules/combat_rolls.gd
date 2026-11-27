extends RefCounted

## 对应 src/match/scorpion-reroll.ts `scorpionRolls`：把分组骰面绑到本局 rng 流。
## 战斗要按 surprise(2d6) → surprise-shift(1d6，仅在极端时抽) → combat(2d6) 的顺序消耗 rng；
## site 里的 kind 同时是 offer 回放的键（TS 的重掷窗口用它把已记录的骰面重放给原命令）。
## offer 为空时从本局 rng 自掷；offer 有值时按 TS 语义直接给骰面且不推进 rng（只给重掷回放与对照夹具用）。

const Rng := preload("res://scripts/core/rng.gd")

var rng: Dictionary
var error: Dictionary = {}
var offer: Dictionary


func _init(rng_state: Dictionary, offered: Dictionary = {}) -> void:
	rng = rng_state.duplicate(true)
	offer = offered.duplicate(true)


## 抽两枚骰；失败时返回空数组并把 Result.failure 记进 error。
func two(site: Dictionary) -> Array:
	var faces: Variant = _offered(site, 2)
	if faces != null:
		return faces
	var draw: Dictionary = Rng.roll_dice(rng, 2)
	if not draw.get("ok", false):
		error = draw
		return []
	var value: Dictionary = draw.get("value", {})
	rng = value.get("rng", rng)
	return value.get("value", {}).get("faces", [])


## 抽一枚骰；失败时返回 0 并记录 error。
func one(site: Dictionary) -> int:
	var faces: Variant = _offered(site, 1)
	if faces != null:
		return int(faces[0]) if faces.size() > 0 else 0
	var draw: Dictionary = Rng.roll_dice(rng, 1)
	if not draw.get("ok", false):
		error = draw
		return 0
	var value: Dictionary = draw.get("value", {})
	rng = value.get("rng", rng)
	var drawn: Array = value.get("value", {}).get("faces", [])
	return int(drawn[0]) if drawn.size() > 0 else 0


func failed() -> bool:
	return not error.is_empty()


## offer 里按键取骰面（数组按序切片）；键不存在返回 null 表示走真掷骰。
func _offered(site: Dictionary, count: int) -> Variant:
	if offer.is_empty():
		return null
	var key := str(site.get("kind", ""))
	var faces: Variant = offer.get(key)
	if not (faces is Array):
		return null
	var picked: Array = []
	for index: int in mini(count, faces.size()):
		picked.append(int(faces[index]))
	if picked.size() < count:
		error = {"ok": false, "errorCode": "combat_offer_short", "errorMessage": "回放骰面不足：%s" % key}
		return []
	return picked
