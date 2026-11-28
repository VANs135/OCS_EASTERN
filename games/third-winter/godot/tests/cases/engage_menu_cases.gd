extends RefCounted

## 攻击菜单：`scorpion_view._append_engage_menu` 给出的行必须能被会话接受，且只在允许的时刻出现。

const JsonFile := preload("res://scripts/data/json_file.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")
const ScorpionMatch := preload("res://works/third-winter/scenarios/08-korsun-pocket/scorpion_match.gd")

const OPENING_REL := "../../../dist/godot/08-opening-data.json"


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var bundle := _read_json(OPENING_REL)
	if bundle.is_empty():
		expect.call(false, "08 数据包可读（攻击菜单）")
		return
	var opening: Dictionary = bundle.get("opening", {})
	var state := {
		"kind": "playing",
		"turn": {"number": 1, "weather": {"ground": "freeze", "flight": "clear"}},
		"cursor": {"turn": 1, "phasing": "axis", "phase": "combat", "retention": 0},
		"units": (opening.get("units", {}) as Dictionary).duplicate(true),
		"dumps": (opening.get("dumps", {}) as Dictionary).duplicate(true),
		"pieces": [],
		"moved": [],
		"railControl": {},
		"combat": null,
		"combatTargets": [],
		"combatAttackers": [],
		"rng": {"seed": 19440126, "state": 3682571752, "drawCount": 0},
	}
	var placement := _place_pair(state, bundle)
	if placement.is_empty():
		expect.call(false, "初设里找得到可互相接战的敌我战斗算子")
		return
	var attacker := str(placement.id)
	var target := str(placement.hex)
	var menu: Array = ScorpionView.menu_entries(state, "axis", {"unitId": attacker, "hex": target}, bundle)
	var attacks: Array = _attack_offers(menu)
	expect.call(attacks.size() > 0, "战斗阶段选择相邻敌格给出攻击行")
	if attacks.is_empty():
		return
	var res := _submit(state, bundle, attacks[0])
	expect.call(bool(res.get("ok", false)), "攻击行可直接宣告战斗 · " + str(res.get("errorCode", "")))
	if res.get("ok", false):
		var next: Dictionary = res.value.record.state
		expect.call(next.get("combat") != null, "宣告后进入战斗窗口")
		expect.call((next.get("combatAttackers", []) as Array).has(attacker), "攻方算子记入 combatAttackers")
		var again: Array = ScorpionView.menu_entries(next, "axis", {"unitId": attacker, "hex": target}, bundle)
		expect.call(_attack_offers(again).is_empty(), "已参战的算子不再列攻击行")
	## 反应阶段不列攻击行（TS `engagementChoices` 只在非反应阶段宣告）。
	var reaction := state.duplicate(true)
	(reaction["cursor"] as Dictionary)["phase"] = "reaction"
	var reaction_menu: Array = ScorpionView.menu_entries(reaction, "axis",
		{"unitId": attacker, "hex": target}, bundle)
	expect.call(_attack_offers(reaction_menu).is_empty(), "反应阶段不列攻击行")
	## 解冻天气不出战。
	var thaw := state.duplicate(true)
	(thaw["turn"]["weather"] as Dictionary)["ground"] = "thaw"
	var thaw_menu: Array = ScorpionView.menu_entries(thaw, "axis",
		{"unitId": attacker, "hex": target}, bundle)
	expect.call(_attack_offers(thaw_menu).is_empty(), "解冻天气不列攻击行")
	## 目标不是邻格时不列行。
	var far := state.duplicate(true)
	var far_hex := _far_hex(bundle, target)
	if not far_hex.is_empty():
		var far_menu: Array = ScorpionView.menu_entries(far, "axis",
			{"unitId": attacker, "hex": far_hex}, bundle)
		expect.call(_attack_offers(far_menu).is_empty(), "非邻格不列攻击行 · " + far_hex)


## 把一个轴心攻击单位摆到某枚苏军战斗算子旁边；只补局面，不改规则。
static func _place_pair(state: Dictionary, bundle: Dictionary) -> Dictionary:
	var neighbors: Dictionary = bundle.get("view", {}).get("mapGraph", {}).get("neighbors", {})
	for soviet_id: String in state.get("units", {}):
		var soviet: Dictionary = state.units[soviet_id]
		if str(soviet.get("side", "")) != "soviet" or soviet.get("combat") != true:
			continue
		var at := str(soviet.get("hex", ""))
		for near: Variant in neighbors.get(at, []):
			var from := str(near)
			for axis_id: String in state.get("units", {}):
				var axis: Dictionary = state.units[axis_id]
				if str(axis.get("side", "")) != "axis" or axis.get("attackCapable") != true:
					continue
				if int(axis.get("printedRe", 0)) - int(axis.get("stepsLost", 0)) <= 0:
					continue
				state.units[axis_id].hex = from
				return {"id": axis_id, "hex": at}
	return {}


static func _far_hex(bundle: Dictionary, target: String) -> String:
	var neighbors: Dictionary = bundle.get("view", {}).get("mapGraph", {}).get("neighbors", {})
	var near: Array = neighbors.get(target, [])
	for hex: String in neighbors:
		if str(hex) != target and not near.has(hex):
			return str(hex)
	return ""


static func _attack_offers(menu: Array) -> Array:
	var offers: Array = []
	for entry: Dictionary in menu:
		for act: Dictionary in entry.get("actions", []):
			if str(act.get("type", "")) == "declare-combat":
				offers.append(act)
	return offers


static func _submit(state: Dictionary, bundle: Dictionary, action: Dictionary) -> Dictionary:
	var record := {"state": state.duplicate(true), "revision": 0, "receipts": []}
	return ScorpionMatch.submit(record, "axis",
		{"id": "engage:" + str(action.get("type", "")), "expectedRevision": 0, "action": action}, bundle)


static func _read_json(relative: String) -> Dictionary:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var read: Dictionary = JsonFile.read((base + "/" + relative).simplify_path())
	if read.get("ok", false):
		return read.value.document
	return {}
