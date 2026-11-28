extends RefCounted

## 夺取窗口的手动面板（临时简化版）：窗口待决时面板只给结算行，点一下按候选顺序填好提交。

const JsonFile := preload("res://scripts/data/json_file.gd")
const Capture := preload("res://works/third-winter/rules/capture.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")
const ScorpionMatch := preload("res://works/third-winter/scenarios/08-korsun-pocket/scorpion_match.gd")

const FIXTURE_REL := "../../../dist/godot/08-capture.json"
const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var fixture: Dictionary = _read_json(FIXTURE_REL)
	var bundle: Dictionary = _read_json(BUNDLE_REL)
	if fixture.is_empty() or bundle.is_empty():
		expect.call(false, "08 进格夺取夹具与初设数据包可读（夺取面板）")
		return
	var scenario: Dictionary = _scenario(fixture, "airbase-flip")
	if scenario.is_empty():
		expect.call(false, "夺取面板用例缺少 airbase-flip 场景")
		return
	var entry: Dictionary = Capture.resolve_entry(scenario.get("base", {}).duplicate(true), "soviet",
		str(scenario.get("hex", "")), scenario.get("entrants", []), bundle, false, [], "manual")
	expect.call(entry.ok, "夺取面板前置窗口可建立")
	if not entry.ok:
		return
	var pending: Dictionary = entry.value
	expect.call(pending.get("capture") != null, "夺取面板前置为手动窗口")
	## 归属是必然的：机场已经在进格时翻给夺取方，窗口只等位移安排。
	var flipped := false
	for base: Dictionary in pending.get("airBases", []):
		if str(base.get("hex", "")) == str(scenario.get("hex", "")) and str(base.get("side", "")) == "soviet":
			flipped = true
	expect.call(flipped, "机场归属在进格时已自动改属夺取方，不等玩家确认")
	expect.call(Capture.needs_choice({"aircraft": [{"id": "a", "destinations": [{"kind": "off-map-air"}]}]}) == false,
		"单落点飞机不需要玩家选择")
	expect.call(Capture.needs_choice({"aircraft": [{"id": "a", "destinations": [{"kind": "hex", "hex": "s1.01"}, {"kind": "off-map-air"}]}]}) == true,
		"多落点飞机需要玩家选择")
	expect.call(Capture.needs_choice({"aircraft": [], "transports": [{"kind": "trucks", "members": []}]}) == true,
		"运输队分配需要玩家选择")
	expect.call(Capture.needs_choice({"aircraft": [], "extenders": [{"id": "e"}]}) == true,
		"延补队崩塌需要玩家选择")
	var owner := str((pending.get("capture", {}) as Dictionary).get("owner", ""))
	expect.call(owner == "axis", "机场夺取窗口归原属方轴心")
	## 原属方面板：只有结算行，且行载荷就是一份完整 settle-capture。
	var owner_menu: Array = ScorpionView.menu_entries(pending, owner, {}, bundle)
	expect.call(owner_menu.size() == 1, "夺取窗口待决时面板只列一项")
	var option: Dictionary = owner_menu[0] if not owner_menu.is_empty() else {}
	expect.call(str(option.get("label", "")).begins_with("安排夺取位移"), "面板给出位移安排行 · " + str(option.get("label", "")))
	var actions: Array = option.get("actions", [])
	expect.call(actions.size() == 1 and str(actions[0].get("type", "")) == "settle-capture",
		"结算行载荷是 settle-capture")
	if actions.size() != 1:
		return
	## 需要选落点的飞机少、组合不多时：面板把每套组合列一行，玩家点哪行就按哪套安置。
	var lone: Dictionary = _flexible_choice(pending, 1)
	if not lone.is_empty():
		var lone_menu: Array = ScorpionView.menu_entries(lone, owner, {}, bundle)
		var bases: Array = (lone.get("capture", {}).get("aircraft", []) as Array)[0].get("destinations", [])
		expect.call(lone_menu.size() == bases.size(), "单机多落点面板按候选列出 %d 行 · 实 %d" % [bases.size(), lone_menu.size()])
		var total := (lone.get("capture", {}).get("aircraft", []) as Array).size()
		var seen: Array = []
		for row: Dictionary in lone_menu:
			var row_actions: Array = row.get("actions", [])
			expect.call(row_actions.size() == 1 and str(row_actions[0].get("type", "")) == "settle-capture",
				"单机落点行载荷是 settle-capture · " + str(row.get("label", "")))
			var payload: Array = row_actions[0].get("aircraft", [])
			expect.call(payload.size() == total, "单机落点行安置全部 %d 枚飞机 · 实 %d" % [total, payload.size()])
			var lone_id := str(((lone.get("capture", {}) as Dictionary).get("aircraft", []) as Array)[0].get("id", ""))
			for item: Dictionary in payload:
				if str(item.get("id", "")) == lone_id:
					seen.append(str(item.get("destination", {}).get("hex", "off")))
		var distinct := seen.duplicate()
		for value: String in seen:
			if distinct.count(value) > 1:
				distinct.erase(value)
		expect.call(distinct.size() == bases.size(), "单机落点行确实给出不同落点 · %d 种" % distinct.size())
	var twin: Dictionary = _flexible_choice(pending, 2)
	if not twin.is_empty():
		var twin_menu: Array = ScorpionView.menu_entries(twin, owner, {}, bundle)
		expect.call(twin_menu.size() == 4, "两枚飞机各两落点组合出 4 行 · 实 %d" % twin_menu.size())
		var pairs: Array = []
		for row: Dictionary in twin_menu:
			var row_actions: Array = row.get("actions", [])
			var payload: Array = row_actions[0].get("aircraft", []) if not row_actions.is_empty() else []
			var flexible_pairs: Array = []
			var ids := _flexible_ids(twin)
			for item: Dictionary in payload:
				if ids.has(str(item.get("id", ""))):
					flexible_pairs.append(str(item.get("id", "")) + "=" + str(item.get("destination", {}).get("hex", "off")))
			pairs.append("|".join(flexible_pairs))
		var unique_pairs := pairs.duplicate()
		for value: String in pairs:
			if unique_pairs.count(value) > 1:
				unique_pairs.erase(value)
		expect.call(unique_pairs.size() == 4, "四行各自一套落点组合 · %d 种" % unique_pairs.size())
	var submitted: Dictionary = _submit(pending, owner, actions[0], bundle)
	expect.call(submitted.ok, "点结算行后窗口结清 · " + str(submitted.get("errorCode", "")))
	if not submitted.ok:
		return
	var next: Dictionary = submitted.value.record.state
	expect.call(next.get("capture") == null, "结算后夺取窗口清空")
	## 非原属方面板：只提示等待，不给可提交载荷。
	var other_menu: Array = ScorpionView.menu_entries(pending, "soviet", {}, bundle)
	expect.call(other_menu.size() == 1, "非原属方面板也只有一项提示")
	if not other_menu.is_empty():
		expect.call((other_menu[0].get("actions", []) as Array).is_empty(), "非原属方没有可提交载荷")


static func _flexible_choice(pending: Dictionary, count: int) -> Dictionary:
	var copy: Dictionary = pending.duplicate(true)
	var capture: Variant = copy.get("capture")
	if capture == null or not capture is Dictionary:
		return {}
	var aircraft: Array = (capture as Dictionary).get("aircraft", [])
	if aircraft.size() < count:
		return {}
	var hex_target := str((capture as Dictionary).get("hex", ""))
	if hex_target == "":
		return {}
	for index in range(count):
		var entry: Dictionary = (aircraft[index] as Dictionary).duplicate(true)
		entry["destinations"] = [{"kind": "hex", "hex": hex_target}, {"kind": "off-map-air"}]
		aircraft[index] = entry
	(capture as Dictionary)["aircraft"] = aircraft
	(capture as Dictionary)["transports"] = []
	(capture as Dictionary)["extenders"] = []
	return copy


static func _flexible_ids(pending: Dictionary) -> Array:
	var ids: Array = []
	for entry: Dictionary in (pending.get("capture", {}) as Dictionary).get("aircraft", []):
		if (entry.get("destinations", []) as Array).size() > 1:
			ids.append(str(entry.get("id", "")))
	return ids


static func _submit(state: Dictionary, seat: String, action: Dictionary, bundle: Dictionary) -> Dictionary:
	var record := {"state": state.duplicate(true), "revision": 0, "receipts": []}
	return ScorpionMatch.submit(record, seat,
		{"id": "capture:" + str(action.get("type", "")), "expectedRevision": 0, "action": action}, bundle)


static func _scenario(fixture: Dictionary, name: String) -> Dictionary:
	for scenario: Dictionary in fixture.get("scenarios", []):
		if str(scenario.get("name", "")) == name:
			return scenario
	return {}


static func _read_json(relative: String) -> Dictionary:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var read: Dictionary = JsonFile.read((base + "/" + relative).simplify_path())
	if read.get("ok", false):
		return read.value.document
	return {}
