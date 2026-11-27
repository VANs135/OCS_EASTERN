extends RefCounted

## Native 08 session for the printed opening. Mirrors desktop/local/controller.mjs for the setup
## phase: seat-gated submission, selection, the protocol-v1 requests the map sends, and projection.
## Later phases keep the TypeScript engine as the oracle until their mechanisms are migrated.

const SESSION_PATH := "res://scripts/session/local_session.gd"
const HexLayout := preload("res://scripts/view/hex_layout.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")
const ScorpionMatch := preload("res://works/third-winter/scenarios/08-korsun-pocket/scorpion_match.gd")
const ScorpionOpening := preload("res://works/third-winter/scenarios/08-korsun-pocket/opening.gd")
const Result := preload("res://scripts/core/result.gd")

const POINT_ACTIONS := ["base-aircraft", "place-setup-alert", "place-arrival", "place-supply", "place-alert"]

var _data: Dictionary
var _record: Dictionary
var _selection: Dictionary = {}
var _shown: Dictionary = {}
var _menu: Array = []
var _hex_ids: Dictionary = {}
var _command_count: int = 0


static func open(data: Dictionary, seed: float) -> Dictionary:
	var opening := ScorpionOpening.create_record(data.opening, seed)
	if not opening.ok:
		return opening
	var session: RefCounted = load(SESSION_PATH).new(data)
	session._record = opening.value
	session._shown = session.project("axis")
	return Result.success(session)


func _init(data: Dictionary) -> void:
	_data = data
	for hex: String in data.get("hexIds", []):
		_hex_ids[hex] = true


func revision() -> int:
	return _record.revision


func state() -> Dictionary:
	return _record.state


## The command log itself, for tests that replay oracle receipts into the same match.
func record() -> Dictionary:
	return _record


func view() -> Dictionary:
	return _shown


## Protocol-v1 request handling. Unknown or out-of-window requests fail without touching the board.
func dispatch(request: Dictionary) -> Dictionary:
	var kind: String = str(request.get("kind", ""))
	if kind == "ready":
		kind = "view"
	if kind == "view":
		return Result.success(_shown)
	# The map omits the revision on counter picks; a supplied revision must still be current.
	if request.has("revision") and int(request.revision) != _record.revision:
		return Result.failure("stale_revision", "局面已更新，请重新选择")
	match kind:
		"select-unit":
			var picked := _pick_unit(str(request.get("unitId", "")))
			if not picked.ok:
				return picked
		"board-left":
			return _board_left(request)
		"board-menu":
			_menu = []
			_shown.menu = []
			return Result.success(_shown)
		"apply":
			var chosen: Dictionary = {}
			for control: Dictionary in _shown.get("actions", []) + _menu:
				if control.key == request.get("key"):
					chosen = control
					break
			if chosen.is_empty():
				return Result.failure("unavailable_action", "这项操作已不可用")
			return _run(_actions_of(chosen))
		"command":
			var action: Variant = request.get("action")
			if not action is Dictionary or not action.get("type") is String:
				return Result.failure("invalid_command_action", "无法识别此操作")
			return _run([action])
		_:
			return Result.failure("invalid_request", "无法识别此操作")
	_shown = _render()
	return Result.success(_shown)


func project(viewer: String) -> Dictionary:
	if _record.state.kind != "setup":
		return {}
	return ScorpionView.project(_record, _selection, _data, viewer)


func _render() -> Dictionary:
	# The desktop projection hides the opponent's off-map air box, so the viewer is the acting side.
	return project(_actor())


func _actor() -> String:
	return ScorpionView.decision_side(_record.state)


func _pick_unit(unit_id: String) -> Dictionary:
	var entries: Array = _shown.get("roster", [])
	var unit: Dictionary = {}
	for entry: Dictionary in entries:
		if entry.id == unit_id:
			unit = entry
			break
	if unit.is_empty():
		return Result.failure("invalid_unit", "请选择当前一方的算子")
	var unit_ids: Array = _shown.get("unitIds", []).duplicate()
	if unit_ids.has(unit_id):
		unit_ids.erase(unit_id)
	else:
		# The setup phase has no ground/air grouping: a counter is picked on its own.
		unit_ids = [unit_id]
	var primary: Dictionary = {}
	for entry: Dictionary in entries:
		if unit_ids.size() and entry.id == unit_ids.back():
			primary = entry
			break
	var previous_stack: Variant = _selection.get("stackHex")
	_selection = {"unitIds": unit_ids}
	if not primary.is_empty():
		_selection.unitId = primary.id
		_selection.hex = primary.get("hex")
	if previous_stack != null and previous_stack == unit.get("hex"):
		_selection.stackHex = previous_stack
	return Result.success({})


func _board_left(request: Dictionary) -> Dictionary:
	var hit := _hit_at(request)
	if hit.is_empty():
		return Result.success(_shown)
	var current: Dictionary = {"unitId": _shown.get("unitId"), "unitIds": _shown.get("unitIds", [])}
	if hit.unitId != "" and hit.ownIds.has(hit.unitId):
		var picked := _pick_unit(hit.unitId)
		if not picked.ok:
			return picked
		_shown = _render()
		return Result.success(_shown)
	var subject: Dictionary = {"unitId": current.unitId, "unitIds": current.unitIds, "hex": hit.hex, "route": []}
	var direct: Array = []
	for choice: Dictionary in ScorpionView.choices(_record.state, _actor(), subject, _data):
		if choice.actions.size() != 1:
			continue
		var action: Dictionary = choice.actions[0]
		if not POINT_ACTIONS.has(action.type) or not _action_target(action, hit):
			continue
		if action.type == "base-aircraft" and hit.ownIds.has(subject.unitId):
			continue
		if _available(choice.actions):
			direct.append(choice)
	if not bool(request.get("confirm", false)) and direct.size() == 1:
		return _run(direct[0].actions)
	if hit.hex != "":
		_selection = {"unitId": current.unitId, "unitIds": current.unitIds, "hex": hit.hex, "route": []}
		if hit.ownIds.size() > 0:
			_selection.stackHex = hit.hex
	_shown = _render()
	return Result.success(_shown)


func _action_target(action: Dictionary, hit: Dictionary) -> bool:
	var base: Dictionary = action.get("base", {})
	if base.get("kind") == "off-map-air":
		return bool(hit.get("box", false))
	if hit.hex == "":
		return false
	return action.get("hex") == hit.hex or base.get("hex") == hit.hex \
		or action.get("target", {}).get("id") == hit.hex or action.get("target", {}).get("hex") == hit.hex


## Preview runs on an isolated copy so a rejected probe leaves the board and the RNG untouched.
func _available(actions: Array) -> bool:
	var preview := _record.duplicate(true)
	for action: Dictionary in actions:
		var outcome := ScorpionMatch.submit(preview, _actor(),
			{"id": "preview:%d" % _command_count, "expectedRevision": preview.revision, "action": action}, _data)
		if not outcome.ok:
			return false
		preview = outcome.value.record
	return true


func _run(actions: Array) -> Dictionary:
	var next := _record.duplicate(true)
	for action: Dictionary in actions:
		_command_count += 1
		var outcome := ScorpionMatch.submit(next, _actor(),
			{"id": "native:%d" % _command_count, "expectedRevision": next.revision, "action": action}, _data)
		if not outcome.ok:
			return outcome
		next = outcome.value.record
	_record = next
	# The setup actions do not retain a counter selection, matching the desktop controller.
	_selection = {}
	_menu = []
	_shown = _render()
	return Result.success(_shown)


## The view mints stable keys per revision, so the key index resolves the printed command directly.
func _actions_of(control: Dictionary) -> Array:
	var key: String = str(control.get("key", ""))
	var prefix := "action:%d:" % _record.revision
	if not key.begins_with(prefix):
		return []
	var target := int(key.substr(prefix.length()))
	var legal: Array = ScorpionView.choices(_record.state, _actor(),
		{"unitId": _shown.get("unitId"), "unitIds": _shown.get("unitIds", []), "hex": _selection.get("hex")}, _data)
	var index := 0
	for choice: Dictionary in legal:
		var action: Dictionary = choice.actions[0]
		if _shown.get("unitIds", []).size() >= 2 and action.type == "ground-move":
			continue
		if index == target:
			return choice.actions
		index += 1
	return []


func _selected_id() -> Variant:
	for entry: Dictionary in _shown.get("roster", []):
		if entry.id == _shown.get("unitId"):
			return entry.id
	return null


func _hit_at(request: Dictionary) -> Dictionary:
	var x := float(request.get("x", 0.0))
	var y := float(request.get("y", 0.0))
	var hex := HexLayout.hex_at(x, y)
	if hex.is_empty() or not _hex_ids.has(hex):
		return {}
	var counters: Array = []
	for stack: Dictionary in _shown.get("frame", {}).get("mapStacks", []):
		if stack.get("hex") != hex:
			continue
		for page: Array in stack.get("pages", []):
			counters.append_array(page)
	var unit_id := ""
	for counter: Dictionary in counters:
		if counter.get("id") == request.get("unitId"):
			unit_id = counter.id
			break
	var own_ids: Array = []
	for counter: Dictionary in counters:
		if ScorpionView._roster_has(_shown.get("roster", []), counter.get("id")):
			own_ids.append(counter.get("id"))
	return {"hex": hex, "unitId": unit_id, "ownIds": own_ids}
