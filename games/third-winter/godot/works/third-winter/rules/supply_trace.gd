extends RefCounted

## TTW Scorpion supply trace (src/ttw/scorpion/supply-trace.ts). Wraps the series network with the
## printed rail gauge, printed unloading sites, TTW terrain costs and the Axis Kessel exception.

const TerrainCost := preload("res://works/third-winter/rules/terrain_cost.gd")
const SupplyNetwork := preload("res://scripts/rules/series/supply_network.gd")


## scorpionPrintedUnloadingSite: any city hex plus the printed Volga-side site.
static func printed_unloading_site(graph: Dictionary, hex: String) -> bool:
	return graph.get("cities", {}).has(hex) or hex == "s13.11"


static func detrainable(graph: Dictionary, position: Dictionary, hex: String) -> bool:
	return printed_unloading_site(graph, hex) or position.get("detrainableFacilities", []).has(hex)


static func network(graph: Dictionary, position: Dictionary, side: String, weather: String) -> RefCounted:
	var neighbors := func(hex: String) -> Array: return graph.get("neighbors", {}).get(hex, [])
	var headquarters := []
	for hq: Dictionary in position.get("headquarters", []):
		var copy := hq.duplicate()
		# TTW §2.3 — only the Axis side treats a Kessel HQ as a self-contained source.
		copy["selfContained"] = hq.get("kessel") == true and side == "axis"
		headquarters.append(copy)
	var board := {
		"hasHex": func(hex: String) -> bool: return graph.get("terrains", {}).has(hex),
		"neighbors": neighbors,
		"incomingNeighbors": neighbors,
		"detrainable": func(hex: String) -> bool: return detrainable(graph, position, hex),
		"railCanTrace": func(from: String, to: String) -> bool:
			return _has_rail(graph, from, to) and _gauge(graph, from, to) == side,
		"traceCost": func(from: String, to: String, mobility: String) -> Variant:
			return TerrainCost.trace_step_cost(graph, from, to, mobility, weather),
	}
	var state := {
		"sources": position.get("sources", []),
		"controlled": position.get("controlled", []),
		"enemyCombat": position.get("enemyCombat", []),
		"unnegatedEnemyZoc": position.get("unnegatedEnemyZoc", []),
		"headquarters": headquarters,
		"extenders": position.get("extenders", []),
	}
	return SupplyNetwork.new(board, state)


static func _has_rail(graph: Dictionary, from: String, to: String) -> bool:
	var edge: Variant = graph.get("edges", {}).get(TerrainCost.edge_key(from, to), null)
	return edge != null and edge.get("rail") != null


static func _gauge(graph: Dictionary, from: String, to: String) -> String:
	return str(graph.get("railGauge", {}).get(TerrainCost.edge_key(from, to), "axis"))


## Kind is renamed to the work vocabulary: the series 'self-contained' source is the Axis Kessel.
static func options_of(open: RefCounted, location: String, mobility := "truck") -> Array:
	var result := []
	for option: Dictionary in open.trace(location, mobility):
		var copy := option.duplicate()
		if copy.kind == "self-contained":
			copy["kind"] = "kessel"
		result.append(copy)
	return result


## One network per board snapshot; trace and coverage share its caches.
static func trace_options(graph: Dictionary, position: Dictionary, side: String, weather: String,
		location: String, draw_mobility := "truck") -> Array:
	return options_of(network(graph, position, side, weather), location, draw_mobility)


static func has_trace(graph: Dictionary, position: Dictionary, side: String, weather: String,
		location: String, draw_mobility := "truck") -> bool:
	return network(graph, position, side, weather).has_trace(location, draw_mobility)


## Sorted "hex -> MP" map so the oracle diff is order-free on the value side.
static func reach_map(graph: Dictionary, position: Dictionary, side: String, weather: String,
		origin: String, range: float, mobility: String) -> Dictionary:
	var result := {}
	for hex: String in network(graph, position, side, weather).reach(origin, range, mobility):
		result[hex] = true
	return result
