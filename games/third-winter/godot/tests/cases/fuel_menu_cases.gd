extends RefCounted

## 暂驻运输队加油（`fuel-from-paused-transport`）：侧栏只在运输队真的停在
## `groundActivity.transport` 时出行；规则层核对暂停者、油源与 1T 支付。

const JsonFile := preload("res://scripts/data/json_file.gd")
const Fuel := preload("res://works/third-winter/rules/fuel.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")

const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var bundle: Dictionary = _read_json(BUNDLE_REL)
	if bundle.is_empty():
		expect.call(false, "08 初设数据包可读（暂驻运输队加油）")
		return
	var state := _state()
	var menu: Array = ScorpionView.menu_entries(state, "soviet", {"unitId": "tank"}, bundle)
	var rows: Array = []
	for row: Dictionary in menu:
		for action: Dictionary in row.get("actions", []):
			if str(action.get("type", "")) == "fuel-from-paused-transport":
				rows.append(row)
	expect.call(rows.size() == 1, "暂驻运输队给选中算子出行 · 实 %d" % rows.size())
	if rows.size() == 1:
		var action: Dictionary = (rows[0].get("actions", []) as Array)[0]
		expect.call(str(action.get("unitId", "")) == "tank" and str(action.get("transportId", "")) == "truck",
			"行的载荷指向坦克与暂停运输队")
		expect.call(str(rows[0].get("label", "")).contains("暂驻运输队"), "行文案点明暂驻运输队")
	var fueled := _state()
	fueled.units.tank.fueled = true
	var fed_menu: Array = ScorpionView.menu_entries(fueled, "soviet", {"unitId": "tank"}, bundle)
	expect.call(not _has_fuel_row(fed_menu), "已加油的算子不再出行")
	var shifted := _state()
	shifted.groundActivity.transport.unitId = "truck-other"
	var shifted_menu: Array = ScorpionView.menu_entries(shifted, "soviet", {"unitId": "tank"}, bundle)
	expect.call(not _has_fuel_row(shifted_menu), "暂停的不是这支运输队时不出行")
	## 规则层：暂停者不符直接拒。
	var rejected: Dictionary = Fuel.fuel_from_transport(_state(), "soviet", "tank", "truck-other", bundle)
	expect.call(not rejected.ok and str(rejected.get("errorCode", "")) == "fuel_transport_paused",
		"规则层拒绝非暂驻运输队 · " + str(rejected.get("errorCode", "")))
	## 规则层：不需要付油的算子即使有暂停运输队也拒。
	var no_need: Dictionary = Fuel.fuel_from_transport(fueled, "soviet", "tank", "truck", bundle)
	expect.call(not no_need.ok and str(no_need.get("errorCode", "")) == "fuel_not_needed",
		"规则层拒绝不需要付油的算子 · " + str(no_need.get("errorCode", "")))
	## 规则层正路：同格运输队付 1T，坦克标 fueled、运输队 3→2。
	var paid: Dictionary = Fuel.fuel_from_transport(_state(), "soviet", "tank", "truck", bundle)
	expect.call(paid.ok, "暂驻运输队付油成功 · " + str(paid.get("errorCode", "")))
	if paid.ok:
		var next: Dictionary = paid.value
		expect.call(next.units.tank.fueled == true, "付油后坦克标记 fueled")
		expect.call(int(next.units.truck.get("transportCargoTokens", -1)) == 2,
			"运输队油量 3→2 · 实 %d" % int(next.units.truck.get("transportCargoTokens", -1)))


	## 批量油：编队行只列能喂满全编队的来源，规则层付 4T 并盖标记。
	var bulk_menu: Array = ScorpionView.menu_entries(_state(), "soviet", {"unitId": "tank"}, bundle)
	expect.call(_count_type(bulk_menu, "fuel-formation") == 1, "编队批量油出行 · 实 %d" % _count_type(bulk_menu, "fuel-formation"))
	var paid_formation: Dictionary = Fuel.buy_formation_fuel(_state(), "soviet", "1st", "",
		[{"dumpId": "soviet:hex:s1.14", "tokens": Fuel.BULK_FUEL_COST}], bundle)
	expect.call(paid_formation.ok, "编队批量油付账成功 · " + str(paid_formation.get("errorCode", "")))
	if paid_formation.ok:
		var bulk: Dictionary = paid_formation.value
		expect.call(Fuel.has_bulk_fuel(bulk, "tank") and Fuel.has_bulk_fuel(bulk, "inf"),
			"批量油标记覆盖坦克与步兵")
		expect.call(int((bulk.dumps["soviet:hex:s1.14"] as Dictionary).get("tokens", -1)) == 2,
			"补给堆 6T→2T · 实 %d" % int((bulk.dumps["soviet:hex:s1.14"] as Dictionary).get("tokens", -1)))
		var again: Dictionary = Fuel.buy_formation_fuel(bulk, "soviet", "1st", "",
			[{"dumpId": "soviet:hex:s1.14", "tokens": Fuel.BULK_FUEL_COST}], bundle)
		expect.call(not again.ok and str(again.get("errorCode", "")) == "fuel_formation_active",
			"同一编队不能重复盖批量油 · " + str(again.get("errorCode", "")))
	## 司令部批量油：选中司令部才出行，付 4T 后盖 headquartersFuel。
	var hq_menu: Array = ScorpionView.menu_entries(_state(), "soviet", {"unitId": "hq"}, bundle)
	expect.call(_count_type(hq_menu, "fuel-headquarters") == 1, "司令部批量油出行 · 实 %d" % _count_type(hq_menu, "fuel-headquarters"))
	var paid_hq: Dictionary = Fuel.buy_headquarters_fuel(_state(), "soviet", "hq",
		[{"dumpId": "soviet:hex:s1.14", "tokens": Fuel.BULK_FUEL_COST}], bundle)
	expect.call(paid_hq.ok, "司令部批量油付账成功 · " + str(paid_hq.get("errorCode", "")))
	if paid_hq.ok:
		var hq_state: Dictionary = paid_hq.value
		expect.call(Fuel.has_bulk_fuel(hq_state, "hq"), "司令部拿到批量油标记")
		expect.call((hq_state.get("headquartersFuel", []) as Array).size() == 1, "headquartersFuel 记一笔")
		var hq_again: Dictionary = Fuel.buy_headquarters_fuel(hq_state, "soviet", "hq",
			[{"dumpId": "soviet:hex:s1.14", "tokens": Fuel.BULK_FUEL_COST}], bundle)
		expect.call(not hq_again.ok and str(hq_again.get("errorCode", "")) == "fuel_headquarters_active",
			"同一司令部不能重复盖批量油 · " + str(hq_again.get("errorCode", "")))
	## 窗口：解冻时批量油被拒。
	var thaw := _state()
	thaw.turn.weather.ground = "thaw"
	var thaw_buy: Dictionary = Fuel.buy_formation_fuel(thaw, "soviet", "1st", "",
		[{"dumpId": "soviet:hex:s1.14", "tokens": Fuel.BULK_FUEL_COST}], bundle)
	expect.call(not thaw_buy.ok and str(thaw_buy.get("errorCode", "")) == "fuel_window",
		"解冻时不给批量油 · " + str(thaw_buy.get("errorCode", "")))


static func _count_type(menu: Array, type_name: String) -> int:
	var count := 0
	for row: Dictionary in menu:
		for action: Dictionary in row.get("actions", []):
			if str(action.get("type", "")) == type_name:
				count += 1
	return count


static func _has_fuel_row(menu: Array) -> bool:
	for row: Dictionary in menu:
		for action: Dictionary in row.get("actions", []):
			if str(action.get("type", "")) == "fuel-from-paused-transport":
				return true
	return false


static func _state() -> Dictionary:
	return {
		"kind": "playing",
		"turn": {"number": 1, "weather": {"ground": "freeze", "flight": "clear"},
			"step": {"kind": "player-turn"}},
		"cursor": {"turn": 1, "phasing": "soviet", "phase": "movement"},
		"units": {
			"tank": {"side": "soviet", "combat": true, "mobility": "track", "hex": "s1.14",
				"fueled": false, "formation": "1st", "allowance": 6},
			"inf": {"side": "soviet", "combat": true, "mobility": "leg", "hex": "s1.14",
				"fueled": false, "formation": "1st", "allowance": 3},
			"hq": {"side": "soviet", "headquarters": true, "hex": "s1.14", "formation": "1st"},
			"truck": {"side": "soviet", "hex": "s1.14", "transportCargoTokens": 3},
		},
		"groundActivity": {"transport": {"unitId": "truck"}},
		"moved": [],
		"dumps": {"soviet:hex:s1.14": {"side": "soviet", "location": "on-map", "tokens": 6}},
	}


static func _read_json(relative: String) -> Dictionary:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var read: Dictionary = JsonFile.read((base + "/" + relative).simplify_path())
	if read.get("ok", false):
		return read.value.document
	return {}
