extends RefCounted

## OCS 6.2a–d terrain/side selection (packages/series/src/ground-terrain.ts).
## Costs are Variant: a number, "all" (motorised may not enter at all) or null (impassable).


## Any impassable terrain makes the whole hex impassable; "all" wins over numbers.
static func most_expensive(costs: Array) -> Variant:
	if costs.is_empty():
		return null
	for value: Variant in costs:
		if value == null:
			return null
	for value: Variant in costs:
		if value is String:
			return "all"
	var best := -INF
	for value: Variant in costs:
		best = maxf(best, float(value))
	return best


## A usable route replaces the hex cost; otherwise hex plus hexside, capped by impassability.
static func select_cost(hex: Variant, hexside: Variant, routes: Array) -> Variant:
	if not routes.is_empty():
		var best := INF
		for value: Variant in routes:
			best = minf(best, float(value))
		return best
	if hex == null or hexside == null:
		return null
	if hex is String or hexside is String:
		return "all"
	return float(hex) + float(hexside)
