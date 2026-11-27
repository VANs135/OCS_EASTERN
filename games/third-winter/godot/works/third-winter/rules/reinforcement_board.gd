extends RefCounted

## TTW Scorpion reinforcement board (src/match/scorpion-reinforcement-board.ts).
## Phase occupancy, OCS 13.6 arrival destinations with the 13.6b map-edge substitute, and the
## TTW 1.7a/2.4b Alert HQ locations.

const SupplyPosition := preload("res://works/third-winter/rules/supply_position.gd")
const SupplyTrace := preload("res://works/third-winter/rules/supply_trace.gd")


## Hexes a side currently occupies: counters, air bases, hedgehogs, on-map pieces and dumps.
static func occupancy(state: Dictionary, data: Dictionary) -> Dictionary:
	var result := {"axis": {}, "soviet": {}}
	var units: Dictionary = state.get("units", {})
	for unit_id: String in units:
		var unit: Dictionary = units[unit_id]
		result[unit.side][unit.hex] = true
	for base: Dictionary in state.get("airBases", []):
		if base.get("hex") != null:
			result[base.side][base.hex] = true
	for hex: String in state.get("hedgehogs", {}):
		var hedgehog: Variant = state.hedgehogs[hex]
		if hedgehog is Dictionary:
			result[hedgehog.side][hex] = true
	for piece: Dictionary in state.get("pieces", []):
		var location: Variant = piece.get("location")
		if location is Dictionary and location.get("kind") == "hex":
			result[piece.side][location.hex] = true
	for id: String in state.get("dumps", {}):
		var dump: Dictionary = state.dumps[id]
		var prefix := "%s:hex:" % dump.get("side")
		if dump.get("location") == "on-map" and int(dump.get("tokens", 0)) > 0 and id.begins_with(prefix):
			result[dump.side][id.substr(prefix.length())] = true
	return result


static func _columns(hex: String) -> Array:
	var parts: PackedStringArray = hex.substr(1).split(".")
	return [int(parts[0]), int(parts[1])]


static func on_perimeter(hex: String) -> bool:
	var at := _columns(hex)
	return at[0] == 1 or at[0] == 22 or at[1] == 1 or at[1] == 17


## Cube distance on the inverted-row printed grid (scorpionHexDistance).
static func hex_distance(from: String, to: String) -> int:
	var a := _columns(from)
	var b := _columns(to)
	var aq: int = a[0]
	var ar: int = a[1] - int((a[0] - 1) / 2)
	var bq: int = b[0]
	var br: int = b[1] - int((b[0] - 1) / 2)
	var q := aq - bq
	var r := ar - br
	return maxi(maxi(absi(q), absi(r)), absi(q + r))


## OCS 13.6b — printed interior sites have no map-edge substitution.
static func arrival_destinations(graph: Dictionary, data: Dictionary, state: Dictionary,
		entry: Dictionary) -> Array:
	var enemy := "soviet" if entry.side == "axis" else "axis"
	var blocked := {}
	var occupied: Dictionary = occupancy(state, data)
	for hex: String in occupied[enemy]:
		blocked[hex] = true
	for hex: String in data.view.supplySources.get(enemy, []):
		blocked[hex] = true
	var printed := []
	var at_edge := []
	for hex: String in entry.destinations:
		if graph.get("terrains", {}).has(hex) and not blocked.has(hex):
			printed.append(hex)
		if on_perimeter(hex):
			at_edge.append(hex)
	if printed.size() > 0 or at_edge.is_empty():
		return printed
	var nearby := []
	var closest := 1 << 30
	for hex: String in graph.get("neighbors", {}):
		if not on_perimeter(hex) or blocked.has(hex):
			continue
		var distance := 1 << 30
		for from: String in at_edge:
			distance = mini(distance, hex_distance(from, hex))
		nearby.append({"hex": hex, "distance": distance})
		closest = mini(closest, distance)
	var result := []
	for row: Dictionary in nearby:
		if row.distance == closest:
			result.append(row.hex)
	return result


## TTW 1.7a and 2.4b — an Alert battalion may enter a supplied Axis HQ, Kessel included.
static func alert_destinations(graph: Dictionary, data: Dictionary, state: Dictionary, entry: Dictionary,
		side: String, weather: String) -> Array:
	var definition: Dictionary = data.view.catalog.definitions.get(entry.get("definition"), {})
	if definition.get("side") != "axis":
		return []
	var units: Dictionary = state.get("units", {})
	var position: Dictionary = SupplyPosition.position(units, state.get("railControl", {}), "axis", data)
	var network: RefCounted = SupplyTrace.network(graph, position, "axis", weather)
	var enemy_zoc := {}
	for hex: String in SupplyPosition.enemy_zoc(units, "axis", data):
		enemy_zoc[hex] = true
	var result := {}
	for unit_id: String in units:
		var unit: Dictionary = units[unit_id]
		if unit.get("side") != "axis" or unit.get("headquarters") == null:
			continue
		var name := str(data.view.catalog.definitions.get(unit.get("definition"), {}).get("name", ""))
		if not name.begins_with("Ge HQ "):
			continue
		var hq: Dictionary = unit.headquarters
		var legal: bool = hq.get("kessel") == true
		if not legal:
			legal = unit.get("moveMode") != true and unit.get("reserve") != true \
				and not enemy_zoc.has(unit.hex) \
				and network.has_trace(unit.hex, str(unit.get("traceDrawMobility", "truck")))
		if legal:
			result[unit.hex] = true
	return result.keys()
