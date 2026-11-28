extends RefCounted

## TTW 2.3a / Q05 — Kessel 司令部入盒与移除：两席、返还回合、目标格与侧栏。

const JsonFile := preload("res://scripts/data/json_file.gd")
const Kessel := preload("res://works/third-winter/rules/kessel.gd")
const CombatLosses := preload("res://works/third-winter/rules/combat_losses.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")

const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var bundle: Dictionary = _read_json(BUNDLE_REL)
	if bundle.is_empty():
		expect.call(false, "08 初设数据包可读（Kessel）")
		return
	var state := _state(bundle)
	expect.call(Kessel.window(state, "axis"), "轴心增援阶段开 Kessel 窗口")
	expect.call(not Kessel.window(state, "soviet"), "苏军没有 Kessel 窗口")
	var rows: Array = Kessel.slots(state, bundle)
	expect.call(rows.size() == 2, "08 有两个 Kessel 席位 · 实 %d" % rows.size())
	var slot_4150 := _slot(rows, "hq:id:4150")
	var slot_4151 := _slot(rows, "hq:id:4151")
	expect.call(not slot_4150.get("ready", true) and not str(slot_4150.get("id", "")).is_empty(),
		"4150 开局在盘、不可重复入盒")
	expect.call(slot_4151.get("ready", false), "4151 开局在盒、第 1 回合可入盘")
	var target := str(Kessel.targets(state)[0])
	var placed: Dictionary = Kessel.apply(state, "axis",
		{"type": "place-kessel-hq", "definition": "hq:id:4151", "hex": target}, bundle)
	expect.call(placed.ok, "4151 放入有本方战斗算子的格 · " + str(placed.get("errorCode", "")))
	if not placed.ok:
		return
	var after: Dictionary = placed.value
	expect.call(after.units.has("kessel:hq:id:4151")
		and str(after.units["kessel:hq:id:4151"].hex) == target
		and str(after.units["kessel:hq:id:4151"].definition) == "hq:id:4151",
		"入盘计数器落到目标格且用 4151 模板")
	var placed_snapshot: Dictionary = after.duplicate(true)
	var removed: Dictionary = Kessel.apply(after, "axis",
		{"type": "remove-kessel-hq", "unitId": "kessel:hq:id:4151"}, bundle)
	expect.call(removed.ok and not removed.value.units.has("kessel:hq:id:4151"),
		"盘上的 4151 可移除")
	expect.call(removed.ok and int(removed.value.kesselReturns.get("hq:id:4151", 0)) == 4,
		"移除后记第 4 回合返还")
	var early: Dictionary = removed.value.duplicate(true)
	early.turn.number = 3
	var too_early: Dictionary = Kessel.apply(early, "axis",
		{"type": "place-kessel-hq", "definition": "hq:id:4151", "hex": target}, bundle)
	expect.call(not too_early.ok and str(too_early.get("errorCode", "")) == "kessel_slot",
		"返还回合前不能再入盘")
	early.turn.number = 4
	var returned: Dictionary = Kessel.apply(early, "axis",
		{"type": "place-kessel-hq", "definition": "hq:id:4151", "hex": target}, bundle)
	expect.call(returned.ok, "第 4 回合可返还入盘 · " + str(returned.get("errorCode", "")))
	var lost_state := _state(bundle)
	var lost: Dictionary = CombatLosses.apply_losses(lost_state,
		{"setup:hq:id:4150:1": 1}, bundle, null, [])
	expect.call(lost.ok and int(lost.value.state.kesselReturns.get("hq:id:4150", 0)) == 4,
		"战斗打光 Kessel 司令部也记第 4 回合返还 · " + str(lost.get("errorCode", "")))
	var empty_hex := _empty_hex(bundle, Kessel.targets(state))
	var wrong_hex: Dictionary = Kessel.apply(_state(bundle), "axis",
		{"type": "place-kessel-hq", "definition": "hq:id:4151", "hex": empty_hex}, bundle)
	expect.call(not wrong_hex.ok and str(wrong_hex.get("errorCode", "")) == "kessel_hex",
		"没有本方战斗算子的格拒绝入盘 · " + str(wrong_hex.get("errorCode", "")))
	var duplicate: Dictionary = Kessel.apply(_state(bundle), "axis",
		{"type": "place-kessel-hq", "definition": "hq:id:4150", "hex": target}, bundle)
	expect.call(not duplicate.ok and str(duplicate.get("errorCode", "")) == "kessel_slot",
		"在盘的 4150 不能再次入盘")
	var menu: Array = ScorpionView.menu_entries(_state(bundle), "axis", {"hex": target}, bundle)
	expect.call(_count_type(menu, "place-kessel-hq") == 1,
		"侧栏在目标格给出 4151 入盘行")
	var remove_menu: Array = ScorpionView.menu_entries(placed_snapshot, "axis",
		{"unitId": "kessel:hq:id:4151"}, bundle)
	expect.call(_count_type(remove_menu, "remove-kessel-hq") == 1,
		"选中盘上 Kessel 司令部时给出移除行")


static func _state(bundle: Dictionary) -> Dictionary:
	var opening: Dictionary = bundle.get("opening", {})
	return {
		"kind": "playing",
		"turn": {"number": 1, "step": {"kind": "player-turn"},
			"weather": {"ground": "freeze", "flight": "clear"}},
		"cursor": {"turn": 1, "phasing": "axis", "phase": "reinforcement"},
		"units": (opening.get("units", {}) as Dictionary).duplicate(true),
		"pieces": (opening.get("pieces", []) as Array).duplicate(true),
		"dumps": (opening.get("dumps", {}) as Dictionary).duplicate(true),
		"combat": null,
		"victory": null,
	}


static func _slot(rows: Array, definition: String) -> Dictionary:
	for row: Dictionary in rows:
		if str(row.get("definition", "")) == definition:
			return row
	return {}


static func _empty_hex(bundle: Dictionary, targets: Array) -> String:
	for hex: String in bundle.get("view", {}).get("mapGraph", {}).get("terrains", {}):
		if not targets.has(hex):
			return hex
	return "s1.01"


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
