extends RefCounted

## 折分离场第二窗口（OCS 20.0a 战后推进）— 08 实库苏军近卫师。
## 入口契约：static func run(ctx: Dictionary) -> void。

const JsonFile := preload("res://scripts/data/json_file.gd")
const ScorpionMatch := preload("res://works/third-winter/scenarios/08-korsun-pocket/scorpion_match.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")
const Breakdown := preload("res://works/third-winter/rules/breakdown.gd")

const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"
const PARENT := "setup:land:id:3064:1"
const COUNTER := "land:id:2575"
const TARGET := "s4.13"


static func run(ctx: Dictionary) -> void:
	var bundle := _read_json(BUNDLE_REL)
	if bundle.is_empty():
		ctx.expect.call(false, "08 初设数据包可读")
		return
	_advance(ctx, bundle)
	_rejections(ctx, bundle)


static func _state(bundle: Dictionary) -> Dictionary:
	var opening: Dictionary = bundle.get("opening", {})
	var state := {
		"kind": "playing",
		"turn": {"number": 1},
		"cursor": {"turn": 1, "phasing": "soviet", "phase": "movement", "retention": 0},
		"units": (opening.get("units", {}) as Dictionary).duplicate(true),
		"pieces": (opening.get("pieces", []) as Array).duplicate(true),
		"dumps": (opening.get("dumps", {}) as Dictionary).duplicate(true),
		"moved": [],
		"groundActivity": {"airlifted": [], "spent": {}},
		"capture": null, "victory": null, "overrunMarch": null,
	}
	state["combat"] = {"kind": "regular", "step": "advance", "attacker": "soviet",
		"attackers": [PARENT], "defenders": [], "target": TARGET, "roll": 7}
	return state


static func _advance(ctx: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var state := _state(bundle)
	var options: Array = Breakdown.advance_options(state, "soviet", PARENT, bundle, [PARENT])
	expect.call(options.size() == 1 and str(options[0].definition) == COUNTER,
		"战后推进可拆出 AR3 的 3-3-3")
	var menu: Array = ScorpionView.menu_entries(state, "soviet", {}, bundle)
	expect.call(_count_advance_breakdown(menu) == 1, "战后推进侧栏给出带拆分的推进行")
	var action := {"type": "advance-after-combat", "unitIds": [PARENT],
		"breakdowns": [{"parentId": PARENT, "definitions": [COUNTER]}]}
	var result := _submit(state, bundle, action, 0)
	expect.call(result.ok, "战后推进拆分进击成功 · " + str(result.get("errorCode", "")))
	if not result.ok:
		return
	var after: Dictionary = result.value.record.state
	var child_id := "breakdown:%s:1" % COUNTER
	expect.call(after.units.has(child_id), "拆分单位随进击入盘")
	expect.call(str(after.units[PARENT].hex) == TARGET and str(after.units[child_id].hex) == TARGET,
		"母单位与拆分单位都进入目标格")
	expect.call(int(after.units[PARENT].stepsLost) == 1, "母单位损一步")
	expect.call(int(after.units[child_id].stepsLost) == 0, "拆分单位满步")
	expect.call(after.get("combat") == null, "进击后清空战斗窗口")
	expect.call((after.get("breakdownDetached", []) as Array).has(child_id),
		"拆分单位进入段末吸收追踪")


static func _rejections(ctx: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var base := _state(bundle)
	var not_departing := {"type": "advance-after-combat", "unitIds": [PARENT],
		"breakdowns": [{"parentId": PARENT, "definitions": [COUNTER]}]}
	var wrong := Breakdown.detach_orders(base, "soviet", [{"parentId": PARENT, "definitions": [COUNTER]}], ["other"], bundle)
	expect.call(not wrong.ok and wrong.get("errorCode") == "breakdown_departing",
		"不在进击名单不能拆")
	var last_step := _state(bundle)
	last_step.units[PARENT]["stepsLost"] = 2
	var last := _submit(last_step, bundle, not_departing, 0)
	expect.call(not last.ok and last.get("errorCode") == "breakdown_count",
		"只剩最后一步不能拆")
	var duplicate := _submit(base, bundle, {"type": "advance-after-combat", "unitIds": [PARENT],
		"breakdowns": [{"parentId": PARENT, "definitions": [COUNTER]},
			{"parentId": PARENT, "definitions": [COUNTER]}]}, 0)
	expect.call(not duplicate.ok and duplicate.get("errorCode") == "breakdown_duplicate",
		"同一母单位不能重复拆")


static func _submit(state: Dictionary, bundle: Dictionary, action: Dictionary, revision: int,
		attackers: Array = [PARENT]) -> Dictionary:
	var combat: Dictionary = state.get("combat", {})
	combat["attackers"] = attackers.duplicate()
	state["combat"] = combat
	var record := {"state": state.duplicate(true), "revision": revision, "receipts": []}
	return ScorpionMatch.submit(record, "soviet", {"id": "advance-breakdown:%d" % revision,
		"expectedRevision": revision, "action": action}, bundle)


static func _count_advance_breakdown(menu: Array) -> int:
	var count := 0
	for entry: Dictionary in menu:
		for action: Dictionary in entry.get("actions", []):
			if str(action.get("type", "")) == "advance-after-combat" \
					and not (action.get("breakdowns", []) as Array).is_empty():
				count += 1
	return count


static func _read_json(relative: String) -> Dictionary:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var read: Dictionary = JsonFile.read((base + "/" + relative).simplify_path())
	if read.get("ok", false):
		return read.value.document
	return {}

