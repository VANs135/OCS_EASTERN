extends RefCounted

## OCS 5.4 / TTW 08 `set-ground-mode` 命令。
## 对应 src/match/scorpion-ground-actions.ts 的 orient 分支与 import/scorpion-mode-face.ts 的
## scorpionModeFace：只做朝向面（combat/move）切换，预备/战略/进击/DG 模式由对应命令与标记层处理。
## 通规 5.4：换面不消耗 MP。

const Result := preload("res://scripts/core/result.gd")

## 投影时不逐面重算、必须原样保留的运行时字段。
const RUNTIME_KEYS := ["hex", "stepsLost", "fueled", "outOfSupply", "reserve", "released",
	"disorganized", "exploit", "organicTruck", "extender", "remnantOf", "optionalForce"]


## 按数据包逐面模板把算子投影到指定朝向；模板缺该面时返回 null。
## 语义对应 TS scorpionModeFace：模板字段整体落到算子上，运行时字段原样保留。
static func project_face(unit: Dictionary, definition_id: String, face: String, data: Dictionary) -> Variant:
	var catalog: Dictionary = data.get("view", {}).get("catalog", {})
	var faces: Dictionary = catalog.get("faces", {})
	var face_row: Variant = faces.get(definition_id, {})
	if face_row is Dictionary:
		face_row = face_row.get(face, null)
	if face_row == null:
		return null
	# TS scorpionModeFace：已处于目标朝向时原样返回。
	if bool(unit.get("moveMode", false)) == (face == "move"):
		return unit.duplicate(true)
	var next_unit: Dictionary = face_row.duplicate(true)
	for keep: String in RUNTIME_KEYS:
		if unit.has(keep):
			next_unit[keep] = unit[keep]
	return next_unit


## `set-ground-mode`：阶段/席位门禁 → 本方可动地面算子 → 朝向合法性 → 逐面模板投影。
static func set_ground_mode(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	if state.get("kind") != "playing":
		return Result.failure("match_not_started", "请先开始 08 对局")
	if state.get("victory") != null:
		return Result.failure("match_over", "对局已结束")
	var cursor: Dictionary = state.get("cursor", {})
	if str(cursor.get("phase", "")) != "movement":
		return Result.failure("movement_phase", "当前不在移动阶段")
	if str(cursor.get("phasing", "")) != actor:
		return Result.failure("wrong_actor", "该方不能执行朝向切换")
	var unit_id: String = str(action.get("unitId", ""))
	var units: Dictionary = state.get("units", {})
	var unit: Dictionary = units.get(unit_id, {})
	if unit.is_empty() or str(unit.get("side", "")) != actor or unit.get("combat") != true \
			or unit.get("reserve") != null:
		return Result.failure("movement_unit", "请选择本方未进入预备的地面算子")
	var moved: Array = state.get("moved", [])
	if moved.has(unit_id):
		return Result.failure("movement_spent", "该算子在本阶段已经移动")
	var activity: Dictionary = _activity(state)
	if activity.get("airlifted", []).has(unit_id):
		return Result.failure("movement_airlift", "空运后的算子不能再更换朝向")
	var face: String = str(action.get("face", ""))
	if face != "combat" and face != "move":
		return Result.failure("mode_face", "朝向只能是战斗面或移动面")
	var definition_id: String = str(unit.get("definition", ""))
	var projected: Variant = project_face(unit, definition_id, face, data)
	if projected == null:
		return Result.failure("mode_face_unavailable",
			"该算子没有印刷的%s朝向" % ("移动面" if face == "move" else "战斗面"))
	var next_units: Dictionary = units.duplicate(true)
	next_units[unit_id] = projected
	state.units = next_units
	return Result.success(state)


## 本局账本（spent/airlifted）口径与 ground_move.gd 一致：阶段换手即重置。
static func _activity(state: Dictionary) -> Dictionary:
	var cursor: Dictionary = state.get("cursor", {})
	var stored: Variant = state.get("groundActivity")
	if stored is Dictionary:
		if int(stored.get("turn", -1)) == int(cursor.get("turn", -1)) \
				and str(stored.get("phasing", "")) == str(cursor.get("phasing", "")) \
				and str(stored.get("phase", "")) == str(cursor.get("phase", "")):
			return stored.duplicate(true)
	return {"turn": int(cursor.get("turn", 0)), "phasing": str(cursor.get("phasing", "")),
		"phase": str(cursor.get("phase", "")), "spent": {}, "airlifted": []}
