extends RefCounted

const SetupAircraft := preload("res://works/third-winter/rules/setup_aircraft.gd")
const FirstTurn := preload("res://works/third-winter/scenarios/08-korsun-pocket/first_turn.gd")
const Result := preload("res://scripts/core/result.gd")


## TTW S08 pp.53–56 — 轴心先部署，苏军确认后进入首回合。
## 迁移对照见 src/match/scorpion-setup.ts。
static func apply_action(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	if state.kind != "setup":
		return Result.failure("deployment_closed", "部署已经结束")
	var opening: Dictionary = state.opening
	if opening.seat != actor:
		return Result.failure("wrong_actor", "请由当前部署方提交")
	var deployment: Dictionary = data.deployment
	match action.get("type"):
		"base-aircraft":
			return _base_aircraft(state, actor, action, deployment.airBases)
		"place-setup-alert":
			return _place_alert(state, actor, action, data.hexIds, deployment.alertProfiles)
		"choose-setup-loss":
			return _choose_loss(state, actor, action.get("id"))
		"confirm-setup":
			return _confirm(state, actor, deployment)
	return Result.failure("unsupported_action", "当前部署阶段不可执行此操作")


static func _base_aircraft(state: Dictionary, actor: String, action: Dictionary, bases: Array) -> Dictionary:
	var base: Variant = action.get("base")
	if not base is Dictionary or base.get("kind") not in ["hex", "off-map-air"]:
		return Result.failure("invalid_airbase", "请选择机场或地图外空军盒")
	# TTW S08 p.53 — 双方可将飞机部署到地图外空军盒。
	if base.kind == "hex":
		base.hex = _printed_hex(base.get("hex"))
	var placed := SetupAircraft.place(state.opening.pieces, actor, action.get("id"), base, bases)
	return Result.success(state) if placed.ok else placed


static func _place_alert(state: Dictionary, actor: String, action: Dictionary, hex_ids: Array, profiles: Dictionary) -> Dictionary:
	var hex := _printed_hex(action.get("hex"))
	if actor != "axis" or hex not in hex_ids:
		return Result.failure("invalid_alert_hex", "请选择允许部署 Alert 的格")
	var opening: Dictionary = state.opening
	var id: Variant = action.get("id")
	var profile: Dictionary = {}
	for counter: Dictionary in opening.drawnAlerts:
		if counter.id == id:
			profile = profiles[counter.definition]
			break
	if profile.is_empty():
		return Result.failure("invalid_alert", "请选择已抽出的 Alert 算子")
	var has_printed_unit := false
	var stack_re: float = profile.printedRe
	for unit_id: String in opening.units:
		var unit: Dictionary = opening.units[unit_id]
		if unit_id == id or unit.hex != hex:
			continue
		has_printed_unit = has_printed_unit or (unit_id.begins_with("setup:") and unit.side == "axis")
		stack_re += unit.printedRe - unit.stepsLost
	# TTW S08 pp.54–55 — Alert 与印刷初设中的轴心地面算子同格。
	if not has_printed_unit:
		return Result.failure("invalid_alert_hex", "Alert 须与印刷初设中的轴心地面算子同格")
	# OCS v4.3 §4.8a、初设说明 F — 初设堆叠上限。
	if stack_re > 10:
		return Result.failure("alert_overstack", "部署 Alert 会超过 10 RE")
	var unit := profile.duplicate(true)
	unit.hex = hex
	opening.units[id] = unit
	return Result.success(state)


## TTW S08 p.54 — 苏军按印刷配对选择减员单位。
static func _choose_loss(state: Dictionary, actor: String, id: Variant) -> Dictionary:
	if actor == "soviet" and id is String:
		for choice: Dictionary in state.opening.lossChoices:
			if id not in choice.candidates:
				continue
			for candidate: String in choice.candidates:
				state.opening.units[candidate].stepsLost = choice.stepsLost if candidate == id else 0
			choice.selected = id
			return Result.success(state)
	return Result.failure("invalid_loss_choice", "请选择印刷减员配对中的苏军单位")


static func _confirm(state: Dictionary, actor: String, deployment: Dictionary) -> Dictionary:
	var opening: Dictionary = state.opening
	for piece: Dictionary in opening.pieces:
		if piece.side == actor and piece.location.kind == "air-setup":
			return Result.failure("deployment_incomplete", "请先完成所有必需的部署选择")
	if actor == "axis":
		for alert: Dictionary in opening.drawnAlerts:
			if not opening.units.has(alert.id):
				return Result.failure("deployment_incomplete", "请先完成所有必需的部署选择")
		opening.seat = "soviet"
		return Result.success(state)
	for choice: Dictionary in opening.lossChoices:
		if not choice.get("selected") is String or choice.selected.is_empty():
			return Result.failure("deployment_incomplete", "请先完成所有必需的部署选择")
	return Result.success(FirstTurn.start(opening, deployment))


static func _printed_hex(value: Variant) -> String:
	if not value is String:
		return ""
	var parts: PackedStringArray = value.to_lower().split(".")
	if parts.size() != 2 or not parts[0].begins_with("s"):
		return ""
	var column := parts[0].substr(1)
	var row := parts[1]
	if column.is_empty() or not column.is_valid_int() or not column[0].is_valid_int() \
			or row.is_empty() or row.length() > 2 or not row.is_valid_int() or not row[0].is_valid_int():
		return ""
	return "s%d.%02d" % [int(column), int(row)]
