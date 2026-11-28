extends RefCounted

## OCS v4.3 §2.2 / §14.2 — 飞机整备阶段：每个机场付 1T，可整备“机场等级 × 2”架
## 本方 Inactive 飞机，令其转为 Active。机场若处于未被抵消的敌方 ZOC，不能整备。
## 本切片只做“激活”，不处理减员恢复、转场或任务；整备费用从机场格的补给堆支取。

const SupplyPosition := preload("res://works/third-winter/rules/supply_position.gd")
const Result := preload("res://scripts/core/result.gd")


static func base_at(state: Dictionary, side: String, hex: String) -> Dictionary:
	for base: Dictionary in (state.get("airBases", []) as Array):
		if str(base.get("side", "")) == side and str(base.get("hex", "")) == hex \
				and int(base.get("level", 0)) > 0:
			return base
	return {}


static func _book(state: Dictionary) -> Dictionary:
	var book: Variant = state.get("airRefit")
	if book is Dictionary:
		return book
	return {"paid": {}, "counts": {}, "ids": []}


static func refit_count(state: Dictionary, hex: String) -> int:
	return int((_book(state).get("counts", {}) as Dictionary).get(hex, 0))


static func paid(state: Dictionary, hex: String) -> bool:
	return (_book(state).get("paid", {}) as Dictionary).has(hex)


## 同格本方战斗单位抵消敌方 ZOC；只有敌方 ZOC 落在机场格且本格没有本方战斗单位时才封锁。
static func blocked(state: Dictionary, side: String, hex: String, data: Dictionary) -> bool:
	var units: Dictionary = state.get("units", {})
	var zoc: Array = SupplyPosition.enemy_zoc(units, side, data)
	if not zoc.has(hex):
		return false
	for unit_id: String in units:
		var unit: Dictionary = units[unit_id]
		if str(unit.get("side", "")) == side and unit.get("combat") == true \
				and str(unit.get("hex", "")) == hex:
			return false
	return true


static func pending_aircraft(state: Dictionary, side: String, hex: String) -> Array:
	var ids: Array = []
	for piece: Dictionary in (state.get("pieces", []) as Array):
		if str(piece.get("side", "")) != side or str(piece.get("kind", "")) != "aircraft":
			continue
		var location: Dictionary = piece.get("location", {})
		if str(location.get("kind", "")) != "hex" or str(location.get("hex", "")) != hex:
			continue
		if piece.get("active") == true:
			continue
		ids.append(str(piece.get("id", "")))
	return ids


## 侧栏候选：每个可整备机场一行一架，首架带 1T（已付过的机场不带）。
static func base_options(state: Dictionary, side: String, data: Dictionary) -> Array:
	var options: Array = []
	for base: Dictionary in (state.get("airBases", []) as Array):
		if str(base.get("side", "")) != side:
			continue
		var hex := str(base.get("hex", ""))
		var level := int(base.get("level", 0))
		if level <= 0 or blocked(state, side, hex, data):
			continue
		if refit_count(state, hex) >= level * 2:
			continue
		for id: String in pending_aircraft(state, side, hex):
			options.append({"hex": hex, "level": level, "paid": paid(state, hex),
				"capacity": level * 2, "used": refit_count(state, hex), "id": id})
	return options


static func apply(state: Dictionary, side: String, action: Dictionary, data: Dictionary) -> Dictionary:
	if str(state.get("kind", "")) != "playing":
		return Result.failure("match_not_started", "请先开始对局")
	if str(state.get("cursor", {}).get("phase", "")) != "aircraft-refit":
		return Result.failure("air_refit_phase", "当前不是飞机整备阶段")
	if str(state.get("cursor", {}).get("phasing", "")) != side:
		return Result.failure("air_refit_actor", "只能整备本方飞机")
	var hex := str(action.get("hex", ""))
	var base := base_at(state, side, hex)
	if base.is_empty():
		return Result.failure("air_refit_base", "请选择本方机场")
	if blocked(state, side, hex, data):
		return Result.failure("air_refit_zoc", "机场处于未被抵消的敌方 ZOC，不能整备")
	var capacity := int(base.get("level", 0)) * 2
	if refit_count(state, hex) >= capacity:
		return Result.failure("air_refit_capacity", "该机场本阶段整备名额已满")
	var id := str(action.get("id", ""))
	var aircraft: Dictionary = {}
	for piece: Dictionary in (state.get("pieces", []) as Array):
		if str(piece.get("id", "")) == id:
			aircraft = piece
			break
	if aircraft.is_empty() or str(aircraft.get("side", "")) != side \
			or str(aircraft.get("kind", "")) != "aircraft":
		return Result.failure("invalid_aircraft", "请选择本方待整备飞机")
	var location: Dictionary = aircraft.get("location", {})
	if str(location.get("kind", "")) != "hex" or str(location.get("hex", "")) != hex:
		return Result.failure("air_refit_location", "飞机不在该机场")
	if aircraft.get("active") == true:
		return Result.failure("air_refit_active", "该飞机已经处于 Active")
	var dumps: Dictionary = state.get("dumps", {})
	var book := _book(state)
	if not paid(state, hex):
		var dump_key := "%s:hex:%s" % [side, hex]
		var dump: Dictionary = dumps.get(dump_key, {})
		if dump.is_empty() or int(dump.get("tokens", 0)) < 1:
			return Result.failure("air_refit_supply", "机场格没有 1T 可支付整备费用")
		var paid_dump := dump.duplicate(true)
		paid_dump["tokens"] = int(dump.get("tokens", 0)) - 1
		dumps[dump_key] = paid_dump
		state["dumps"] = dumps
		var paid_map: Dictionary = book.get("paid", {})
		paid_map[hex] = true
		book["paid"] = paid_map
	aircraft["active"] = true
	var counts: Dictionary = book.get("counts", {})
	counts[hex] = int(counts.get(hex, 0)) + 1
	book["counts"] = counts
	var ids: Array = book.get("ids", [])
	ids.append(id)
	book["ids"] = ids
	state["airRefit"] = book
	return Result.success(state)
