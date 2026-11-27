extends SceneTree

const Rng := preload("res://scripts/core/rng.gd")
const CommandLog := preload("res://scripts/core/command_log.gd")
const Result := preload("res://scripts/core/result.gd")
const JsonFile := preload("res://scripts/data/json_file.gd")
const PoolDraw := preload("res://scripts/rules/series/pool_draw.gd")
const ScorpionData := preload("res://scripts/data/scorpion_opening_data.gd")
const ScorpionOpening := preload("res://works/third-winter/scenarios/08-korsun-pocket/opening.gd")
const ScorpionMatch := preload("res://works/third-winter/scenarios/08-korsun-pocket/scorpion_match.gd")
const LocalSession := preload("res://scripts/session/local_session.gd")
const SupplyPosition := preload("res://works/third-winter/rules/supply_position.gd")

var _checks := 0
var _failures := 0


func _initialize() -> void:
	var rng_vectors: Variant = _read_vectors("rng.json")
	var commands: Variant = _read_vectors("command_log.json")
	if rng_vectors is Array and commands is Dictionary:
		_test_rng(rng_vectors)
		_test_commands(commands)
		_test_pool()
	else:
		_expect(false, "读取 Godot 对照向量")
	var args := OS.get_cmdline_user_args()
	if args.size() == 2:
		_test_scorpion_opening(args[0], args[1])
	elif args.size() == 3:
		_test_scorpion_opening(args[0], args[1], args[2])
	elif not args.is_empty():
		_expect(false, "实库检查需要同时传入 08 初设数据和对照向量路径")
	print("Godot 迁移基础检查 %d/%d 通过" % [_checks - _failures, _checks])
	quit(1 if _failures else 0)


func _test_rng(vectors: Array) -> void:
	for vector: Dictionary in vectors:
		var seed: float = vector.seed
		var label := "种子 %s" % seed
		var initial := Rng.create_rng_state(seed)
		_compare(initial, vector.initial, label + " 初始状态")
		var current := initial
		for index in vector.uint32.size():
			var draw := Rng.next_uint32(current)
			if not draw.ok:
				_expect(false, label + " 抽取失败")
				break
			_compare(draw.value.value, vector.uint32[index], "%s 第 %d 抽" % [label, index + 1])
			current = draw.value.rng
		_compare(current, vector.after, label + " 连续抽取后状态")
		_compare(Rng.next_float(initial), Result.success(vector.fraction), label + " 浮点抽取")
		var first := Rng.roll_1d6(initial)
		_compare(first, Result.success(vector.first), label + " 1d6")
		if first.ok:
			_compare(Rng.roll_2d6(first.value.rng), Result.success(vector.second), label + " 后续 2d6")
		for pick: Dictionary in vector.picks:
			_compare(Rng.pick_index(initial, pick.size), Result.success(pick.draw), label + " 池抽取")
		for jump: Dictionary in vector.jumps:
			var replay := Rng.replay_from(seed, jump.drawCount)
			_compare(replay, Result.success(jump), label + " 骰序重放")
			if replay.ok:
				_expect(Rng.verify_rng_state(replay.value), label + " 验证已重放状态")
			if jump.drawCount == Rng.MAX_DRAW_COUNT and replay.ok:
				_expect(Rng.next_uint32(replay.value).get("errorCode") == "rng_draw_count", label + " 拒绝抽取溢出")
				_expect(Rng.advance(replay.value, 1).get("errorCode") == "rng_advance_count", label + " 拒绝步进溢出")
		_compare(initial, vector.initial, label + " 查询不改写源状态")
	var invalid := Rng.create_rng_state(7)
	invalid.state = Rng.UINT32_RANGE
	_expect(not Rng.verify_rng_state(invalid), "拒绝越界内部状态")
	_expect(Rng.pick_index(invalid, 0).get("errorCode") == "rng_pick_size", "拒绝空候选池")
	_expect(Rng.roll_dice(invalid, 0).get("errorCode") == "rng_dice_count", "拒绝零枚骰")
	_compare(Rng.create_rng_state(INF), Rng.create_rng_state(0), "非有限种子归零")


func _test_commands(vectors: Dictionary) -> void:
	var record := CommandLog.create_record(vectors.initial.state)
	_compare(record, vectors.initial, "初始命令记录")
	for step: Dictionary in vectors.steps:
		var before := record.duplicate(true)
		var actual := CommandLog.accept_command(record, step.side, step.command, _apply_test_move)
		if actual.ok:
			_compare(actual, step.expected, step.label)
		else:
			_compare({"ok": false, "errorCode": actual.errorCode}, step.expected, step.label)
		_compare(record, before, "%s 保留源记录" % step.label)
		if actual.ok:
			record = actual.value.record
		_compare(record, step.record, "%s 的提交后记录" % step.label)


func _apply_test_move(state: Dictionary, seat: String, action: Dictionary) -> Dictionary:
	if state.actor != seat:
		return Result.failure("wrong_actor", "请由当前行动席位提交")
	state.rng = Rng.next_uint32(state.rng).value.rng
	state.pieces.test.hex = action.hex
	if action.hex not in ["A1.02", "A1.03"]:
		return Result.failure("illegal_target", "目标格无效")
	state.actor = "soviet" if seat == "axis" else "axis"
	return Result.success(state)


func _read_vectors(file: String) -> Variant:
	var read := JsonFile.read("res://tests/vectors/" + file)
	return read.value.document if read.ok else null


func _test_pool() -> void:
	var state := Rng.create_rng_state(42)
	var pool := ["one"]
	_compare(PoolDraw.draw_without_replacement(state, pool, 1), Result.success({
		"rng": state, "draws": [{"item": "one", "before": 0, "after": 0}], "remaining": [],
	}), "单元素库存无放回抽取，保持骰序")
	_compare(pool, ["one"], "抽取保留源库存")
	_expect(PoolDraw.draw_without_replacement(state, pool, 2).get("errorCode") == "invalid_pool_count", "拒绝超出库存")


func _test_scorpion_opening(bundle_path: String, vector_path: String, supply_path: String = "") -> void:
	var bundle := ScorpionData.read(bundle_path)
	var vector := JsonFile.read(vector_path)
	_expect(bundle.ok, bundle.get("errorMessage", "08 初设数据有效"))
	_expect(vector.ok, vector.get("errorMessage", "08 实库向量有效"))
	if not bundle.ok or not vector.ok:
		return
	var baseline: Dictionary = vector.value.document
	_expect(bundle.value.fingerprint == baseline.fingerprint, "08 初设数据与向量指纹一致")
	var opening := ScorpionOpening.create_record(bundle.value.opening, baseline.seed)
	_compare(opening, Result.success(baseline.records["0"]), "08 原生开局记录与 TS 实库完全一致")
	var bad_facts: Dictionary = bundle.value.opening.duplicate(true)
	bad_facts.pool.append(bad_facts.pool[0])
	_expect(ScorpionOpening.create_record(bad_facts, baseline.seed).get("errorCode") == "invalid_alert_pool", "08 开局拒绝重复 Alert 库存")
	if opening.ok:
		_test_scorpion_deployment(opening.value, bundle.value, baseline.records)
		_test_scorpion_views(bundle.value, baseline, supply_path)
		_test_native_bridge(bundle_path, baseline)


func _test_scorpion_deployment(record: Dictionary, data: Dictionary, records: Dictionary) -> void:
	_expect(data.has("deployment"), "08 实库包含部署资料")
	if not data.has("deployment"):
		return
	var confirm := {"type": "confirm-setup"}
	_reject_scorpion(record, data, "soviet", confirm, "wrong_actor")
	_reject_scorpion(record, data, "axis", confirm, "deployment_incomplete")
	var alert: Dictionary = record.state.opening.drawnAlerts[0]
	_reject_scorpion(record, data, "axis", {"type": "place-setup-alert", "id": alert.id, "hex": "s22.17"}, "invalid_alert_hex")
	var crowded := record.duplicate(true)
	var crowded_hex: String = ""
	for id: String in crowded.state.opening.units:
		var unit: Dictionary = crowded.state.opening.units[id]
		if id.begins_with("setup:") and unit.side == "axis":
			unit.printedRe = 10 + unit.stepsLost
			crowded_hex = unit.hex
			break
	_expect(not crowded_hex.is_empty(), "08 对照盘面有初设轴心地面单位")
	_reject_scorpion(crowded, data, "axis", {"type": "place-setup-alert", "id": alert.id, "hex": crowded_hex}, "alert_overstack")
	var first_action: Dictionary = records["1"].receipts[0].action.duplicate(true)
	first_action.base.hex = first_action.base.hex.to_upper()
	var alias := ScorpionMatch.submit(record, "axis", {"id": "alias", "expectedRevision": 0, "action": first_action}, data)
	_expect(alias.ok, "08 接收大写印刷格号")
	if alias.ok:
		_compare(alias.value.record.state, records["1"].state, "格号归一仍部署到同一机场")
	var checked_capacity := false
	var checked_loss_switch := false
	var reached_first_turn := false
	for index in range(1, records.size()):
		var expected: Dictionary = records[str(index)]
		var receipt: Dictionary = expected.receipts[index - 1]
		var command := {"id": receipt.id, "expectedRevision": index - 1, "action": receipt.action}
		if not checked_capacity and receipt.side == "axis" and receipt.action.type == "base-aircraft" \
				and receipt.action.base.kind == "off-map-air":
			for base: Dictionary in data.deployment.airBases:
				_reject_scorpion(record, data, receipt.side, {"type": "base-aircraft", "id": receipt.action.id,
					"base": {"kind": "hex", "hex": base.hex}}, "airbase_overstack" if base.side == "axis" else "invalid_airbase")
			checked_capacity = true
		var outcome := ScorpionMatch.submit(record, receipt.side, command, data)
		_expect(outcome.ok, "08 部署命令 %d · %s" % [index, outcome.get("errorMessage", receipt.action.type)])
		if not outcome.ok:
			break
		record = outcome.value.record
		_compare(record, expected, "08 部署修订 %d 的盘面、骰序与回执" % index)
		if receipt.action.type == "confirm-setup":
			_compare(ScorpionMatch.submit(record, receipt.side, command, data), Result.success({
				"record": expected, "acknowledgedRevision": index, "duplicate": true,
			}), "08 部署确认在修订 %d 重试只返回回执" % index)
		if not checked_loss_switch and receipt.action.type == "choose-setup-loss":
			checked_loss_switch = _test_loss_switch(record, data, receipt.action.id)
		if record.state.kind == "playing":
			reached_first_turn = true
			break
	_expect(reached_first_turn, "08 双方确认后进入首回合飞机整备")
	_expect(checked_capacity and checked_loss_switch, "08 覆盖机场容量和重新选择减员")
	if reached_first_turn:
		_reject_scorpion(record, data, "soviet", confirm, "deployment_closed")
		var stale := {"id": "stale", "expectedRevision": 0, "action": confirm}
		_expect(ScorpionMatch.submit(record, "soviet", stale, data).get("errorCode") == "stale_revision",
			"08 拒绝迟到的部署命令")


func _test_loss_switch(record: Dictionary, data: Dictionary, selected: String) -> bool:
	for choice: Dictionary in record.state.opening.lossChoices:
		if choice.get("selected") != selected:
			continue
		var alternative: String = choice.candidates[1] if choice.candidates[0] == selected else choice.candidates[0]
		var action := {"type": "choose-setup-loss", "id": alternative}
		var result := ScorpionMatch.submit(record, "soviet", {"id": "other-loss", "expectedRevision": record.revision, "action": action}, data)
		_expect(result.ok, "08 同一减员配对允许改变选择")
		if result.ok:
			var units: Dictionary = result.value.record.state.opening.units
			_expect(units[selected].stepsLost == 0 and units[alternative].stepsLost == choice.stepsLost,
				"08 改选后减员只记在新选的单位")
		return true
	return false


func _reject_scorpion(record: Dictionary, data: Dictionary, seat: String, action: Dictionary, code: String) -> void:
	var before := record.duplicate(true)
	var rejected := ScorpionMatch.submit(record, seat, {"id": "reject", "expectedRevision": record.revision, "action": action}, data)
	_expect(not rejected.ok and rejected.get("errorCode") == code, "08 部署拒绝 %s" % code)
	_compare(record, before, "08 拒绝保持盘面、骰序和回执 · %s" % code)


## Drives the native session with the TypeScript interaction requests and diffs the projected view.
## Covers the map and sidebar projection (stacks, roster, legal actions, selection, transport and
## breakdown stock) plus the frame slices that the native view mirrors.
const VIEW_FIELDS := ["revision", "actor", "headline", "phase", "phaseId", "unitId", "unitIds", "hex",
	"route", "roster", "stack", "ended", "transportStock", "breakdownStock"]


func _test_scorpion_views(bundle: Dictionary, vector: Dictionary, supply_path: String = "") -> void:
	var opened := LocalSession.open(bundle, float(vector.seed))
	_expect(opened.ok, "08 原生会话开局")
	if not opened.ok:
		return
	var session: RefCounted = opened.value
	_compare_view(session.view(), vector.bootstrap, "08 开局视图")
	var compared := 0
	for step: Dictionary in vector.steps:
		if session.state().kind != "setup":
			break
		var outcome: Dictionary = session.dispatch(step.request.duplicate(true))
		_expect(outcome.ok, "08 视图命令 %s 被接受 · %s" % [step.request.kind, outcome.get("errorMessage", "")])
		if not outcome.ok:
			break
		compared += 1
		if session.state().kind == "setup":
			_compare_view(session.view(), step.view, "08 修订 %d 视图" % int(step.view.revision))
		else:
			_expect(int(step.view.revision) == session.revision(), "08 原生开局在修订 %d 结束" % session.revision())
	_expect(compared > 30, "08 原生会话走完整个开局命令序列")
	if supply_path != "":
		_test_supply_position(session.state(), bundle, supply_path)
	# The next oracle command closes the Aircraft Refit Phase and opens the reinforcement window.
	# The playing projection is not migrated yet, so this compares the record state only.
	var refit_step: Dictionary = {}
	for step: Dictionary in vector.steps:
		if not step.has("view") or str(step.view.get("phaseId", "")) != "reinforcement":
			continue
		refit_step = step
		break
	if refit_step.is_empty():
		return
	var refit: Dictionary = session.dispatch({"kind": "command", "revision": session.revision(),
		"action": {"type": "complete-refit"}})
	_expect(refit.ok, "08 原生结算 complete-refit · %s" % refit.get("errorMessage", ""))
	if not refit.ok:
		return
	_expect(session.revision() == int(refit_step.view.revision), "08 原生 complete-refit 修订 %d" % int(refit_step.view.revision))
	var expected: Dictionary = vector.records.get(str(int(refit_step.view.revision)), {}).get("state", {})
	_compare_state(session.state(), expected, "08 原生增援窗口状态")


## The native supply position must reproduce every set the TypeScript trace consumes before the
## trace itself can be ported. The fixture is derived from the same opening state.
func _test_supply_position(state: Dictionary, bundle: Dictionary, path: String) -> void:
	var read := JsonFile.read(path)
	_expect(read.ok, read.get("errorMessage", "08 补给态势对照有效"))
	if not read.ok:
		return
	var fixture: Dictionary = read.value.document
	_expect(str(bundle.fingerprint) == str(fixture.fingerprint), "08 补给态势对照与初设指纹一致")
	var units: Dictionary = state.get("units", {})
	var rail_control: Dictionary = state.get("railControl", {})
	for side: String in ["axis", "soviet"]:
		_compare(SupplyPosition.enemy_zoc(units, side, bundle), fixture.zoc[side], "08 %s 敌方 ZOC" % side)
		var actual: Dictionary = SupplyPosition.position(units, rail_control, side, bundle)
		var difference := _first_difference(actual, fixture.position[side], "")
		_expect(difference.is_empty(), "08 %s 补给态势" % side + ("" if difference.is_empty() else " · " + difference))


func _state_slice(state: Dictionary) -> Dictionary:
	return {"kind": state.get("kind"), "turn": state.get("turn"), "cursor": state.get("cursor"),
		"window": state.get("window"), "moved": state.get("moved"), "victory": state.get("victory")}


func _compare_state(actual: Dictionary, expected: Dictionary, label: String) -> void:
	if expected.is_empty():
		_expect(false, label + " · oracle 缺少该修订的状态")
		return
	var difference := _first_difference(_state_slice(actual), _state_slice(expected), "")
	_expect(difference.is_empty(), label + ("" if difference.is_empty() else " · " + difference))


## The scene bridge must produce the same bootstrap the TypeScript bridge does, with the map and
## box artwork resolved to absolute paths, and return a view for every accepted map request.
func _test_native_bridge(data_path: String, vector: Dictionary) -> void:
	var bridge: Node = load("res://scripts/session/native_bridge.gd").new()
	bridge.config = {"seed": float(vector.seed)}
	var bootstrap := {"model": {}, "view": {}}
	var views: Array = []
	var failure := {"message": ""}
	bridge.bootstrap_ready.connect(func(next_model: Dictionary, next_view: Dictionary) -> void:
		bootstrap.model = next_model
		bootstrap.view = next_view)
	bridge.view_ready.connect(func(next_view: Dictionary) -> void: views.append(next_view))
	bridge.bridge_failed.connect(func(message: String) -> void: failure.message = message)
	bridge._boot(data_path)
	_expect(not bootstrap.view.is_empty(), "原生桥发出 bootstrap")
	if bootstrap.view.is_empty():
		return
	_compare_view(bootstrap.view, vector.bootstrap, "原生桥开局视图")
	var model: Dictionary = bootstrap.model
	_expect(FileAccess.file_exists(str(model.get("map", ""))), "原生桥地图路径可读")
	_expect(int(model.get("width", 0)) > 0 and model.get("boxes", []).size() > 0, "原生桥盒区可读")
	bridge.request({"kind": "select-unit", "unitId": str(vector.steps[0].request.unitId)})
	bridge._pump()
	_expect(views.size() == 1, "原生桥 select-unit 返回视图")
	if views.size() == 1:
		_compare_view(views[0], vector.steps[0].view, "原生桥 select-unit 视图")
	var placement: Dictionary = vector.steps[1].request
	bridge.request({"kind": "board-left", "x": placement.x, "y": placement.y,
		"unitId": placement.get("unitId", ""), "revision": int(placement.revision)})
	bridge._pump()
	_expect(views.size() == 2, "原生桥 board-left 返回视图")
	if views.size() == 2:
		_compare_view(views[1], vector.steps[1].view, "原生桥 board-left 视图")
	bridge.request({"kind": "apply", "key": "action:0:0", "revision": 0})
	bridge._pump()
	_expect(failure.message.contains("局面已更新") and views.size() == 2, "原生桥拒绝迟到修订")
	bridge.free()


func _compare_view(actual: Dictionary, expected: Dictionary, label: String) -> void:
	var difference := _first_difference(_view_slice(actual), _view_slice(expected), "")
	_expect(difference.is_empty(), label + ("" if difference.is_empty() else " · " + difference))


func _view_slice(view: Dictionary) -> Dictionary:
	var slice: Dictionary = {}
	for field: String in VIEW_FIELDS:
		slice[field] = view.get(field)
	var actions: Array = []
	for control: Dictionary in view.get("actions", []):
		actions.append({"label": control.get("label"), "actionTypes": control.get("actionTypes")})
	slice.actions = actions
	var frame: Dictionary = view.get("frame", {})
	slice.frame = {
		"trackers": frame.get("trackers", []), "inventories": frame.get("inventories", []),
		"aidCounters": frame.get("aidCounters", []), "auxiliaryCards": frame.get("auxiliaryCards", {}),
		"mapStacks": frame.get("mapStacks", []), "selectedUnits": frame.get("selectedUnits", []),
		"targets": frame.get("targets", []), "route": frame.get("route", []),
		"selectedHex": frame.get("selectedHex"),
	}
	return slice


func _first_difference(actual: Variant, expected: Variant, path: String) -> String:
	if actual is Array and expected is Array:
		if actual.size() != expected.size():
			return "%s 长度 %d ≠ %d" % [path, actual.size(), expected.size()]
		for index in actual.size():
			var difference := _first_difference(actual[index], expected[index], "%s[%d]" % [path, index])
			if not difference.is_empty():
				return difference
		return ""
	if actual is Dictionary and expected is Dictionary:
		var keys: Dictionary = {}
		for key: Variant in actual:
			keys[key] = true
		for key: Variant in expected:
			keys[key] = true
		for key: Variant in keys:
			var difference := _first_difference(actual.get(key), expected.get(key), "%s.%s" % [path, key])
			if not difference.is_empty():
				return difference
		return ""
	if (actual is int or actual is float) and (expected is int or expected is float):
		return "" if absf(float(actual) - float(expected)) <= 0.000001 else \
			"%s %s ≠ %s" % [path, str(actual), str(expected)]
	if actual == expected:
		return ""
	return "%s %s ≠ %s" % [path, JSON.stringify(actual), JSON.stringify(expected)]


func _compare(actual: Variant, expected: Variant, label: String) -> void:
	_expect(JSON.stringify(actual, "", true, true) == JSON.stringify(expected, "", true, true), label)


func _expect(passed: bool, label: String) -> void:
	_checks += 1
	if not passed:
		_failures += 1
		printerr("失败 · ", label)
