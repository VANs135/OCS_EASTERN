extends RefCounted

## OCS 20.0 / 20.0a / 20.0d / 20.0f — 折分离场。
## 创建：多步战斗单位在开始移动时拆出至多若干 1 RE 拆分单位，母单位须留最后一步。
## 吸收：段末与母单位同格且模式/补给状态一致的拆分单位必须并回；本模块只做规则与窗口数据。

const Result := preload("res://scripts/core/result.gd")


static func parent_pool(state: Dictionary, parent_id: String, data: Dictionary) -> String:
	var unit: Dictionary = (state.get("units", {}) as Dictionary).get(parent_id, {})
	return str((data.get("view", {}).get("breakdownParents", {}) as Dictionary).get(
		str(unit.get("definition", "")), ""))


static func _used(state: Dictionary, definition: String) -> int:
	var used := 0
	for unit: Dictionary in (state.get("units", {}) as Dictionary).values():
		if str(unit.get("definition", "")) == definition:
			used += 1
	for piece: Dictionary in (state.get("pieces", []) as Array):
		if str(piece.get("definition", "")) == definition:
			used += 1
	return used


static func copy_count(state: Dictionary, definition: String, data: Dictionary) -> int:
	for row: Dictionary in (data.get("view", {}).get("breakdownRows", []) as Array):
		if str(row.get("definition", "")) == definition:
			var copies: Variant = row.get("copies")
			return 1 if copies == null else max(0, int(copies) - _used(state, definition))
	return 0


static func _free_id(state: Dictionary, definition: String) -> String:
	var occupied := {}
	for id: Variant in (state.get("units", {}) as Dictionary):
		occupied[str(id)] = true
	for piece: Dictionary in (state.get("pieces", []) as Array):
		occupied[str(piece.get("id", ""))] = true
	var returned: Array = (state.get("breakdownReturns", {}) as Dictionary).get(definition, [])
	for id: Variant in returned:
		if not occupied.has(str(id)):
			return str(id)
	var copy := 1
	while true:
		var id := "breakdown:%s:%d" % [definition, copy]
		if not occupied.has(id):
			return id
		copy += 1
	return ""


static func can_detach(parent: Dictionary, count: int) -> bool:
	return parent.get("combat") == true and str(parent.get("combatClass", "")) == "other" \
		and int(parent.get("printedRe", 0)) > 1 and count > 0 \
		and int(parent.get("printedRe", 0)) - int(parent.get("stepsLost", 0)) > count


## 开始移动窗口：本阶段未动、未被空运、未消耗活动点。
static func at_start_of_move(state: Dictionary, side: String, parent_id: String) -> bool:
	var cursor: Dictionary = state.get("cursor", {})
	if str(cursor.get("phase", "")) != "movement" or str(cursor.get("phasing", "")) != side:
		return false
	if (state.get("moved", []) as Array).has(parent_id):
		return false
	var activity: Dictionary = state.get("groundActivity", {})
	if (activity.get("airlifted", []) as Array).has(parent_id):
		return false
	if int((activity.get("spent", {}) as Dictionary).get(parent_id, 0)) > 0:
		return false
	return true


## 单母单位的可拆候选；窗口由调用方先校验（开始移动／战后推进）。
static func _options_raw(state: Dictionary, side: String, parent_id: String, data: Dictionary) -> Array:
	var parent: Dictionary = (state.get("units", {}) as Dictionary).get(parent_id, {})
	if parent.is_empty() or str(parent.get("side", "")) != side or not can_detach(parent, 1):
		return []
	var pool := parent_pool(state, parent_id, data)
	if pool.is_empty():
		return []
	var rows: Array = []
	for row: Dictionary in (data.get("view", {}).get("breakdownRows", []) as Array):
		if str(row.get("pool", "")) != pool or str(row.get("side", "")) != side:
			continue
		var definition := str(row.get("definition", ""))
		if copy_count(state, definition, data) <= 0:
			continue
		var counter: Dictionary = (data.get("view", {}).get("catalog", {}).get(
			"counters", {}) as Dictionary).get(definition, {})
		if int(counter.get("actionRating", 0)) > int(parent.get("actionRating", 0)):
			continue
		rows.append({"definition": definition, "pool": pool,
			"name": str((data.get("view", {}).get("catalog", {}).get("definitions", {}) as Dictionary)
				.get(definition, {}).get("name", definition))})
	return rows


static func options(state: Dictionary, side: String, parent_id: String, data: Dictionary) -> Array:
	if not at_start_of_move(state, side, parent_id):
		return []
	return _options_raw(state, side, parent_id, data)


## OCS 20.0a 第二窗口 — 战后推进前，攻方存活参战者也可拆出，拆分单位随进击进格。
static func advance_options(state: Dictionary, side: String, parent_id: String, data: Dictionary,
		departing: Array) -> Array:
	if not departing.has(parent_id):
		return []
	return _options_raw(state, side, parent_id, data)


static func _clone(state: Dictionary, parent: Dictionary, definition: String, data: Dictionary) -> Dictionary:
	var faces: Dictionary = (data.get("view", {}).get("catalog", {}).get("faces", {}) as Dictionary).get(
		definition, {})
	var raw: Dictionary = faces.get("combat", {})
	if parent.get("moveMode") == true:
		var moved: Variant = faces.get("move")
		if moved is Dictionary:
			raw = moved
	var counter: Dictionary = raw.duplicate(true)
	if counter.is_empty():
		return {}
	counter["hex"] = str(parent.get("hex", ""))
	counter["definition"] = definition
	counter["side"] = str(parent.get("side", ""))
	counter["stepsLost"] = 0
	for key: String in ["disorganized", "reserve", "exploit", "exploitRating", "released",
			"outOfSupply", "internalStocks"]:
		if parent.has(key):
			counter[key] = parent[key]
		else:
			counter.erase(key)
	return counter


## 开始移动窗口的单条命令。战后推进与撤退用 `detach_orders`，不再重复库存/AR/池校验。
static func detach(state: Dictionary, side: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var parent_id := str(action.get("parentId", ""))
	if not at_start_of_move(state, side, parent_id):
		return Result.failure("breakdown_window", "拆分只能在开始移动时进行")
	var result := _detach_orders(state, side, [action], [parent_id], data)
	if not result.ok:
		return result
	return Result.success(result.value.state)


## OCS 20.0a 战后推进窗口：orders 为 [{parentId, definitions}]，departing 为参战进击的存活攻方。
static func detach_orders(state: Dictionary, side: String, orders: Array, departing: Array,
		data: Dictionary) -> Dictionary:
	return _detach_orders(state, side, orders, departing, data)


static func _detach_orders(state: Dictionary, side: String, orders: Array, departing: Array,
		data: Dictionary) -> Dictionary:
	var working: Dictionary = state.duplicate(true)
	var units: Dictionary = working.get("units", {})
	var seen := {}
	var created: Array = []
	var departing_set := {}
	for id: Variant in departing:
		departing_set[str(id)] = true
	for order_value: Variant in orders:
		if not order_value is Dictionary:
			return Result.failure("breakdown_order", "拆分命令格式不正确")
		var order: Dictionary = order_value
		var parent_id := str(order.get("parentId", ""))
		if seen.has(parent_id):
			return Result.failure("breakdown_duplicate", "每个母单位每窗口只能拆一次")
		if not departing_set.has(parent_id):
			return Result.failure("breakdown_departing", "该单位不在本窗口的出发/进击名单")
		var parent: Dictionary = units.get(parent_id, {})
		if parent.is_empty() or str(parent.get("side", "")) != side:
			return Result.failure("breakdown_parent", "请选择本方多步单位")
		var pool := parent_pool(working, parent_id, data)
		if pool.is_empty():
			return Result.failure("breakdown_pool", "该单位没有拆分池")
		var definitions: Array = order.get("definitions", [])
		if definitions.is_empty() or not can_detach(parent, definitions.size()):
			return Result.failure("breakdown_count", "拆分数量超过母单位可留下的步数")
		var legal := {}
		for row: Dictionary in _options_raw(working, side, parent_id, data):
			legal[str(row.definition)] = true
		for definition: Variant in definitions:
			var key := str(definition)
			if not legal.has(key):
				return Result.failure("breakdown_choice", "请选择本池、本行动值以内的拆分单位")
			var counter := _clone(working, parent, key, data)
			if counter.is_empty():
				return Result.failure("breakdown_face", "拆分单位没有可部署面")
			var id := _free_id(working, key)
			units[id] = counter
			created.append(id)
			legal.erase(key)
			if copy_count(working, key, data) <= 0:
				legal.erase(key)
		parent["stepsLost"] = int(parent.get("stepsLost", 0)) + definitions.size()
		units[parent_id] = parent
		seen[parent_id] = true
	working["units"] = units
	var detached_ids: Array = working.get("breakdownDetached", [])
	detached_ids.append_array(created)
	working["breakdownDetached"] = detached_ids
	return Result.success({"state": working, "detachedIds": created})


## 吸收资格：母单位有损失但未打光，拆分单位 AR 不低于母单位，模式/补给旗标一致。
static func can_absorb(parent: Dictionary, detached: Dictionary) -> bool:
	if parent.get("combat") != true or str(parent.get("combatClass", "")) != "other":
		return false
	if int(parent.get("printedRe", 0)) <= 1 or int(parent.get("stepsLost", 0)) <= 0 \
			or int(parent.get("stepsLost", 0)) >= int(parent.get("printedRe", 0)):
		return false
	if detached.get("combat") != true or str(detached.get("combatClass", "")) != "other" \
			or int(detached.get("printedRe", 0)) != 1 or int(detached.get("stepsLost", 0)) != 0:
		return false
	if int(detached.get("actionRating", 0)) < int(parent.get("actionRating", 0)):
		return false
	if (parent.get("moveMode") == true) != (detached.get("moveMode") == true) \
			or (parent.get("reserve") == true) != (detached.get("reserve") == true) \
			or (parent.get("released") == true) != (detached.get("released") == true) \
			or (parent.get("disorganized") == true) != (detached.get("disorganized") == true) \
			or (parent.get("outOfSupply") == true) != (detached.get("outOfSupply") == true) \
			or str(parent.get("internalStocks", "")) != str(detached.get("internalStocks", "")):
		return false
	var parent_exploit = parent.get("exploitRating", true) if parent.get("exploit") == true else false
	var detached_exploit = detached.get("exploitRating", true) if detached.get("exploit") == true else false
	return parent_exploit == detached_exploit


## 段末强制吸收义务：返回 parentId + breakdownIds；任一条未清则阻塞推进。
static func obligations(state: Dictionary, side: String) -> Array:
	var units: Dictionary = state.get("units", {})
	var tracked: Array = state.get("breakdownDetached", [])
	var result: Array = []
	for parent_id: String in units:
		var parent: Dictionary = units[parent_id]
		if str(parent.get("side", "")) != side or int(parent.get("stepsLost", 0)) <= 0:
			continue
		var matching: Array = []
		for detached_id: String in units:
			if detached_id == parent_id or not tracked.has(detached_id):
				continue
			var detached: Dictionary = units[detached_id]
			if str(detached.get("side", "")) == side \
					and str(detached.get("hex", "")) == str(parent.get("hex", "")) \
					and can_absorb(parent, detached):
				matching.append(detached_id)
		if not matching.is_empty():
			result.append({"parentId": parent_id, "breakdownIds": matching})
	return result


static func absorb(state: Dictionary, side: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var parent_id := str(action.get("parentId", ""))
	var detached_id := str(action.get("breakdownId", ""))
	var units: Dictionary = state.get("units", {})
	var parent: Dictionary = units.get(parent_id, {})
	var detached: Dictionary = units.get(detached_id, {})
	if parent.is_empty() or detached.is_empty():
		return Result.failure("breakdown_absorb", "吸收单位不在盘上")
	if str(parent.get("side", "")) != side or str(detached.get("side", "")) != side:
		return Result.failure("breakdown_absorb", "只能吸收本方拆分单位")
	if str(parent.get("hex", "")) != str(detached.get("hex", "")):
		return Result.failure("breakdown_absorb_hex", "拆分单位必须与母单位同格")
	if not can_absorb(parent, detached):
		return Result.failure("breakdown_absorb_flags", "模式或行动值不一致，不能吸收")
	var definition := str(detached.get("definition", ""))
	parent["stepsLost"] = int(parent.get("stepsLost", 0)) - 1
	units[parent_id] = parent
	units.erase(detached_id)
	var returns: Dictionary = state.get("breakdownReturns", {})
	var returned: Array = returns.get(definition, [])
	returned.append(detached_id)
	returns[definition] = returned
	state["units"] = units
	state["breakdownReturns"] = returns
	var tracked: Array = state.get("breakdownDetached", [])
	tracked.erase(detached_id)
	state["breakdownDetached"] = tracked
	var remaining: Array = obligations(state, side)
	if remaining.is_empty():
		state.erase("breakdownAbsorb")
	elif state.get("breakdownAbsorb") is Dictionary:
		var window: Dictionary = state["breakdownAbsorb"]
		window["obligations"] = remaining
		state["breakdownAbsorb"] = window
	return Result.success(state)

