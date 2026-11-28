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
