extends RefCounted

## OCS 13.2c — 运输点重新打包（`repack-transport`）：同格同型、点数与货载守恒、印值分母。

const JsonFile := preload("res://scripts/data/json_file.gd")
const TransportPoints := preload("res://works/third-winter/rules/transport_points.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")

const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var bundle: Dictionary = _read_json(BUNDLE_REL)
	if bundle.is_empty():
		expect.call(false, "08 初设数据包可读（运输点重打包）")
		return
	var catalog: Dictionary = bundle.view.catalog
	var state := _state(catalog)
	var split: Dictionary = TransportPoints.repack(state, "soviet",
		{"unitIds": ["tp2"], "divisions": [{"points": 1, "tokens": 0}, {"points": 1, "tokens": 0}]}, bundle)
	expect.call(split.ok, "2 点拆成 1+1 · " + str(split.get("errorCode", "")))
	if split.ok:
		var after: Dictionary = split.value
		expect.call(after.units.size() == 3, "拆开后多出一枚运输计数器 · 实 %d" % after.units.size())
		expect.call(str(after.units.tp2.definition) == "transport:id:tp_013", "首枚沿用原 id 换成 1 点分母")
		expect.call(str(after.units["transport:soviet:1"].definition) == "transport:id:tp_013",
			"新 id 落第二枚 1 点计数器")
		expect.call(int(after.nextTransportSerial) == 2, "运输序号推进到 2")
	var loaded := _state(catalog)
	loaded.units.tp2.transportCargoTokens = 2
	var carry: Dictionary = TransportPoints.repack(loaded, "soviet",
		{"unitIds": ["tp2"], "divisions": [{"points": 1, "tokens": 1}, {"points": 1, "tokens": 1}]}, bundle)
	expect.call(carry.ok, "2T 货载随 1+1 拆开 · " + str(carry.get("errorCode", "")))
	if carry.ok:
		expect.call(int(carry.value.units.tp2.get("transportCargoTokens", -1)) == 1 \
			and int(carry.value.units["transport:soviet:1"].get("transportCargoTokens", -1)) == 1,
			"两盒各留 1T")
	var lost: Dictionary = TransportPoints.repack(_state(catalog), "soviet",
		{"unitIds": ["tp2"], "divisions": [{"points": 1, "tokens": 0}]}, bundle)
	expect.call(not lost.ok and str(lost.get("errorCode", "")) == "transport_keep",
		"丢掉点数被拒 · " + str(lost.get("errorCode", "")))
	var over := _state(catalog)
	over.units.tp2.transportCargoTokens = 5
	var overloaded: Dictionary = TransportPoints.repack(over, "soviet",
		{"unitIds": ["tp2"], "divisions": [{"points": 1, "tokens": 5}, {"points": 1, "tokens": 0}]}, bundle)
	expect.call(not overloaded.ok and str(overloaded.get("errorCode", "")) == "transport_denomination",
		"货载超过 4×点数被拒 · " + str(overloaded.get("errorCode", "")))
	var thaw := _state(catalog)
	thaw.turn.weather.ground = "thaw"
	var closed: Dictionary = TransportPoints.repack(thaw, "soviet",
		{"unitIds": ["tp2"], "divisions": [{"points": 1, "tokens": 0}, {"points": 1, "tokens": 0}]}, bundle)
	expect.call(not closed.ok and str(closed.get("errorCode", "")) == "transport_window",
		"解冻时不能重打包 · " + str(closed.get("errorCode", "")))
	var moving := _state(catalog)
	moving.moved = ["tp2"]
	moving.groundActivity.transport = {"unitId": "tp2"}
	var resumed: Dictionary = TransportPoints.repack(moving, "soviet",
		{"unitIds": ["tp2"], "divisions": [{"points": 1, "tokens": 0}, {"points": 1, "tokens": 0}],
			"continueWith": 1}, bundle)
	expect.call(resumed.ok and str(resumed.value.groundActivity.transport.unitId) == "transport:soviet:1",
		"正在移动的运输队可续跑新盒 · " + str(resumed.get("errorCode", "")))
	var capped: Dictionary = bundle.duplicate(true)
	for row: Dictionary in capped.view.transportRows:
		if str(row.get("side", "")) == "soviet" and int(row.get("points", 0)) == 1:
			row["limit"] = 2
	var stock_state := _state(capped.view.catalog)
	var over_stock: Dictionary = TransportPoints.repack(stock_state, "soviet",
		{"unitIds": ["tp2"], "divisions": [{"points": 1, "tokens": 0}, {"points": 1, "tokens": 0}]}, capped)
	expect.call(not over_stock.ok and str(over_stock.get("errorCode", "")) == "transport_stock",
		"拆出超过 1 点计数器上限被拒 · " + str(over_stock.get("errorCode", "")))
	for row: Dictionary in capped.view.transportRows:
		if str(row.get("side", "")) == "soviet" and int(row.get("points", 0)) == 1:
			row["limit"] = 3
	var in_stock: Dictionary = TransportPoints.repack(_state(capped.view.catalog), "soviet",
		{"unitIds": ["tp2"], "divisions": [{"points": 1, "tokens": 0}, {"points": 1, "tokens": 0}]}, capped)
	expect.call(in_stock.ok, "库存上限以内可拆 · " + str(in_stock.get("errorCode", "")))
	var menu: Array = ScorpionView.menu_entries(_state(catalog), "soviet", {"unitId": "tp2"}, bundle)
	expect.call(_count_type(menu, "repack-transport") == 1,
		"空载运输算子出行 · 实 %d" % _count_type(menu, "repack-transport"))


static func _state(catalog: Dictionary) -> Dictionary:
	var units := {}
	for id: String in ["tp2", "tp1"]:
		var key := "transport:id:tp_012" if id == "tp2" else "transport:id:tp_013"
		units[id] = catalog.counters[key].duplicate(true)
		units[id]["hex"] = "s1.14"
		units[id]["transportCargoTokens"] = 0
	return {
		"kind": "playing",
		"turn": {"number": 1, "weather": {"ground": "freeze", "flight": "clear"},
			"step": {"kind": "player-turn"}},
		"cursor": {"turn": 1, "phasing": "soviet", "phase": "movement"},
		"units": units,
		"dumps": {},
		"moved": [],
		"nextTransportSerial": 1,
		"groundActivity": {"spent": {}, "transport": null},
	}


static func _count_type(menu: Array, type_name: String) -> int:
	var count := 0
	for row: Dictionary in menu:
		for action: Dictionary in row.get("actions", []):
			if str(action.get("type", "")) == type_name:
				count += 1
	return count


static func _read_json(relative: String) -> Dictionary:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var read: Dictionary = JsonFile.read((base + "/" + relative).simplify_path())
	if read.get("ok", false):
		return read.value.document
	return {}
