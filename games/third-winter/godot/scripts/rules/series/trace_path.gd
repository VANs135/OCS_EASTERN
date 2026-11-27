extends RefCounted

## Bounded Dijkstra over MP costs (packages/series/src/trace-path.ts), shared by the forward
## reach and the reverse coverage used by the supply trace.

const INF := 1e18


## Stable binary heap ordered by spent MP, then by insertion order.
class TraceQueue:
	var entries: Array = []


	func push(entry: Dictionary) -> void:
		var heap := entries
		heap.append(entry)
		var index := heap.size() - 1
		while index > 0:
			var parent := int((index - 1) / 2)
			if not _earlier(heap[index], heap[parent]):
				break
			var swapped: Dictionary = heap[parent]
			heap[parent] = heap[index]
			heap[index] = swapped
			index = parent


	func pop() -> Variant:
		var heap := entries
		var first: Variant = heap[0] if not heap.is_empty() else null
		var last: Variant = heap.pop_back()
		if heap.is_empty():
			return first
		heap[0] = last
		var index := 0
		while true:
			var left := index * 2 + 1
			var right := left + 1
			var next := index
			if left < heap.size() and _earlier(heap[left], heap[next]):
				next = left
			if right < heap.size() and _earlier(heap[right], heap[next]):
				next = right
			if next == index:
				break
			var swapped: Dictionary = heap[next]
			heap[next] = heap[index]
			heap[index] = swapped
			index = next
		return first


	func is_empty() -> bool:
		return entries.is_empty()


	static func _earlier(a: Dictionary, b: Dictionary) -> bool:
		if a.spent != b.spent:
			return a.spent < b.spent
		return a.order < b.order


## OCS 12.3d — the caller supplies eligibility and the step cost for the trace mobility.
## `next_cost` receives (from, to, spent) and returns the new total or null to block the step.
static func bounded_reach(origins: Array, range: float, allows: Callable, neighbors: Callable,
		next_cost: Callable) -> Dictionary:
	var distances := {}
	var pending := {}
	var queue := TraceQueue.new()
	var next_order := 0
	for origin: String in origins:
		if not allows.call(origin) or distances.has(origin):
			continue
		distances[origin] = 0.0
		pending[origin] = next_order
		queue.push({"hex": origin, "spent": 0.0, "order": next_order})
		next_order += 1
	while not queue.is_empty():
		var entry: Dictionary = queue.pop()
		var from: String = entry.hex
		var spent: float = entry.spent
		var order: int = entry.order
		if not pending.has(from) or int(pending[from]) != order or float(distances.get(from, INF)) != spent:
			continue
		pending.erase(from)
		for to: String in neighbors.call(from):
			if not allows.call(to):
				continue
			var total: Variant = next_cost.call(from, to, spent)
			if total == null or float(total) > range or float(total) >= float(distances.get(to, INF)):
				continue
			if not pending.has(to):
				pending[to] = next_order
				next_order += 1
			distances[to] = float(total)
			queue.push({"hex": to, "spent": float(total), "order": int(pending[to])})
	return distances


static func trace_reach(origin: String, range: float, allows: Callable, neighbors: Callable,
		step_cost: Callable) -> Dictionary:
	var next := func(from: String, to: String, spent: float) -> Variant:
		var step: Variant = step_cost.call(from, to)
		if step == null:
			return null
		if step is String:
			if from != origin or range <= 0:
				return null
			return range
		return spent + float(step)
	return bounded_reach([origin], range, allows, neighbors, next)


## Reverse multi-source reach. Every tested edge still uses its forward direction and cost.
## Returns null when a cost cannot be reversed exactly (the caller then skips the shortcut).
static func incoming_coverage(targets: Array, range: float, incoming: Callable, allows: Callable,
		step_cost: Callable) -> Variant:
	var all_cost_origins := {}
	var exact := {"ok": true}
	var numeric := bounded_reach(targets, range, allows, incoming,
		func(current: String, previous: String, spent: float) -> Variant:
			var step: Variant = step_cost.call(previous, current)
			if step is String:
				# An all-cost edge may only be the first forward step; it cannot extend a reverse path.
				if spent == 0.0 and range > 0:
					all_cost_origins[previous] = true
				return null
			if step == null:
				return null
			# Whole and half MP preserve exact sums in either direction.
			var doubled := float(step) * 2.0
			if float(step) < 0.0 or not is_equal_approx(doubled, round(doubled)):
				exact.ok = false
				return null
			return spent + float(step))
	if not exact.ok:
		return null
	for hex: String in all_cost_origins:
		numeric[hex] = 0.0
	return numeric
