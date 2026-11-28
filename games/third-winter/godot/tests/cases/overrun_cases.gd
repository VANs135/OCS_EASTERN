extends RefCounted

## OCS 8.1 / TTW 2.3a — 突袭：宣告扣 3 MP、守方清空自动进格、未清空留余量继续。

const JsonFile := preload("res://scripts/data/json_file.gd")
const Overrun := preload("res://works/third-winter/rules/overrun.gd")
const CombatResult := preload("res://works/third-winter/rules/combat_result.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")

const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"
const ATTACKER := "setup:land:id:4031:1"
const DEFENDER_HEX := "s4.12"


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var bundle: Dictionary = _read_json(BUNDLE_REL)
	if bundle.is_empty():
		expect.call(false, "08 初设数据包可读（突袭）")
		return
	var state := _state(bundle)
	state.units[ATTACKER].fueled = true
	var action := {"target": DEFENDER_HEX, "attackers": [ATTACKER],
		"payments": [{"unitId": ATTACKER, "dumpId": "axis:hex:s3.10", "tokens": 1}]}
	var checked: Dictionary = Overrun.check(state, "axis", action, bundle)
	expect.call(checked.ok, "08 4031 可从 s5.12 突袭 s4.12 · " + str(checked.get("errorCode", "")))
	if not checked.ok:
		return
	var offer: Array = ScorpionView.menu_entries(state, "axis", {"unitId": ATTACKER, "hex": DEFENDER_HEX},
		bundle)
	expect.call(_count_type(offer, "declare-overrun") >= 1, "侧栏在相邻敌格给出突袭行")
	var declared: Dictionary = Overrun.declare(state, "axis", action, bundle)
	expect.call(declared.ok, "突袭宣告可落地 · " + str(declared.get("errorCode", "")))
	if not declared.ok:
		return
	var after: Dictionary = declared.value
	expect.call(after.combat != null and str(after.combat.get("kind")) == "overrun"
		and after.combat.get("step") == "defender-supply", "突袭进入守方补给步骤")
	expect.call(str(after.units[ATTACKER].hex) == "s5.12", "突袭宣告时攻方仍在出发格")
	expect.call(int(after.overrunMarch.remaining[ATTACKER]) == 4, "7 MP 突袭后余 4 MP")
	expect.call(after.moved.has(ATTACKER) and int(after.groundActivity.spent.get(ATTACKER, 0)) == 3,
		"突袭记已动并扣 3 MP")
	expect.call((after.combatTargets as Array).is_empty(), "突袭不占本回合攻击格账本")
	var menu: Array = ScorpionView.menu_entries(after, "axis", {"unitId": ATTACKER}, bundle)
	expect.call(_count_type(menu, "declare-overrun") == 0, "突袭待决时侧栏不再出宣告行")
	_check_cleared_entry(expect, after, bundle)
	_check_survivor_continue(expect, bundle)


static func _check_cleared_entry(expect: Callable, declared: Dictionary, bundle: Dictionary) -> void:
	var state: Dictionary = declared.duplicate(true)
	state.combat.step = "defender-result"
	state.combat.roll = {"attacker": {"loss": 0, "option": 0}, "defender": {"loss": 99, "option": 0},
		"exploit": null}
	var defender := str(state.combat.defenders[0])
	state.combat.defenderLeader = defender
	var resolved: Dictionary = CombatResult.resolve(state, "soviet",
		{"lossOrder": [defender, defender, defender], "optionLosses": 0}, bundle)
	expect.call(resolved.ok, "突袭守方清空可结算 · " + str(resolved.get("errorCode", "")))
	if not resolved.ok:
		return
	var now: Dictionary = resolved.value.state
	expect.call(now.get("combat") == null, "突袭结算后清战斗")
	expect.call(str(now.units[ATTACKER].hex) == DEFENDER_HEX, "守方清空后存活攻方自动进格")
	expect.call(now.overrunMarch != null and now.overrunMarch.enteredHex == true,
		"自动进格后余量账本仍在")
	var continued: Dictionary = Overrun.continue_apply(now, "axis", {"path": ["s4.11"]}, bundle)
	expect.call(continued.ok and continued.value.overrunMarch == null,
		"进格后可用余量继续行军并清账本 · " + str(continued.get("errorCode", "")))


static func _check_survivor_continue(expect: Callable, bundle: Dictionary) -> void:
	var state := _state(bundle)
	state.units[ATTACKER].fueled = true
	var action := {"target": DEFENDER_HEX, "attackers": [ATTACKER],
		"payments": [{"unitId": ATTACKER, "dumpId": "axis:hex:s3.10", "tokens": 1}]}
	var declared: Dictionary = Overrun.declare(state, "axis", action, bundle)
	if not declared.ok:
		expect.call(false, "守方存活场景可宣告突袭 · " + str(declared.get("errorCode", "")))
		return
	var after: Dictionary = declared.value
	after.combat.step = "defender-result"
	after.combat.defenderLeader = str(after.combat.defenders[0])
	after.combat.roll = {"attacker": {"loss": 0, "option": 0}, "defender": {"loss": 0, "option": 0},
		"exploit": null}
	var resolved: Dictionary = CombatResult.resolve(after, "soviet",
		{"lossOrder": [], "optionLosses": 0}, bundle)
	expect.call(resolved.ok, "守方未清空时突袭可收尾 · " + str(resolved.get("errorCode", "")))
	if not resolved.ok:
		return
	var now: Dictionary = resolved.value.state
	expect.call(now.get("combat") == null and now.overrunMarch != null
		and int(now.overrunMarch.remaining[ATTACKER]) == 4,
		"守方未清空则留在原格并保留 4 MP")
	var continued: Dictionary = Overrun.continue_apply(now, "axis", {"path": ["s5.11"]}, bundle)
	expect.call(continued.ok and str(continued.value.units[ATTACKER].hex) == "s5.11"
		and continued.value.overrunMarch == null,
		"突袭余量可继续行军并清账本 · " + str(continued.get("errorCode", "")))


static func _state(bundle: Dictionary) -> Dictionary:
	var opening: Dictionary = bundle.get("opening", {})
	return {
		"kind": "playing",
		"turn": {"number": 1, "step": {"kind": "player-turn"},
			"weather": {"ground": "freeze", "flight": "clear"}},
		"cursor": {"turn": 1, "phasing": "axis", "phase": "movement"},
		"units": (opening.get("units", {}) as Dictionary).duplicate(true),
		"pieces": (opening.get("pieces", []) as Array).duplicate(true),
		"dumps": (opening.get("dumps", {}) as Dictionary).duplicate(true),
		"moved": [], "combatTargets": [], "combatAttackers": [],
		"combat": null, "barrage": null, "capture": null, "victory": null,
		"overrunMarch": null, "groundActivity": {"airlifted": [], "spent": {}},
		"groundCaptureMove": null, "barrageHistory": [],
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
