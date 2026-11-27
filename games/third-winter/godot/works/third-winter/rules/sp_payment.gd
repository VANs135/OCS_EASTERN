extends RefCounted

## src/match/scorpion-sp-payment.ts — the concrete-supply ledger for a side: which on-map dumps and
## organic truck loads can reach a counter, what one allotment costs, and how spending settles back
## onto the board. Unloaded-token provenance (`scorpionUnloadedTokens`) needs airlift bookkeeping the
## native state does not carry yet, so spending simply debits `dump.tokens`.

const SupplyPosition := preload("res://works/third-winter/rules/supply_position.gd")
const SupplyTrace := preload("res://works/third-winter/rules/supply_trace.gd")
const Result := preload("res://scripts/core/result.gd")

const ORGANIC_TOKENS := 4

var _state: Dictionary
var _side: String
var _dumps: Dictionary
var _cargo: Dictionary = {}
var _network: RefCounted


func _init(state: Dictionary, side: String, data: Dictionary) -> void:
	_state = state
	_side = side
	_dumps = (state.get("dumps", {}) as Dictionary).duplicate(true)
	var position := SupplyPosition.position(state.get("units", {}), state.get("railControl", {}), side, data)
	var weather := "freeze" if str(state.get("turn", {}).get("weather", {}).get("ground")) == "freeze" else "dry"
	_network = SupplyTrace.network(data.view.mapGraph, position, side, weather)


static func carried_tokens(unit: Dictionary) -> int:
	var cargo: Variant = unit.get("transportCargoTokens")
	if cargo != null:
		return int(cargo)
	return ORGANIC_TOKENS if str(unit.get("organicTruck", "")) == "full" else 0


## A truck counter that still holds a load; combat counters never pay for anyone else.
func _transport(id: String) -> Dictionary:
	var unit: Dictionary = _state.get("units", {}).get(id, {})
	if unit.is_empty() or str(unit.get("side")) != _side or unit.get("combat") == true:
		return {}
	if unit.get("extender") != null:
		return {}
	if unit.get("organicTruck") == null and unit.get("transportCargoTokens") == null:
		return {}
	return unit


## `{hex, tokens, truck}` for a dump id or a truck counter id; empty when the id is not usable.
func source(id: String) -> Dictionary:
	var truck := _transport(id)
	if not truck.is_empty():
		return {"hex": str(truck.get("hex", "")), "tokens": _cargo.get(id, carried_tokens(truck)),
			"truck": truck}
	var prefix := "%s:hex:" % _side
	var dump: Dictionary = _dumps.get(id, {})
	if dump.is_empty() or str(dump.get("side")) != _side or str(dump.get("location")) != "on-map" \
			or not id.begins_with(prefix) or int(dump.get("tokens", 0)) <= 0:
		return {}
	return {"hex": id.substr(prefix.length()), "tokens": int(dump.get("tokens", 0)), "truck": {}}


## OCS 12.6 — a counter draws from a dump it can trace to, or through a throwing HQ.
func can_use(unit: Dictionary, id: String, method: Dictionary = {}) -> bool:
	var from := source(id)
	if from.is_empty():
		return false
	var truck: Dictionary = from.get("truck", {})
	## OCS 12.5 — an organic truck only hauls for its own formation.
	if truck.has("organicTruck"):
		if str(unit.get("formation", "")) == "" or str(unit.get("formation")) != str(truck.get("formation", "")):
			return false
	var hex := str(unit.get("hex", ""))
	var mobility := str(unit.get("traceDrawMobility", unit.get("mobility", "truck")))
	if method.has("headquartersId"):
		return _network.can_use_dump_via(str(method.headquartersId), hex, str(from.hex))
	if method.is_empty():
		return _network.can_use_dump(hex, str(from.hex), mobility)
	return _network.can_draw_dump(hex, str(from.hex), mobility)


## All sources that can feed every one of `units`, with the tokens each still holds.
func available(units: Array, include_organic: bool = true) -> Array:
	var prefix := "%s:hex:" % _side
	var on_map: Array = []
	for id: String in _dumps:
		var dump: Dictionary = _dumps[id]
		if not id.begins_with(prefix) or str(dump.get("side")) != _side \
				or str(dump.get("location")) != "on-map" or int(dump.get("tokens", 0)) <= 0:
			continue
		on_map.append(id)
	var transports: Array = []
	for id: String in _state.get("units", {}):
		var truck := _transport(id)
		if truck.is_empty():
			continue
		if not include_organic and truck.get("organicTruck") != null:
			continue
		if int(_cargo.get(id, carried_tokens(truck))) <= 0:
			continue
		transports.append(id)
	var result: Array = []
	for id: Variant in on_map + transports:
		var reachable := true
		for unit: Dictionary in units:
			if not can_use(unit, str(id)):
				reachable = false
				break
		if not reachable:
			continue
		var from := source(str(id))
		if from.is_empty():
			continue
		result.append({"dumpId": str(id), "tokens": int(from.tokens)})
	return result


## Debits the given rows after `permitted` clears them; a rejected row leaves the ledger untouched.
func spend(payments: Array, permitted: Callable) -> Dictionary:
	var debits: Array = []
	var seen := {}
	for row: Dictionary in payments:
		var id := str(row.get("dumpId", ""))
		var tokens := int(row.get("tokens", 0))
		var from := source(id)
		if seen.has(id) or from.is_empty() or tokens < 1 or tokens > int(from.tokens):
			return Result.failure("supply_payment",
				"补给须来自可追溯的本方补给堆或运输车，且油量足够")
		if not permitted.call(row):
			return Result.failure("supply_payment",
				"这枚单位无法使用该补给来源")
		seen[id] = true
		debits.append({"id": id, "tokens": tokens, "truck": not (from.get("truck", {}) as Dictionary).is_empty()})
	for debit: Dictionary in debits:
		var id: String = debit.id
		if debit.truck:
			var truck := _transport(id)
			_cargo[id] = int(_cargo.get(id, carried_tokens(truck))) - int(debit.tokens)
		else:
			var dump: Dictionary = _dumps[id]
			var next: Dictionary = dump.duplicate(true)
			next.tokens = int(dump.get("tokens", 0)) - int(debit.tokens)
			_dumps[id] = next
	return Result.success({})


## Writes the truck cargo back onto the counters and returns the debited dumps.
func settle(units: Dictionary) -> Dictionary:
	var counters: Dictionary = units.duplicate(true)
	for id: String in _cargo:
		if counters.has(id):
			counters[id].transportCargoTokens = int(_cargo[id])
	return {"units": counters, "dumps": _dumps.duplicate(true)}


func dumps() -> Dictionary:
	return _dumps.duplicate(true)
