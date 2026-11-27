extends RefCounted

## TTW/OCS supply position (src/match/scorpion-supply-position.ts). Produces the facts the supply
## trace consumes: sources, controlled hexes, enemy combat hexes, unnegated enemy ZOC, detrainable
## facilities, headquarters, extenders and the printed rail gauge.
## The trace itself (packages/series/supply-network) is not ported yet.

const NEGATION_EXEMPT := ["railTransport", "railConversion", "shipping", "reserveMode"]
const NON_COMBAT_ACTIONS := ["truckMovement", "truckSupply", "railSupply", "portSupply", "aircraftRefit"]


## OCS v4.3 §4.5a — a combat-mode, supplied, attack-capable unit projects ZOC into adjacent hexes.
## Reference/disorganized units do not, matching projectsZoc + keepsCombatZoc.
static func projects_zoc(unit: Dictionary) -> bool:
	if unit.get("attackCapable") != true or unit.get("outOfSupply") == true:
		return false
	if unit.get("moveMode") == true:
		return false
	return unit.get("disorganized") != true and unit.get("reserve") != true


static func enemy_zoc(units: Dictionary, side: String, data: Dictionary) -> Array:
	var reached := {}
	var neighbors: Dictionary = data.view.mapGraph.neighbors
	for unit_id: String in units:
		var unit: Dictionary = units[unit_id]
		if unit.get("side") == side or unit.get("combat") != true or not projects_zoc(unit):
			continue
		for near: String in neighbors.get(unit.hex, []):
			reached[near] = true
	return _sorted(reached)


## Mirrors scorpionSupplyPosition; returns sets as sorted arrays so the oracle diff is order-free.
static func position(units: Dictionary, rail_control: Dictionary, side: String, data: Dictionary) -> Dictionary:
	var friendly := []
	var enemy_combat := {}
	for unit_id: String in units:
		var unit: Dictionary = units[unit_id]
		if unit.get("combat") != true:
			continue
		if unit.get("side") == side:
			friendly.append({"id": unit_id, "unit": unit})
		else:
			enemy_combat[unit.hex] = true
	var anchors := {}
	for row: Dictionary in friendly:
		anchors[row.unit.hex] = true
	var raw_zoc := enemy_zoc(units, side, data)
	# §4.5a-B/D — truck and rail trace are negated by a friendly combat unit's own hex.
	var unnegated := {}
	for hex: String in raw_zoc:
		if not anchors.has(hex):
			unnegated[hex] = true
	var headquarters := []
	for row: Dictionary in friendly:
		var hq: Variant = row.unit.get("headquarters")
		if hq is Dictionary:
			headquarters.append({"id": row.id, "hex": row.unit.hex, "throwRange": hq.get("throwRange"),
				"kessel": hq.get("kessel") == true})
	var extenders := []
	for unit_id: String in units:
		var unit: Dictionary = units[unit_id]
		if unit.get("side") != side or unit.get("extender") == null:
			continue
		extenders.append({"hex": unit.hex, "range": unit.extender.range, "mobility": unit.get("mobility")})
	var detrainable := {}
	for row: Dictionary in friendly:
		var hq: Variant = row.unit.get("headquarters")
		if not hq is Dictionary or hq.get("kessel") == true:
			continue
		if row.unit.get("moveMode") == true or row.unit.get("reserve") == true:
			continue
		for near: String in data.view.mapGraph.neighbors.get(row.unit.hex, []):
			var edge: Dictionary = data.view.mapGraph.edges.get(_edge_key(row.unit.hex, near), {})
			if edge.get("rail") != null:
				detrainable[row.unit.hex] = true
				break
	var sites := {}
	for hex: String in data.deployment.controlSites:
		sites[hex] = true
	var occupied := {}
	for unit_id: String in units:
		var unit: Dictionary = units[unit_id]
		if unit.get("combat") == true:
			occupied[unit.hex] = unit.side
	var controlled := {}
	var sources := {}
	for hex: String in data.view.mapGraph.neighbors:
		if enemy_combat.has(hex):
			continue
		if _controller(hex, sites, rail_control, occupied, data.deployment.frontControl) != side:
			continue
		controlled[hex] = true
	for hex: String in detrainable:
		if not enemy_combat.has(hex):
			controlled[hex] = true
	var listed: Array = data.view.supplySources.get(side, [])
	for hex: String in listed:
		if controlled.has(hex):
			sources[hex] = true
	return {"sources": _sorted(sources), "controlled": _sorted(controlled),
		"enemyCombat": _sorted(enemy_combat), "unnegatedEnemyZoc": _sorted(unnegated),
		"detrainableFacilities": _sorted(detrainable), "headquarters": headquarters,
		"extenders": extenders, "weather": str(data.view.firstTurn.ground)}


## Only printed control sites carry a controller: rail control, then the occupying combat counter,
## then the opening front (src/match/scorpion-hex-control.ts).
static func _controller(hex: String, sites: Dictionary, rail_control: Dictionary, occupied: Dictionary,
		front: Dictionary) -> String:
	if not sites.has(hex):
		return ""
	if rail_control.has(hex):
		return str(rail_control[hex])
	if occupied.has(hex):
		return str(occupied[hex])
	return str(front.get(hex, ""))


static func _edge_key(a: String, b: String) -> String:
	return "%s|%s" % [a, b] if a < b else "%s|%s" % [b, a]


static func _sorted(dictionary: Dictionary) -> Array:
	var keys: Array = dictionary.keys()
	keys.sort()
	return keys


## OCS v4.3 §4.5a — which trace modes a ZOC hex blocks. Only truck-side modes are negatable.
static func zoc_affects(action: String, raw: bool, negated: bool) -> bool:
	if not raw:
		return false
	if NEGATION_EXEMPT.has(action):
		return true
	if NON_COMBAT_ACTIONS.has(action):
		return not negated
	return not negated
