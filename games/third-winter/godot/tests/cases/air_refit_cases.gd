extends RefCounted

## 飞机整备（OCS v4.3 §2.2 / §14.2）— 08 实库 24 架飞机与两座机场。
## 覆盖：逐架整备、同一机场只付一次 1T、机场等级 × 2 名额、敌方 ZOC 封锁。
## 入口契约：static func run(ctx: Dictionary) -> void。

const JsonFile := preload("res://scripts/data/json_file.gd")
const ScorpionMatch := preload("res://works/third-winter/scenarios/08-korsun-pocket/scorpion_match.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")
const AirRefit := preload("res://works/third-winter/rules/air_refit.gd")

const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"
const BASE_HEX := "s13.11"
const BASE_DUMP := "axis:hex:s13.11"


static func run(ctx: Dictionary) -> void:
	var bundle := _read_json(BUNDLE_REL)
	if bundle.is_empty():
		ctx.expect.call(false, "08 初设数据包可读")
		return
	_refit_bundle(ctx, bundle)
	_refit_zoc(ctx, bundle)
	_refit_supply(ctx, bundle)


static func _state(bundle: Dictionary) -> Dictionary:
	var opening: Dictionary = bundle.get("opening", {})
	var state := {
		"kind": "playing",
		"turn": {"number": 1},
		"cursor": {"turn": 1, "phasing": "axis", "phase": "aircraft-refit", "retention": 0},
		"units": (opening.get("units", {}) as Dictionary).duplicate(true),
		"pieces": (opening.get("pieces", []) as Array).duplicate(true),
		"dumps": (opening.get("dumps", {}) as Dictionary).duplicate(true),
		"airBases": [
			{"hex": BASE_HEX, "side": "axis", "level": 2},
			{"hex": "s18.07", "side": "soviet", "level": 1},
		],
		"moved": [],
	}
	return state


static func _park_axis(state: Dictionary, count: int) -> Array:
	var ids: Array = []
	for piece: Dictionary in (state.pieces as Array):
		if str(piece.get("side", "")) != "axis" or str(piece.get("kind", "")) != "aircraft":
			continue
		piece["location"] = {"kind": "hex", "hex": BASE_HEX}
		piece["active"] = false
		ids.append(str(piece.get("id", "")))
		if ids.size() >= count:
			break
	return ids


static func _refit_bundle(ctx: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var state := _state(bundle)
	var aircraft_total := 0
	for piece: Dictionary in (state.pieces as Array):
		if str(piece.get("kind", "")) == "aircraft":
			aircraft_total += 1
	expect.call(aircraft_total == 24, "08 实库投影 24 架飞机")
	expect.call((state.airBases as Array).size() == 2, "08 实库投影两座机场")
	var ids := _park_axis(state, 5)
	expect.call(ids.size() == 5, "08 实库至少 5 架轴心飞机可停到 %s" % BASE_HEX)
	var menu: Array = ScorpionView.menu_entries(state, "axis", {}, bundle)
	var count := _count_type(menu, "refit-aircraft")
	expect.call(count == 5, "侧栏逐架列出 5 架待整备飞机")
	var first := _action_of(menu, "refit-aircraft", str(ids[0]))
	expect.call(not first.is_empty(), "首架整备条目存在")
	if first.is_empty():
		return
	var first_call := _submit(state, bundle, first)
	expect.call(first_call.ok, "首架整备成功 · " + str(first_call.get("errorCode", "")))
	if not first_call.ok:
		return
	var after_first: Dictionary = first_call.value.record.state
	expect.call(int(after_first.dumps[BASE_DUMP].tokens) == 3, "机场整备费只扣 1T")
	expect.call(_active(after_first, str(ids[0])), "首架转为 Active")
	var second := _submit(after_first, bundle, {"type": "refit-aircraft", "id": str(ids[1]),
		"hex": BASE_HEX})
	expect.call(second.ok, "同机场第二架免费整备")
	if not second.ok:
		return
	var after_second: Dictionary = second.value.record.state
	expect.call(int(after_second.dumps[BASE_DUMP].tokens) == 3, "第二架不再扣机场费")
	var menu_after: Array = ScorpionView.menu_entries(after_second, "axis", {}, bundle)
	var after_action := _action_of(menu_after, "refit-aircraft", str(ids[2]))
	expect.call(not after_action.is_empty() and not str(after_action.get("label", "")).contains("1T"),
		"已付费机场的后续条目不再标 1T")
	for index in [2, 3]:
		var call := _submit(after_second, bundle, {"type": "refit-aircraft", "id": str(ids[index]),
			"hex": BASE_HEX})
		expect.call(call.ok, "第 %d 架整备成功" % (index + 1))
		if call.ok:
			after_second = call.value.record.state
	expect.call(AirRefit.refit_count(after_second, BASE_HEX) == 4, "二级机场整备 4 架达上限")
	var fifth := _submit(after_second, bundle, {"type": "refit-aircraft", "id": str(ids[4]),
		"hex": BASE_HEX})
	expect.call(not fifth.ok and fifth.get("errorCode") == "air_refit_capacity",
		"第 5 架被机场等级 × 2 名额拒绝")


static func _refit_zoc(ctx: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var state := _state(bundle)
	var ids := _park_axis(state, 1)
	if not state.units.has("setup:land:id:2073:1"):
		expect.call(false, "08 实库含苏军 58 师")
		return
	state.units["setup:land:id:2073:1"]["hex"] = "s13.10"
	# 机场格本来有轴心司令部与地面单位抵消 ZOC；先把它们挪开，才能验证封锁。
	state.units["setup:hq:id:4141:1"]["hex"] = "s13.12"
	state.units["setup:land:id:4012:1"]["hex"] = "s13.12"
	var menu: Array = ScorpionView.menu_entries(state, "axis", {}, bundle)
	expect.call(_count_type(menu, "refit-aircraft") == 0, "敌方 ZOC 落在机场格时不出整备条目")
	var call := _submit(state, bundle, {"type": "refit-aircraft", "id": str(ids[0]),
		"hex": BASE_HEX})
	expect.call(not call.ok and call.get("errorCode") == "air_refit_zoc",
		"敌方 ZOC 封锁的机场经会话层拒绝")
	var negated := state.duplicate(true)
	negated.units["setup:land:id:3967:1"]["hex"] = BASE_HEX
	var menu_negated: Array = ScorpionView.menu_entries(negated, "axis", {}, bundle)
	expect.call(_count_type(menu_negated, "refit-aircraft") == 1,
		"同格本方战斗单位抵消敌方 ZOC 后恢复整备")


static func _refit_supply(ctx: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var state := _state(bundle)
	var ids := _park_axis(state, 1)
	state.dumps.erase(BASE_DUMP)
	var call := _submit(state, bundle, {"type": "refit-aircraft", "id": str(ids[0]),
		"hex": BASE_HEX})
	expect.call(not call.ok and call.get("errorCode") == "air_refit_supply",
		"机场格无 1T 时拒绝整备")


static func _active(state: Dictionary, id: String) -> bool:
	for piece: Dictionary in (state.get("pieces", []) as Array):
		if str(piece.get("id", "")) == id:
			return piece.get("active") == true
	return false


static func _submit(state: Dictionary, bundle: Dictionary, action: Dictionary) -> Dictionary:
	var record := {"state": state.duplicate(true), "revision": 0, "receipts": []}
	return ScorpionMatch.submit(record, "axis",
		{"id": "air-refit:" + str(action.get("id", "")), "expectedRevision": 0, "action": action},
		bundle)


static func _action_of(menu: Array, type_name: String, id: String) -> Dictionary:
	for entry: Dictionary in menu:
		for action: Dictionary in entry.get("actions", []):
			if str(action.get("type", "")) == type_name and str(action.get("id", "")) == id:
				var found: Dictionary = action.duplicate(true)
				found["label"] = str(entry.get("label", ""))
				return found
	return {}


static func _count_type(menu: Array, type_name: String) -> int:
	var count := 0
	for entry: Dictionary in menu:
		for action: Dictionary in entry.get("actions", []):
			if str(action.get("type", "")) == type_name:
				count += 1
	return count


static func _read_json(relative: String) -> Dictionary:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var read: Dictionary = JsonFile.read((base + "/" + relative).simplify_path())
	if read.get("ok", false):
		return read.value.document
	return {}
