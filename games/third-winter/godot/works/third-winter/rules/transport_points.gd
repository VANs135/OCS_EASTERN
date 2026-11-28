extends RefCounted

## OCS 13.2c / 6.1f — 把同一格、同型的普通运输算子重新打包成印值点数。
## 移植自 `src/match/scorpion-transport-points.ts` 的 `repackScorpionTransport`；
## 印值分母从原生 `data.view.catalog.definitions` 读，部署模板取 `catalog.counters`。

const Result := preload("res://scripts/core/result.gd")
const SpPayment := preload("res://works/third-winter/rules/sp_payment.gd")


## `assertScorpionTransportWindow`：本方玩家回合、移动段、未解冻、无战斗/炮击待决。
static func window(state: Dictionary, side: String) -> bool:
	if state.get("kind") != "playing" or state.get("victory") != null:
		return false
	var turn: Dictionary = state.get("turn", {})
	if str(turn.get("step", {}).get("kind", "")) != "player-turn":
		return false
	var cursor: Dictionary = state.get("cursor", {})
	if str(cursor.get("phasing", "")) != side or str(cursor.get("phase", "")) != "movement":
		return false
	if str(turn.get("weather", {}).get("ground", "")) == "thaw":
		return false
	if state.get("combat") != null or state.get("barrage") != null:
		return false
	return true


## `transportPoints(definition)` — 运输印值点数；非运输/无点数返回 0。
static func points(unit: Dictionary, data: Dictionary) -> int:
	var definition: Dictionary = _definition(data, str(unit.get("definition", "")))
	if str(definition.get("kind", "")) != "transport":
		return 0
	var value: Variant = definition.get("transport")
	if value == null:
		return 0
	var count := int(value)
	return count if count > 0 else 0


static func tokens(unit: Dictionary) -> int:
	return SpPayment.carried_tokens(unit)


## `collectTransportPoints`：同一格、同 allowance/mobility 的普通运输算子，逐枚给出点数与货载。
static func collect(state: Dictionary, side: String, ids: Array, data: Dictionary) -> Dictionary:
	if ids.is_empty():
		return Result.failure("transport_choice", "请选择运输算子")
	var seen := {}
	for value: Variant in ids:
		var id := str(value)
		if seen.has(id):
			return Result.failure("transport_choice", "运输算子不能重复选择")
		seen[id] = true
	var first: Dictionary = state.get("units", {}).get(str(ids[0]), {})
	if first.is_empty():
		return Result.failure("transport_choice", "请选择同一格的普通运输算子")
	var rows: Array = []
	for value: Variant in ids:
		var id := str(value)
		var unit: Dictionary = state.get("units", {}).get(id, {})
		var definition: Dictionary = _definition(data, str(unit.get("definition", "")))
		var count := points(unit, data)
		if unit.is_empty() or unit.get("combat") == true or str(unit.get("side", "")) != side \
				or unit.get("organicTruck") != null or unit.get("extender") != null \
				or str(definition.get("kind", "")) != "transport" or count <= 0:
			return Result.failure("transport_choice", "请选择同一格的普通运输算子")
		if str(unit.get("hex", "")) != str(first.get("hex", "")) \
				or int(unit.get("allowance", 0)) != int(first.get("allowance", 0)) \
				or str(unit.get("mobility", "")) != str(first.get("mobility", "")):
			return Result.failure("transport_choice", "运输算子须同格、同型")
		rows.append({"id": id, "unit": unit, "points": count, "tokens": tokens(unit)})
	return Result.success({"rows": rows, "points": _sum(rows, "points"), "tokens": _sum(rows, "tokens")})


## `regularTransportDefinition`：在同方、同 mobility/allowance 的运输印值里找指定点数的那一枚。
static func regular_definition(catalog: Dictionary, base: Dictionary, count: int) -> String:
	if count <= 0:
		return ""
	var definitions: Dictionary = catalog.get("definitions", {})
	var mobility := str(base.get("mobility", ""))
	var allowance := int(base.get("allowance", 0))
	for key: String in definitions:
		var row: Dictionary = definitions[key]
		if str(row.get("kind", "")) != "transport" or str(row.get("side", "")) != str(base.get("side", "")):
			continue
		if (row.get("abilities", []) as Array).has("organic_truck"):
			continue
		var profile: Dictionary = row.get("moveProfile", {})
		if str(profile.get("mobility", "track")) == "track":
			continue
		if str(profile.get("mobility", "")) != mobility or int(profile.get("allowance", 0)) != allowance:
			continue
		if int(row.get("transport", 0)) != count:
			continue
		return key
	return ""


## `deployScorpionGroundCounter`：catalog 模板 + 落格 + 步损 0；模板缺失时不臆造计数器。
static func deploy(catalog: Dictionary, definition: String, hex: String) -> Dictionary:
	var template: Dictionary = catalog.get("counters", {}).get(definition, {})
	if template.is_empty():
		return {}
	var unit: Dictionary = template.duplicate(true)
	unit["hex"] = hex
	unit["stepsLost"] = 0
	return unit


## `repackScorpionTransport`：全部点数与货载都要留在新分母里。
static func repack(state: Dictionary, side: String, action: Dictionary, data: Dictionary) -> Dictionary:
	if not window(state, side):
		return Result.failure("transport_window", "只能在并非解冻的移动段重新打包运输点")
	var ids: Array = action.get("unitIds", [])
	var collected: Dictionary = collect(state, side, ids, data)
	if not collected.ok:
		return collected
	var rows: Array = collected.value.rows
	var total_points := int(collected.value.points)
	var total_tokens := int(collected.value.tokens)
	var divisions: Array = action.get("divisions", [])
	if divisions.is_empty() or _sum(divisions, "points") != total_points or _sum(divisions, "tokens") != total_tokens:
		return Result.failure("transport_keep", "必须保留全部运输点与货载")
	var catalog: Dictionary = data.get("view", {}).get("catalog", {})
	var base: Dictionary = rows[0].unit
	var replacements: Array = []
	for value: Variant in divisions:
		var division: Dictionary = value
		var count := int(division.get("points", 0))
		var load := int(division.get("tokens", 0))
		var key := regular_definition(catalog, base, count)
		if key.is_empty() or count <= 0 or load < 0 or load > count * 4:
			return Result.failure("transport_denomination", "请选择印值分母，且货载不超过点数 × 4")
		var unit := deploy(catalog, key, str(base.get("hex", "")))
		if unit.is_empty():
			return Result.failure("transport_denomination", "计数器库存里没有对应的运输模板")
		unit["transportCargoTokens"] = load
		replacements.append(unit)
	## `Only the active transport may retain movement after repacking`
	var activity: Dictionary = state.get("groundActivity", {})
	var paused: Variant = activity.get("transport")
	var active := "" if paused == null else str((paused as Dictionary).get("unitId", ""))
	var started := false
	var ended := false
	var moved: Array = state.get("moved", [])
	for value: Variant in ids:
		var id := str(value)
		if moved.has(id):
			started = true
			if id != active:
				ended = true
	var has_continuation := action.has("continueWith")
	var continuation := -1
	if has_continuation:
		continuation = int(action.get("continueWith", -1))
		if ended or not ids.has(active) or continuation < 0 or continuation >= replacements.size():
			return Result.failure("transport_continuation", "只有正在移动的运输队可以保留续跑")
	var spent_book: Dictionary = activity.get("spent", {}).duplicate()
	var max_spent := 0
	for value: Variant in ids:
		max_spent = maxi(max_spent, int(spent_book.get(str(value), 0)))
	var units: Dictionary = state.get("units", {}).duplicate(true)
	for value: Variant in ids:
		units.erase(str(value))
		spent_book.erase(str(value))
	var serial := int(state.get("nextTransportSerial", 1))
	var new_ids: Array = []
	for index in replacements.size():
		var new_id := ""
		if index < ids.size():
			new_id = str(ids[index])
		else:
			while true:
				new_id = "transport:%s:%d" % [side, serial]
				serial += 1
				if not units.has(new_id):
					break
		units[new_id] = replacements[index]
		spent_book[new_id] = max_spent
		new_ids.append(new_id)
	var open := ""
	if has_continuation:
		open = str(new_ids[continuation])
	var kept_moved: Array = []
	for value: Variant in moved:
		if not ids.has(str(value)):
			kept_moved.append(value)
	if started or not open.is_empty():
		for value: Variant in new_ids:
			kept_moved.append(value)
	var entered := false
	if paused != null:
		entered = bool((paused as Dictionary).get("enteredHex", false))
	state["units"] = units
	state["nextTransportSerial"] = serial
	state["moved"] = kept_moved
	var next_activity: Dictionary = activity.duplicate(true)
	next_activity["spent"] = spent_book
	next_activity["transport"] = null if open.is_empty() else {"unitId": open, "enteredHex": entered}
	state["groundActivity"] = next_activity
	state["overrunMarch"] = null
	state["groundCaptureMove"] = null
	return Result.success(state)


static func _definition(data: Dictionary, key: String) -> Dictionary:
	return data.get("view", {}).get("catalog", {}).get("definitions", {}).get(key, {})


static func _sum(rows: Array, field: String) -> int:
	var total := 0
	for row: Dictionary in rows:
		total += int(row.get(field, 0))
	return total
