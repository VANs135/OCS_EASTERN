extends RefCounted

## OCS 12.3, 12.6 and 12.7 supply network (packages/series/src/supply-network.ts).
## One instance is an immutable board snapshot: sources, rail connectivity, extender relays,
## HQ throw and the Kessel self-contained source.

const TracePath := preload("res://scripts/rules/series/trace_path.gd")
const TraceTargets := preload("res://scripts/rules/series/trace_targets.gd")

var _board: Dictionary
var _state: Dictionary
var _sources: Dictionary = {}
var _controlled: Dictionary = {}
var _enemy_combat: Dictionary = {}
var _unnegated: Dictionary = {}
var _headquarters: Array = []
var _extenders: Array = []
var _adjacency: Dictionary = {}
var _incoming_adjacency: Dictionary = {}
var _eligibility: Dictionary = {}
var _costs: Dictionary = {"leg": {}, "truck": {}, "track": {}}
var _ranges: Dictionary = {}
var _source_targets: RefCounted
var _rail_seen: Dictionary = {}
var _rail_seen_order: Array = []
var _rail_targets: Variant = null
var _queue: Array = []
var _connected := false
var _source_matches: Dictionary = {}
var _throwing_by_hex: Variant = null
var _coverage: Dictionary = {}
var _hq_coverage: Variant = null


func _init(board: Dictionary, state: Dictionary) -> void:
	_board = board
	_state = state
	_controlled = _set_of(state.get("controlled", []))
	_enemy_combat = _set_of(state.get("enemyCombat", []))
	_unnegated = _set_of(state.get("unnegatedEnemyZoc", []))
	_headquarters = state.get("headquarters", [])
	_extenders = state.get("extenders", [])
	_source_targets = TraceTargets.new(Callable(self, "_neighbors_of"))


static func _set_of(values: Array) -> Dictionary:
	var result := {}
	for value: String in values:
		result[value] = true
	return result


func _neighbors_of(hex: String) -> Array:
	if _adjacency.has(hex):
		return _adjacency[hex]
	var result: Array = _board.neighbors.call(hex)
	_adjacency[hex] = result
	return result


func _incoming_of(hex: String) -> Array:
	var incoming: Variant = _board.get("incomingNeighbors")
	if incoming == null or incoming == _board.get("neighbors"):
		return _neighbors_of(hex)
	if _incoming_adjacency.has(hex):
		return _incoming_adjacency[hex]
	var result: Array = incoming.call(hex)
	_incoming_adjacency[hex] = result
	return result


func eligible(hex: String) -> bool:
	if _eligibility.has(hex):
		return _eligibility[hex]
	var result: bool = _board.hasHex.call(hex) and not _enemy_combat.has(hex)
	_eligibility[hex] = result
	return result


func rail_accessible(hex: String) -> bool:
	return eligible(hex) and not _unnegated.has(hex)


func allows(hex: String, mobility: String) -> bool:
	return eligible(hex) and (mobility != "truck" or not _unnegated.has(hex))


func _rail_neighbors_of(hex: String) -> Array:
	var rail: Variant = _board.get("railNeighbors")
	if rail == null:
		return _neighbors_of(hex)
	return rail.call(hex)


func trace_cost(from: String, to: String, mobility: String) -> Variant:
	if not _costs.has(mobility):
		_costs[mobility] = {}
	if not _costs[mobility].has(from):
		_costs[mobility][from] = {}
	if _costs[mobility][from].has(to):
		return _costs[mobility][from][to]
	var cost: Variant = _board.traceCost.call(from, to, mobility)
	_costs[mobility][from][to] = cost
	return cost


func reach(origin: String, range: float, mobility: String) -> Dictionary:
	var key := "%s:%s:%s" % [origin, range, mobility]
	if _ranges.has(key):
		return _ranges[key]
	var result: Dictionary = TracePath.trace_reach(origin, range,
		func(hex: String) -> bool: return allows(hex, mobility),
		Callable(self, "_neighbors_of"),
		func(from: String, to: String) -> Variant: return trace_cost(from, to, mobility))
	_ranges[key] = result
	return result


## OCS 12.3c — the final adjacent hexside does not consume movement points.
func _reaches(within: Dictionary, id: String) -> bool:
	if within.has(id):
		return true
	for near: String in _neighbors_of(id):
		if within.has(near):
			return true
	return false


func can_draw(origin: String, source: String, mobility: String) -> bool:
	return _reaches(reach(origin, 5, mobility), source)


func _can_throw(hq: Dictionary, hex: String) -> bool:
	return _reaches(reach(hq.hex, float(hq.throwRange), hq.mobility), hex)


func _rail_node(hex: String) -> bool:
	if not rail_accessible(hex):
		return false
	return not _board.detrainable.call(hex) or _controlled.has(hex)


func _add_source(hex: String) -> void:
	_sources[hex] = true
	_source_targets.add(hex)


func _add_rail(hex: String) -> void:
	if _rail_seen.has(hex):
		return
	_rail_seen[hex] = true
	_rail_seen_order.append(hex)
	if _rail_targets != null:
		_rail_targets.add(hex)
	_queue.append(hex)
	if _board.detrainable.call(hex) and _controlled.has(hex):
		_add_source(hex)


func _outgoing_rail(link: Dictionary) -> Array:
	var result := []
	for hex: String in [link.hex] + _neighbors_of(link.hex):
		if not _rail_node(hex):
			continue
		for near: String in _rail_neighbors_of(hex):
			if _board.railCanTrace.call(hex, near):
				result.append(hex)
				break
	return result


func _reaches_rail(within: Dictionary) -> bool:
	if _rail_targets == null:
		_rail_targets = TraceTargets.new(Callable(self, "_neighbors_of"))
		for hex: String in _rail_seen_order:
			_rail_targets.add(hex)
	return _rail_targets.intersects(within)


func _connects_extender(link: Dictionary) -> bool:
	if not rail_accessible(link.hex):
		return false
	var reachable: Dictionary = reach(link.hex, float(link.range), link.mobility)
	if _source_targets.intersects(reachable):
		return true
	return _outgoing_rail(link).size() > 0 and _reaches_rail(reachable)


func connect_sources() -> void:
	if _connected:
		return
	for source: String in _state.get("sources", []):
		if rail_accessible(source):
			_add_source(source)
	# Snapshot the growing set: newly found sources still reach the rail queue through add_rail.
	for source: String in _sources.keys():
		_add_rail(source)
	var examined := 0
	# Grow from genuine sources. A disconnected cycle cannot make itself a source.
	while true:
		while examined < _queue.size():
			var from: String = _queue[examined]
			examined += 1
			for to: String in _rail_neighbors_of(from):
				if _rail_node(to) and _board.railCanTrace.call(from, to):
					_add_rail(to)
		var linked := false
		var pending := _extenders.duplicate()
		for link: Dictionary in pending:
			if not _connects_extender(link):
				continue
			_add_source(link.hex)
			for hex: String in _outgoing_rail(link):
				_add_rail(hex)
			pending.erase(link)
			linked = true
		if not linked:
			break
	_connected = true


func can_connect_extender(link: Dictionary) -> bool:
	connect_sources()
	return _connects_extender(link)


func draw_sources(origin: String, mobility: String) -> Array:
	var key := "%s:%s" % [origin, mobility]
	if _source_matches.has(key):
		return _source_matches[key]
	var result: Array = _source_targets.matching(reach(origin, 5, mobility))
	_source_matches[key] = result
	return result


func headquarters_in_range(hex: String) -> Array:
	if _throwing_by_hex == null:
		_throwing_by_hex = {}
		var index := 0
		for hq: Dictionary in _headquarters:
			for reached: String in reach(hq.hex, float(hq.throwRange), hq.mobility):
				if not _throwing_by_hex.has(reached):
					_throwing_by_hex[reached] = []
				_throwing_by_hex[reached].append(index)
			index += 1
	var candidates := {}
	for reached: String in [hex] + _neighbors_of(hex):
		for index: int in _throwing_by_hex.get(reached, []):
			candidates[index] = true
	var order := candidates.keys()
	order.sort()
	var result := []
	for index: int in order:
		result.append(_headquarters[index])
	return result


func trace(hex: String, mobility := "truck") -> Array:
	if not eligible(hex):
		return []
	connect_sources()
	var options := []
	for source: String in draw_sources(hex, mobility):
		options.append({"kind": "direct", "from": hex, "source": source})
	for hq: Dictionary in headquarters_in_range(hex):
		var extra := {}
		if str(hq.get("id", "")) != "":
			extra["headquarters"] = hq.id
		if hq.get("selfContained") == true:
			var own := {"kind": "self-contained", "from": hq.hex, "source": hq.hex}
			own.merge(extra)
			options.append(own)
			continue
		for source: String in draw_sources(hq.hex, hq.mobility):
			var option := {"kind": "hq", "from": hq.hex, "source": source}
			option.merge(extra)
			options.append(option)
	return options


func prepare_trace_coverage(mobility := "truck") -> void:
	if _board.get("incomingNeighbors") == null or _coverage.has(mobility):
		return
	connect_sources()
	var targets := []
	for source: String in _sources:
		targets.append(source)
		for near: String in _neighbors_of(source):
			targets.append(near)
	var direct: Variant = TracePath.incoming_coverage(targets, 5,
		Callable(self, "_incoming_of"),
		func(hex: String) -> bool: return allows(hex, mobility),
		func(from: String, to: String) -> Variant: return trace_cost(from, to, mobility))
	if direct == null:
		_coverage[mobility] = null
		return
	if _hq_coverage == null:
		var supplied := {}
		for hq: Dictionary in _headquarters:
			if hq.get("selfContained") != true \
					and not _source_targets.intersects(reach(hq.hex, 5, hq.mobility)):
				continue
			for reached: String in reach(hq.hex, float(hq.throwRange), hq.mobility):
				supplied[reached] = true
				for hex: String in _incoming_of(reached):
					if eligible(hex):
						supplied[hex] = true
		_hq_coverage = supplied
	for hex: String in _hq_coverage:
		direct[hex] = 0.0
	_coverage[mobility] = direct


func has_trace(hex: String, mobility := "truck") -> bool:
	if not eligible(hex):
		return false
	var prepared: Variant = _coverage.get(mobility)
	if prepared != null:
		return prepared.has(hex)
	connect_sources()
	if _source_targets.intersects(reach(hex, 5, mobility)):
		return true
	for hq: Dictionary in headquarters_in_range(hex):
		if hq.get("selfContained") == true:
			return true
		if _source_targets.intersects(reach(hq.hex, 5, hq.mobility)):
			return true
	return false


func can_use_dump(location: String, source: String, mobility := "truck") -> bool:
	if not eligible(location) or not eligible(source):
		return false
	if can_draw(location, source, mobility):
		return true
	for hq: Dictionary in headquarters_in_range(location):
		if can_draw(hq.hex, source, hq.mobility):
			return true
	return false


func can_draw_dump(location: String, source: String, mobility := "truck") -> bool:
	return eligible(location) and eligible(source) and can_draw(location, source, mobility)


func can_use_dump_via(hq_id: String, location: String, source: String) -> bool:
	var hq: Variant = _find_headquarter(hq_id)
	if hq == null or not eligible(hq.hex) or not eligible(location) or not eligible(source):
		return false
	return can_draw(hq.hex, source, hq.mobility) and _can_throw(hq, location)


func in_throw_range(hq_id: String, location: String) -> bool:
	var hq: Variant = _find_headquarter(hq_id)
	return hq != null and _can_throw(hq, location)


func _find_headquarter(hq_id: String) -> Variant:
	for hq: Dictionary in _headquarters:
		if str(hq.get("id", "")) == hq_id:
			return hq
	return null


func has_connected_unload_site(hex: String) -> bool:
	connect_sources()
	return _board.detrainable.call(hex) and _controlled.has(hex) and _rail_seen.has(hex)
