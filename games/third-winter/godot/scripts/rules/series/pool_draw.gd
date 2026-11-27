extends RefCounted

## Finite physical pool, corresponding to packages/series/src/pool-draw.ts.

const Rng := preload("res://scripts/core/rng.gd")
const Result := preload("res://scripts/core/result.gd")


static func draw_without_replacement(rng: Dictionary, pool: Array, count: int) -> Dictionary:
	if count < 0 or count > pool.size():
		return Result.failure("invalid_pool_count", "抽取数量超过可用库存")
	var remaining := pool.duplicate()
	var current := rng
	var draws: Array[Dictionary] = []
	for index in count:
		var selected := Rng.pick_index(current, remaining.size())
		if not selected.ok:
			return selected
		var next: Dictionary = selected.value.rng
		draws.append({"item": remaining.pop_at(selected.value.value), "before": current.drawCount, "after": next.drawCount})
		current = next
	return Result.success({"rng": current, "draws": draws, "remaining": remaining})
