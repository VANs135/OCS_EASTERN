extends RefCounted

## 08 折分第三窗口：战后撤退前拆出，拆分单位随撤退堆沿路线落地。
## 对照 TS scorpion-retreat.ts 的 prepareRoute / detachScorpionBreakdowns。

const JsonFile := preload("res://scripts/data/json_file.gd")
const Retreat := preload("res://works/third-winter/rules/retreat.gd")
const Breakdown := preload("res://works/third-winter/rules/breakdown.gd")

const FIXTURE_REL := "../../../dist/godot/08-retreat.json"
const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var fixture: Dictionary = _read_json(FIXTURE_REL)
	var bundle: Dictionary = _read_json(BUNDLE_REL)
	if fixture.is_empty() or bundle.is_empty():
		expect.call(false, "08 折分撤退夹具与初设数据包可读")
		return
	var scenario: Dictionary = _scenario_by_name(fixture, "zoc-loss")
	if scenario.is_empty():
		expect.call(false, "08 折分撤退缺少 zoc-loss 局面")
		return
	var state: Dictionary = scenario.get("base", {}).duplicate(true)
	state.combat = scenario.get("steps", [])[0].get("combat", {}).duplicate(true)
	var parent_id := str(scenario.get("defenderId", ""))
	var parent: Dictionary = state.get("units", {}).get(parent_id, {})
	expect.call(Breakdown.can_detach(parent, 1), "3951 在损失两步后仍可拆出一步")

	# 正式库轴心池已被盘上同定义计数吃满：先验证真实库存为零。
	expect.call(Breakdown.retreat_options(state, "axis", parent_id, bundle, [parent_id]).is_empty(),
		"正式池无可用轴心拆分单位时撤退菜单不列拆分")

	# 只把轴心 4008 的池上限放大，验证拆出与随撤退落地链路。
	var data: Dictionary = bundle.duplicate(true)
	for row: Dictionary in data.get("view", {}).get("breakdownRows", []):
		if str(row.get("definition", "")) == "land:id:4008":
			row["copies"] = 9
	var choices: Array = Breakdown.retreat_options(state, "axis", parent_id, data, [parent_id])
	expect.call(choices.size() == 1 and str(choices[0].get("definition", "")) == "land:id:4008",
		"撤退窗口列出 Axis 4-4-3 拆分单位")
	if choices.is_empty():
		return

	var res: Dictionary = Retreat.retreat(state, "axis", [parent_id], 1,
		[{"group": "group:0", "units": [parent_id], "path": ["s1.09"],
			"breakdowns": [{"parentId": parent_id, "definitions": ["land:id:4008"]}]}],
		state.combat, data)
	expect.call(res.ok, "撤退前拆出并沿路线落地 · " + str(res.get("errorCode", "")))
	if not res.ok:
		return
	var settled: Dictionary = res.value.state
	var breakdown_id := "breakdown:land:id:4008:1"
	var child: Dictionary = settled.get("units", {}).get(breakdown_id, {})
	var moved_parent: Dictionary = settled.get("units", {}).get(parent_id, {})
	expect.call(not child.is_empty(), "拆出的 4008 进入盘面")
	expect.call(str(moved_parent.get("hex", "")) == "s1.09" and str(child.get("hex", "")) == "s1.09",
		"母单位与拆分单位同格落地")
	expect.call(int(moved_parent.get("stepsLost", 0)) == 3, "母单位从损失两步变损失三步")
	expect.call((moved_parent.get("moveMode") == true) == (child.get("moveMode") == true),
		"拆分单位与母单位朝向一致（3951 本身带移动额，TS 不强制换面）")
	expect.call(settled.get("pendingRetreat") == null, "无夺取时撤退当场走完")

	# 非本窗口出发名单：直接拒绝，不落拆分。
	var outside: Dictionary = Breakdown.detach_orders(state, "axis",
		[{"parentId": parent_id, "definitions": ["land:id:4008"]}], [], data)
	expect.call(not outside.ok and str(outside.get("errorCode", "")) == "breakdown_departing",
		"不在撤退堆内的母单位拒绝拆出")

	# 正式池库存为零时，带拆分的撤退路线建立失败且不改盘面。
	var starved: Dictionary = Retreat.retreat(state, "axis", [parent_id], 1,
		[{"group": "group:0", "units": [parent_id], "path": ["s1.09"],
			"breakdowns": [{"parentId": parent_id, "definitions": ["land:id:4008"]}]}],
		state.combat, bundle)
	expect.call(not starved.ok and str(starved.get("errorCode", "")) == "breakdown_choice",
		"正式池无库存时拒绝带拆分的撤退计划")


static func _scenario_by_name(fixture: Dictionary, name: String) -> Dictionary:
	for scenario: Dictionary in fixture.get("scenarios", []):
		if str(scenario.get("name", "")) == name:
			return scenario
	return {}


static func _read_json(relative: String) -> Dictionary:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var path: String = (base + "/" + relative).simplify_path()
	var read: Dictionary = JsonFile.read(path)
	if not read.get("ok", false):
		return {}
	return read.value.document
