extends RefCounted

## Index a target and its neighbors, preserving target insertion order
## (packages/series/src/trace-targets.ts). Used to answer "does this reach touch a source".

var _ids: Array = []
var _by_hex: Dictionary = {}
var _seen: Dictionary = {}
var _neighbors: Callable


func _init(neighbors: Callable) -> void:
	_neighbors = neighbors


func add(id: String) -> void:
	if _seen.has(id):
		return
	_seen[id] = true
	var index := _ids.size()
	_ids.append(id)
	var touched := {id: true}
	for near: String in _neighbors.call(id):
		touched[near] = true
	for hex: String in touched:
		if not _by_hex.has(hex):
			_by_hex[hex] = []
		_by_hex[hex].append(index)


func intersects(within: Dictionary) -> bool:
	for hex: String in within:
		if _by_hex.has(hex):
			return true
	return false


func matching(within: Dictionary) -> Array:
	var found := {}
	for hex: String in within:
		for index: int in _by_hex.get(hex, []):
			found[index] = true
	var order := found.keys()
	order.sort()
	var result := []
	for index: int in order:
		result.append(_ids[index])
	return result
