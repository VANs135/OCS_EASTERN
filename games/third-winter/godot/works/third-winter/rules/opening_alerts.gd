extends RefCounted

const PoolDraw := preload("res://scripts/rules/series/pool_draw.gd")
const Result := preload("res://scripts/core/result.gd")


static func draw(rng: Dictionary, pool: Array, count: int) -> Dictionary:
	var ids: Dictionary = {}
	for entry: Variant in pool:
		if not entry is Dictionary or not entry.get("id") is String or entry.id.is_empty() \
				or not entry.get("definition") is String or entry.definition.is_empty() or ids.has(entry.id):
			return Result.failure("invalid_alert_pool", "Alert 初设库存含有无效或重复的算子")
		ids[entry.id] = true
	return PoolDraw.draw_without_replacement(rng, pool, count)
