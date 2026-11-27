extends RefCounted

## TTW Terrain Effects Chart and OCS 6.1d/6.2 step costs
## (src/ttw/ground-terrain.ts and src/ttw/scorpion/terrain-cost.ts).
## Columns of the TEC are Track, Truck and Leg; Axis Player Booklet p.8.

const GROUND := preload("res://scripts/rules/series/ground_terrain.gd")
const MOBILITY_INDEX := {"track": 0, "truck": 1, "leg": 2}

const DRY := {
	"Open": [1, 1, 1], "Hills": [1, 2, 1], "Woods": [2, 3, 1], "Forest": [3, 4, 2],
	"Rough": [3, 5, 2], "Mountain": [null, null, "all"], "Swamp": [null, null, 3],
	"Village": [0, 0, 0], "Minor City": [1, 1, 1], "Major City": [1, 1, 1],
}
const FREEZE := {
	"Open": [1, 1, 1], "Hills": [1, 2, 1], "Woods": [2, 3, 1], "Forest": [3, 4, 2],
	"Rough": [3, 5, 2], "Mountain": [null, null, "all"], "Swamp": [5, 6, 3],
	"Village": [0, 0, 0], "Minor City": [1, 1, 1], "Major City": [1, 1, 1],
}
const MUD := {
	"Open": [3, 8, 2], "Hills": [2, 6, 1], "Woods": [6, "all", 2], "Forest": ["all", "all", 2],
	"Rough": [4, 6, 2], "Mountain": [null, null, "all"], "Swamp": [null, null, 4],
	"Village": [0, 0, 0], "Minor City": [1, 1, 1], "Major City": [1, 1, 1],
}
const GROUND_COSTS := {"dry": DRY, "freeze": FREEZE, "mud": MUD}

const MINOR_DRY := [3, 5, 1]
const MINOR_FREEZE := [2, 3, 0]
const MAJOR_DRY := [null, null, "all"]
const MAJOR_FREEZE := [4, 6, 2]


## TTW 1.5 — a pontoon track bridges an ordinary river with no printed crossing.
static func admits_pontoon_track_bridge(barrier: String, routes: Array) -> bool:
	return (barrier == "minor" or barrier == "major") and routes.is_empty()


static func ground_cell_cost(terrains: Array, mobility: String, ground: String) -> Variant:
	var costs := []
	for terrain: String in terrains:
		costs.append(GROUND_COSTS[ground].get(terrain)[MOBILITY_INDEX[mobility]])
	return GROUND.most_expensive(costs)


## Ordinary hexsides; Volga-class and ferry traffic keep separate TTW crossing rules.
static func ordinary_terrain_cost(terrains: Array, barrier: String, routes: Array,
		mobility: String, ground: String) -> Variant:
	var index: int = MOBILITY_INDEX[mobility]
	var table := []
	if barrier == "minor":
		table = MINOR_FREEZE if ground == "freeze" else MINOR_DRY
	elif barrier == "major":
		table = MAJOR_FREEZE if ground == "freeze" else MAJOR_DRY
	var hexside: Variant = null
	if barrier == "none":
		hexside = 0
	elif not table.is_empty():
		hexside = table[index]
	# TTW TEC — a rail line used for ground movement costs the same MP as a track.
	var route_costs := []
	for route: String in routes:
		if route == "road":
			route_costs.append(2 if ground == "mud" and mobility == "truck" else (1 if ground == "mud" else 0.5))
		else:
			route_costs.append(4 if ground == "mud" and mobility == "truck" else 1)
	return GROUND.select_cost(ground_cell_cost(terrains, mobility, ground), hexside, route_costs)


static func edge_key(a: String, b: String) -> String:
	return "%s|%s" % [a, b] if a < b else "%s|%s" % [b, a]


static func _edge(graph: Dictionary, from: String, to: String) -> Variant:
	return graph.get("edges", {}).get(edge_key(from, to), null)


## 公开边表查询（战斗地形校验用）。
static func edge_between(graph: Dictionary, from: String, to: String) -> Variant:
	return _edge(graph, from, to)


static func _terrains(graph: Dictionary, hex: String) -> Variant:
	return graph.get("terrains", {}).get(hex, null)


## OCS 6.1d and 6.2 — scorpionStepCost. Callers may ask for the Normal (dry) column.
static func step_cost(graph: Dictionary, from: String, to: String, mobility: String, weather: String,
		use_routes := true) -> Variant:
	var edge: Variant = _edge(graph, from, to)
	if edge == null:
		return null
	var a: Variant = _terrains(graph, from)
	var b: Variant = _terrains(graph, to)
	if a == null or b == null:
		return null
	var river: Variant = edge.get("river")
	var route: Variant = null
	if use_routes and (river == null or edge.get("bridge") == true):
		route = edge.get("road")
		if route == null and edge.get("rail") != null:
			route = "rail"
	if route == null and ground_cell_cost(a, mobility, weather) == null:
		return null
	var routes := [] if route == null else [route]
	return ordinary_terrain_cost(b, "none" if river == null else river, routes, mobility, weather)


## Freeze weather lets a hexside keep whichever of the normal or frozen costs is lower.
static func trace_step_cost(graph: Dictionary, from: String, to: String, mobility: String, weather: String) -> Variant:
	var normal: Variant = step_cost(graph, from, to, mobility, "dry")
	if weather != "freeze":
		return normal
	var reduced: Variant = step_cost(graph, from, to, mobility, "freeze")
	if not (reduced is float or reduced is int):
		return normal
	if normal is float or normal is int:
		return minf(float(normal), float(reduced))
	return reduced
