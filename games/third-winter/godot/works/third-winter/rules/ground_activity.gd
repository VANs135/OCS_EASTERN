extends RefCounted

## 对应 src/match/scorpion-ground-activity.ts：地面活动记录（本阶段已空运单位、已花点数）。
## TS 只在记录与本方当前 回合/席位/阶段 一致时才认；换阶段后旧记录一律作废。


static func activity(state: Dictionary) -> Dictionary:
	var stored: Variant = state.get("groundActivity")
	var cursor: Dictionary = state.get("cursor", {})
	if stored is Dictionary and _same_phase(cursor, stored):
		return stored
	return {"turn": int(cursor.get("turn", 0)), "phasing": str(cursor.get("phasing", "")),
		"phase": str(cursor.get("phase", "")), "spent": {}, "airlifted": []}


static func airlifted(state: Dictionary) -> Array:
	var list: Variant = activity(state).get("airlifted", [])
	return list if list is Array else []


static func _same_phase(cursor: Dictionary, record: Dictionary) -> bool:
	return int(record.get("turn", -1)) == int(cursor.get("turn", -2)) \
		and str(record.get("phasing", "")) == str(cursor.get("phasing", "")) \
		and str(record.get("phase", "")) == str(cursor.get("phase", ""))
