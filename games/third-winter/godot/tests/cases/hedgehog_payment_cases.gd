extends RefCounted

## OCS 13.2c — 构筑工事的 8T 可由多个补给堆拼；侧栏只列真实可付的组合，规则层仍复核总额。

const JsonFile := preload("res://scripts/data/json_file.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")

const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	expect.call(_many_source_rows(), "两个 4T 堆能拼出构筑工事条目")


static func _many_source_rows() -> bool:
	var bundle: Dictionary = _read_json(BUNDLE_REL)
	if bundle.is_empty():
		return false
	var state := {
		"kind": "playing",
		"turn": {"number": 1, "weather": {"ground": "freeze", "flight": "clear"},
			"step": {"kind": "player-turn"}},
		"cursor": {"turn": 1, "phasing": "soviet", "phase": "movement"},
		"units": {"eng": {"side": "soviet", "combat": true, "mobility": "leg", "hex": "s1.14",
			"moveMode": false, "allowance": 3}},
		"dumps": {
			"soviet:hex:s1.14": {"side": "soviet", "location": "on-map", "tokens": 4},
			"soviet:hex:s1.15": {"side": "soviet", "location": "on-map", "tokens": 4},
			"soviet:hex:s1.16": {"side": "soviet", "location": "on-map", "tokens": 9},
		},
		"moved": [],
		"hedgehogs": {},
	}
	var menu: Array = ScorpionView.menu_entries(state, "soviet",
		{"unitIds": ["eng"], "hex": "s1.14"}, bundle)
	var rows: Array = []
	for row: Dictionary in menu:
		for action: Dictionary in row.get("actions", []):
			if str(action.get("type", "")) == "work-hedgehog" and str(action.get("operation", "")) == "build":
				rows.append(action)
	if rows.is_empty():
		return false
	var multi := 0
	for action: Dictionary in rows:
		var payments: Array = action.get("payments", [])
		var total := 0
		for payment: Dictionary in payments:
			total += int(payment.get("tokens", 0))
		if total != 8:
			return false
		if payments.size() > 1:
			multi += 1
	return multi >= 2


static func _read_json(relative: String) -> Dictionary:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var read: Dictionary = JsonFile.read((base + "/" + relative).simplify_path())
	if read.get("ok", false):
		return read.value.document
	return {}
