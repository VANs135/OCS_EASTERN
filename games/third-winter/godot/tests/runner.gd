extends SceneTree

const Rng := preload("res://scripts/core/rng.gd")
const CommandLog := preload("res://scripts/core/command_log.gd")
const Result := preload("res://scripts/core/result.gd")
const JsonFile := preload("res://scripts/data/json_file.gd")
const PoolDraw := preload("res://scripts/rules/series/pool_draw.gd")
const ScorpionData := preload("res://scripts/data/scorpion_opening_data.gd")
const ScorpionOpening := preload("res://works/third-winter/scenarios/08-korsun-pocket/opening.gd")
const ScorpionMatch := preload("res://works/third-winter/scenarios/08-korsun-pocket/scorpion_match.gd")
const SupplyPhase := preload("res://works/third-winter/rules/supply_phase.gd")
const PhaseFlow := preload("res://works/third-winter/rules/phase_flow.gd")
const LocalSession := preload("res://scripts/session/local_session.gd")
const SupplyPosition := preload("res://works/third-winter/rules/supply_position.gd")
const TerrainCost := preload("res://works/third-winter/rules/terrain_cost.gd")
const SupplyTrace := preload("res://works/third-winter/rules/supply_trace.gd")
const ReinforcementBoard := preload("res://works/third-winter/rules/reinforcement_board.gd")
const ScorpionView := preload("res://scripts/view/scorpion_view.gd")

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
	if args.size() >= 2 and args.size() <= 6:
		_test_scorpion_opening(args[0], args[1], "" if args.size() < 3 else args[2],
			"" if args.size() < 4 else args[3], "" if args.size() < 5 else args[4],
			"" if args.size() < 6 else args[5])
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


func _test_scorpion_opening(bundle_path: String, vector_path: String, supply_path: String = "", terrain_path: String = "", trace_path: String = "", arrival_path: String = "") -> void:
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
		_test_scorpion_views(bundle.value, baseline, supply_path, terrain_path, trace_path, arrival_path)
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


func _test_scorpion_views(bundle: Dictionary, vector: Dictionary, supply_path: String = "", terrain_path: String = "", trace_path: String = "", arrival_path: String = "") -> void:
	var opened := LocalSession.open(bundle, float(vector.seed))
	_expect(opened.ok, "08 原生会话开局")
	if not opened.ok:
		return
	var session: RefCounted = opened.value
	_compare_view(session.view(), vector.bootstrap, "08 开局视图")
	_test_transport_buckets(bundle)
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
	if terrain_path != "":
		_test_terrain_cost(bundle, terrain_path)
	if trace_path != "":
		_test_supply_trace(session.state(), bundle, trace_path)
	if arrival_path != "":
		_test_reinforcement_board(session.state(), bundle, arrival_path)
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
	_test_reinforcement_commands(session.record(), vector, bundle, int(refit_step.view.revision))


## The oracle's view for the revision this record reached, compared field by field.
func _compare_view_at(record: Dictionary, vector: Dictionary, data: Dictionary, label: String) -> void:
	var view := ScorpionView.project(record, {}, data, ScorpionView.decision_side(record.state))
	var oracle := {}
	for step: Dictionary in vector.steps:
		if step.view.revision == record.revision:
			oracle = step.view
			break
	if not view.is_empty() and not oracle.is_empty():
		_compare_view(view, oracle, label)


## Replays the oracle's reinforcement receipts through the native match and compares the whole
## reinforcement ledger: arrivals on the map, deployed counters, deliveries, pax and the dice.
func _test_reinforcement_commands(record: Dictionary, vector: Dictionary, data: Dictionary, from: int) -> void:
	_reject_reinforcements(record, data)
	var variable: Dictionary = {}
	_compare_view_at(record, vector, data, "08 原生增援窗口视图")
	var steps := 0
	var index := from + 1
	while true:
		var expected: Dictionary = vector.records.get(str(index), {})
		if expected.is_empty():
			break
		var receipts: Array = expected.get("receipts", [])
		if receipts.size() != index:
			break
		var receipt: Dictionary = receipts[index - 1]
		var action: Dictionary = receipt.action
		if not str(action.get("type")) in ["place-arrival", "place-supply", "finish-scheduled-arrivals",
				"complete-reinforcement", "place-alert", "pass-alert"]:
			break
		var wrote := ScorpionMatch.submit(record.duplicate(true), str(receipt.side), {"id": "rein-%d" % index,
			"expectedRevision": record.revision, "action": action}, data)
		_expect(wrote.ok, "08 原生增援命令 %d · %s %s" % [index, str(action.get("type")),
			wrote.get("errorMessage", "")])
		if not wrote.ok:
			return
		record = wrote.value.record
		if str(record.state.cursor.phase) == "reinforcement" and str(record.state.get("window", {}).get("stage")) == "variable":
			variable = record
		_compare_reinforcement(record.state, expected.state, "08 原生增援修订 %d" % index)
		_compare_view_at(record, vector, data, "08 原生增援修订 %d 视图" % index)
		steps += 1
		if str(action.get("type")) == "complete-reinforcement":
			break
		index += 1
	_expect(steps >= 5, "08 原生增援走完抵达、交付与收尾 (%d 步)" % steps)
	_test_alert_placement(variable, data)
	_test_movement_commands(record, vector, data)


## The oracle's first Movement Phase move: one leg counter walks one hex. The whole route is checked
## before the board changes, so a rejection leaves `moved` and the spent books untouched.
func _test_movement_commands(record: Dictionary, vector: Dictionary, data: Dictionary) -> void:
	var index: int = int(record.revision) + 1
	var expected: Dictionary = vector.records.get(str(index), {})
	if expected.is_empty():
		_expect(false, "08 移动阶段缺少 oracle 修订 %d" % index)
		return
	var action: Dictionary = expected.receipts[index - 1].action
	var wrote := ScorpionMatch.submit(record.duplicate(true), "soviet",
		{"id": "move-%d" % index, "expectedRevision": record.revision, "action": action}, data)
	_expect(wrote.ok, "08 原生移动命令 %s %s" % [str(action.get("type")), wrote.get("errorMessage", "")])
	if not wrote.ok:
		return
	record = wrote.value.record
	_compare_movement(record.state, expected.state, "08 原生移动修订 %d" % index)
	_compare_view_at(record, vector, data, "08 原生移动视图修订 %d" % index)
	var unit_id := str(action.get("unitId"))
	_reject_scorpion(record, data, "axis", {"type": "ground-move", "unitId": unit_id,
		"path": [str(record.state.units[unit_id].hex)]}, "wrong_actor")
	_reject_scorpion(record, data, "soviet", {"type": "ground-move", "unitId": "setup:land:id:9999:1",
		"path": ["s1.12"]}, "movement_unit")
	# The counter that already moved is refused before the route is even read.
	_reject_scorpion(record, data, "soviet", {"type": "ground-move", "unitId": unit_id,
		"path": [str(record.state.units[unit_id].hex)]}, "movement_spent")
	var fresh := ""
	for id: String in record.state.units:
		var unit: Dictionary = record.state.units[id]
		if unit.side == "soviet" and unit.get("combat") == true and unit.get("hex") != null \
				and str(unit.get("mobility")) == "leg" and not record.state.moved.has(id):
			fresh = id
			break
	_reject_scorpion(record, data, "soviet", {"type": "ground-move", "unitId": fresh, "path": []},
		"movement_path")
	# An enemy combat counter blocks entry outright.
	var enemy_hex := ""
	for id: String in record.state.units:
		var unit: Dictionary = record.state.units[id]
		if unit.side != "soviet" and unit.get("combat") == true and unit.get("hex") != null:
			enemy_hex = str(unit.hex)
			break
	_reject_scorpion(record, data, "soviet", {"type": "ground-move", "unitId": fresh,
		"path": [enemy_hex]}, "movement_blocked")
	# The oracle closes the segment here and the supply window must match the TS trace book.
	var next_index := index + 1
	var closed: Dictionary = vector.records.get(str(next_index), {})
	if closed.is_empty():
		_expect(false, "08 补给阶段缺少 oracle 修订 %d" % next_index)
		return
	var close_action: Dictionary = closed.receipts[next_index - 1].action
	var opened := ScorpionMatch.submit(record.duplicate(true), "soviet",
		{"id": "close-%d" % next_index, "expectedRevision": record.revision, "action": close_action}, data)
	_expect(opened.ok, "08 原生结束移动 %s" % opened.get("errorMessage", ""))
	if not opened.ok:
		return
	_compare_supply(opened.value.record.state, closed.state, "08 原生补给窗口修订 %d" % next_index)
	_compare_view_at(opened.value.record, vector, data, "08 原生补给视图修订 %d" % next_index)
	_test_supply_split(opened.value.record, data)
	_test_supply_attrition(opened.value.record, data)
	# The window opens before the trace and attrition steps, so their order is refused.
	_reject_scorpion(opened.value.record, data, "soviet", {"type": "complete-supply"},
		"supply_pending")
	_reject_scorpion(opened.value.record, data, "axis", {"type": "complete-supply"},
		"supply_unavailable")
	_reject_scorpion(opened.value.record, data, "soviet", {"type": "complete-reaction"},
		"phase_command")
	# Then the oracle checks attrition and closes the phase, one revision each.
	var after_supply: Dictionary = opened.value.record
	for offset in [2, 3, 4]:
		var at: int = index + offset
		var later: Dictionary = vector.records.get(str(at), {})
		if later.is_empty():
			_expect(false, "08 后勤阶段缺少 oracle 修订 %d" % at)
			return
		var step_action: Dictionary = later.receipts[at - 1].action
		var settled := ScorpionMatch.submit(after_supply.duplicate(true), PhaseFlow.acting_side(after_supply.state.cursor),
			{"id": "supply-%d" % at, "expectedRevision": after_supply.revision, "action": step_action}, data)
		_expect(settled.ok, "08 原生 %s %s" % [str(step_action.get("type")), settled.get("errorMessage", "")])
		if not settled.ok:
			return
		after_supply = settled.value.record
		_compare_supply(after_supply.state, later.state, "08 原生 %s 修订 %d" % [str(step_action.get("type")), at])
		_compare_view_at(after_supply, vector, data, "08 原生 %s 视图修订 %d" % [str(step_action.get("type")), at])
		if offset == 2:
			_reject_scorpion(after_supply, data, "soviet", {"type": "check-attrition"},
				"supply_allocation")
	# Combat and exploitation have no oracle past revision 43, so only the invariants are asserted:
	# each close advances the cursor, clears the movement books and leaves the cleanup rollover refused.
	after_supply = _phase_close(after_supply, data, "complete-combat", "exploitation")
	after_supply = _phase_close(after_supply, data, "complete-exploitation", "cleanup")
	after_supply = _cleanup_close(after_supply, data)
	_test_round_rollover(after_supply, data)


## The 08 first-turn window has no formation split, so the split branch of src/match/
## scorpion-supply-phase.ts is exercised with a forged split: an unselected split means no trace,
## the next obligation is the formation choice and attrition stays refused.
func _test_supply_split(record: Dictionary, data: Dictionary) -> void:
	var member := ""
	for id: String in record.state.units:
		var unit: Dictionary = record.state.units[id]
		if str(unit.get("side")) != "soviet" or unit.get("combat") != true or str(unit.get("hex", "")) == "":
			continue
		if record.state.supply.trace.get(id, []).is_empty():
			continue
		member = id
		break
	if member.is_empty():
		_expect(false, "08 原生补给夹具找不到有追溯的苏军战斗力单位")
		return
	var forged: Dictionary = record.duplicate(true)
	forged.state.supply.splits = [{"formation": "forge", "members": [member],
		"anchors": ["direct:forge"], "selected": null}]
	var window: Dictionary = forged.state.supply
	_expect(not SupplyPhase.has_trace(window, member), "08 原生未选追溯的编队成员不算有追溯")
	var step: Dictionary = SupplyPhase.decision(forged.state, "soviet")
	_expect(str(step.get("step")) == "choose-formation-trace" and str(step.get("formation")) == "forge",
		"08 原生未选编队时先要求选追溯来源")
	_reject_scorpion(forged, data, "soviet", {"type": "check-attrition"}, "supply_allocation")
	## src/match/scorpion-supply-phase.ts `selectTraceAnchor` — the pending formation lists its
	## anchors, and picking one outside the list is refused without touching the board.
	var panel: Dictionary = ScorpionView.project(forged, {}, data, "soviet")
	var panels: Array = panel.get("actions", [])
	_expect(panels.size() == 1 and str(panels[0].get("label")) == "forge 追溯 · forge"
		and panels[0].get("actionTypes", [])[0] == "choose-formation-trace",
		"08 原生未选编队时侧栏给出追溯来源选项")
	_reject_scorpion(forged, data, "soviet",
		{"type": "choose-formation-trace", "formation": "forge", "anchor": "hq:nowhere"}, "supply_trace_choice")
	_reject_scorpion(forged, data, "soviet",
		{"type": "choose-formation-trace", "formation": "missing", "anchor": "direct:forge"},
		"supply_trace_choice")
	var anchored := ScorpionMatch.submit(forged.duplicate(true), "soviet",
		{"id": "split-1", "expectedRevision": forged.revision,
			"action": {"type": "choose-formation-trace", "formation": "forge", "anchor": "direct:forge"}}, data)
	_expect(anchored.ok, "08 原生可选编队追溯来源")
	if not anchored.ok:
		return
	var settled: Dictionary = anchored.value.record.state
	_expect(str(SupplyPhase.decision(settled, "soviet").get("step")) == "settle-trace-and-feeding",
		"08 原生选好编队追溯后进入结算追溯")
	_expect(not SupplyPhase.has_trace(settled.supply, member),
		"08 原生选中的虚构来源仍不构成追溯")


## src/match/scorpion-attrition.ts `assignScorpionAttrition` — step losses come out of the
## out-of-supply counters of one hex, and Axis losses raise the sudden-death Soviet VP marker.
func _test_supply_attrition(record: Dictionary, data: Dictionary) -> void:
	var hex := ""
	var fighter := ""
	var doomed := ""
	for id: String in record.state.units:
		var unit: Dictionary = record.state.units[id]
		if str(unit.get("side")) != "soviet" or unit.get("combat") != true or str(unit.get("hex", "")) == "":
			continue
		if fighter == "":
			fighter = id
			hex = str(unit.hex)
			continue
		if str(unit.hex) == hex and int(unit.get("printedRe", 0)) <= 1:
			doomed = id
			break
	if fighter.is_empty():
		_expect(false, "08 原生断补夹具找不到苏军战斗力单位")
		return
	var forged: Dictionary = record.duplicate(true)
	var both: Array = [fighter]
	if doomed != "":
		both.append(doomed)
	for id: String in both:
		forged.state.units[id].outOfSupply = true
	forged.state.cursor.phasing = "axis"
	forged.state.supply.attrition = [{"hex": hex, "units": both, "losses": both.size(),
		"assigned": false}]
	var decision: Dictionary = SupplyPhase.decision(forged.state, "axis")
	_expect(str(decision.get("step")) == "assign-attrition" and str(decision.get("hex")) == hex,
		"08 原生断补损耗先要求按格分配")
	var panel: Dictionary = ScorpionView.project(forged, {}, data, "axis")
	var panels: Array = panel.get("actions", [])
	_expect(panels.size() >= 1 and str(panels[0].get("label")).begins_with("%s 分配 %d 步损失 · 优先 "
		% [hex, both.size()]) and panels[0].get("actionTypes", [])[0] == "assign-attrition",
		"08 原生断补损耗侧栏按优先单位给出分配选项")
	_reject_scorpion(forged, data, "axis",
		{"type": "assign-attrition", "hex": hex, "allocation": [{"unitId": fighter, "steps": 0}]},
		"attrition_allocation")
	_reject_scorpion(forged, data, "axis",
		{"type": "assign-attrition", "hex": hex,
			"allocation": [{"unitId": fighter, "steps": 1}, {"unitId": fighter, "steps": 1}]},
		"attrition_allocation")
	var short := ScorpionMatch.submit(forged.duplicate(true), "axis",
		{"id": "attrition-1", "expectedRevision": forged.revision,
			"action": {"type": "assign-attrition", "hex": hex,
				"allocation": [{"unitId": both[0], "steps": 1}]}}, data)
	_expect(short.ok == (both.size() == 1), "08 原生分配步数不足该格损耗时被拒")
	var losses: Array = []
	for id: String in both:
		losses.append({"unitId": id, "steps": 1})
	var settled := ScorpionMatch.submit(forged.duplicate(true), "axis",
		{"id": "attrition-2", "expectedRevision": forged.revision,
			"action": {"type": "assign-attrition", "hex": hex, "allocation": losses}}, data)
	_expect(settled.ok, "08 原生可按格分配断补步损")
	if not settled.ok:
		return
	var after: Dictionary = settled.value.record.state
	var vp := int(forged.state.arrival.get("sovietVp", 0))
	_expect(int(after.arrival.sovietVp) == vp + both.size(),
		"08 原生轴心分配断补步损时苏军记 %d 胜利点" % both.size())
	_expect(int(after.units[fighter].stepsLost) == int(forged.state.units[fighter].stepsLost) + 1,
		"08 原生断补步损记入存活步数")
	if doomed != "":
		_expect(not after.units.has(doomed), "08 原生断补打光步数的单位离场")
		var piled := false
		for piece: Dictionary in after.pieces:
			if str(piece.get("id")) == doomed and str(piece.location.get("kind")) == "dead-pile":
				piled = true
				break
		_expect(piled, "08 原生断补阵亡单位进死人堆")
	_expect(str(SupplyPhase.decision(after, "axis").get("step")) == "complete-supply",
		"08 原生分配完断补损耗后可结束补给")
	_expect(after.supply.attrition[0].assigned == true, "08 原生分配后该格标记已分配")
	_reject_scorpion(settled.value.record, data, "axis",
		{"type": "assign-attrition", "hex": hex, "allocation": losses}, "attrition_stack")

## is forged onto the second side's Cleanup and the rollover invariants are asserted instead.
func _test_round_rollover(record: Dictionary, data: Dictionary) -> void:
	var forged: Dictionary = record.duplicate(true)
	forged.state.cursor = {"turn": 1, "first": "soviet", "phasing": "axis", "phase": "cleanup",
		"retention": "soviet"}
	forged.state.turn.step = {"kind": "player-turn", "first": "soviet", "retention": "soviet"}
	var rolled := ScorpionMatch.submit(forged.duplicate(true), "axis",
		{"id": "round-1", "expectedRevision": forged.revision,
			"action": {"type": "complete-cleanup"}}, data)
	_expect(rolled.ok, "08 原生回合换手 %s" % rolled.get("errorMessage", ""))
	if not rolled.ok:
		return
	var turn: Dictionary = rolled.value.record.state.turn
	_expect(int(turn.number) == 2, "08 原生回合换手进入第 2 回合")
	_expect(str(turn.weather.ground) == "freeze", "08 原生第 2 回合天气按冻结上限 6 必冻结")
	_expect(str(turn.step.kind) == "retention" and str(turn.step.responder) == "soviet",
		"08 原生第 2 回合先问苏军是否保留主动权")
	# The weather dice must be reproducible from the same record and RNG.
	var replay := ScorpionMatch.submit(forged.duplicate(true), "axis",
		{"id": "round-2", "expectedRevision": forged.revision,
			"action": {"type": "complete-cleanup"}}, data)
	_expect(replay.ok and replay.value.record.state.turn.weather == turn.weather,
		"08 原生回合换手天气可复现")
	var retained := ScorpionMatch.submit(rolled.value.record.duplicate(true), "soviet",
		{"id": "retain", "expectedRevision": rolled.value.record.revision,
			"action": {"type": "retain-initiative", "dumpId": "soviet:hex:s21.04"}}, data)
	_expect(retained.ok, "08 原生苏军付 1 SP 保留主动权 %s" % retained.get("errorMessage", ""))
	if not retained.ok:
		return
	_expect(str(retained.value.record.state.turn.step.kind) == "choose-order",
		"08 原生付补给后进入选先手")
	_expect(int(retained.value.record.state.dumps["soviet:hex:s21.04"].tokens) == 36,
		"08 原生保留主动权从盘上补给堆扣 1 SP")
	var chosen := ScorpionMatch.submit(retained.value.record.duplicate(true), "soviet",
		{"id": "choose", "expectedRevision": retained.value.record.revision,
			"action": {"type": "choose-first", "first": "axis"}}, data)
	_expect(chosen.ok, "08 原生指定先手 %s" % chosen.get("errorMessage", ""))
	if not chosen.ok:
		return
	var cursor: Dictionary = chosen.value.record.state.cursor
	_expect(str(cursor.turn) == "2" and str(cursor.first) == "axis" and str(cursor.phasing) == "axis" \
		and str(cursor.phase) == "aircraft-refit", "08 原生第 2 回合由轴心从整备开局")
	_reject_scorpion(retained.value.record, data, "axis", {"type": "choose-first", "first": "axis"},
		"initiative_step")
	# The retention responder may skip paying by rolling; the other side may not.
	_reject_scorpion(rolled.value.record, data, "axis", {"type": "roll-initiative"},
		"initiative_step")
	var skipped := ScorpionMatch.submit(rolled.value.record.duplicate(true), "soviet",
		{"id": "skip", "expectedRevision": rolled.value.record.revision,
			"action": {"type": "roll-initiative"}}, data)
	_expect(skipped.ok, "08 原生不付补给直接掷主动权 %s" % skipped.get("errorMessage", ""))
	if skipped.ok:
		_expect(str(skipped.value.record.state.turn.step.kind) in ["choose-order", "roll"],
			"08 原生掷主动权后进选先手或等同点重掷")
	var forced: Dictionary = rolled.value.record.duplicate(true)
	forced.state.turn.step = {"kind": "roll", "retention": "soviet"}
	var contest := ScorpionMatch.submit(forced, "soviet",
		{"id": "roll", "expectedRevision": forced.revision,
			"action": {"type": "roll-initiative"}}, data)
	_expect(contest.ok, "08 原生掷主动权 %s" % contest.get("errorMessage", ""))
	if contest.ok:
		var step: Dictionary = contest.value.record.state.turn.step
		_expect(str(step.kind) == "choose-order" or str(step.kind) == "roll",
			"08 原生主动权同点时继续等掷骰")
		if str(step.kind) == "choose-order":
			var expected := "axis" if str(step.retention) != "soviet" or str(step.responder) != "soviet" \
				else "soviet"
			_expect(str(step.responder) == expected, "08 原生主动权由胜方指定先手")


## Cleanup hands the round to the other side without rolling weather; the round rollover past the
## second side is still refused.
func _cleanup_close(record: Dictionary, data: Dictionary) -> Dictionary:
	var wrote := ScorpionMatch.submit(record.duplicate(true), PhaseFlow.acting_side(record.state.cursor),
		{"id": "phase-cleanup", "expectedRevision": record.revision,
			"action": {"type": "complete-cleanup"}}, data)
	_expect(wrote.ok, "08 原生清理收尾 %s" % wrote.get("errorMessage", ""))
	if not wrote.ok:
		return record
	var state: Dictionary = wrote.value.record.state
	_expect(str(state.cursor.phase) == "aircraft-refit" and str(state.cursor.phasing) == "axis" \
		and str(state.cursor.first) == "soviet", "08 原生清理收尾把回合交给轴心")
	_expect(state.moved.is_empty() and state.combatTargets.is_empty(), "08 原生清理收尾清空账本")
	return wrote.value.record


## Submits one phase-closing command and asserts the cursor moved to the named phase with clean books.
func _phase_close(record: Dictionary, data: Dictionary, action: String, phase: String) -> Dictionary:
	var wrote := ScorpionMatch.submit(record.duplicate(true), PhaseFlow.acting_side(record.state.cursor),
		{"id": "phase-%s" % action, "expectedRevision": record.revision, "action": {"type": action}}, data)
	_expect(wrote.ok, "08 原生 %s %s" % [action, wrote.get("errorMessage", "")])
	if not wrote.ok:
		return record
	var state: Dictionary = wrote.value.record.state
	_expect(str(state.cursor.phase) == phase, "08 原生 %s 进入 %s" % [action, phase])
	_expect(state.moved.is_empty() and state.combatTargets.is_empty() and state.overrunMarch == null,
		"08 原生 %s 清空移动与战斗账本" % action)
	var marked := true
	for id: String in state.units:
		if str(state.units[id].get("side")) != str(record.state.cursor.phasing):
			continue
		if state.units[id].get("fueled") == true or state.units[id].get("released") == true:
			marked = false
			break
	_expect(marked, "08 原生 %s 清空本方加油与释放标记" % action)
	return wrote.value.record


func _compare_supply(actual: Dictionary, expected: Dictionary, label: String) -> void:
	var fields := ["kind", "turn", "cursor", "supply", "units", "moved", "railControl", "victory", "rng"]
	var left := {}
	var right := {}
	for field: String in fields:
		left[field] = actual.get(field)
		right[field] = expected.get(field)
	var difference := _first_difference(left, right, "")
	_expect(difference.is_empty(), label + ("" if difference.is_empty() else " · " + difference))


func _compare_movement(actual: Dictionary, expected: Dictionary, label: String) -> void:
	if expected.is_empty():
		_expect(false, label + " · oracle 缺少该修订的对局账本")
		return
	var fields := ["kind", "turn", "cursor", "moved", "groundActivity", "units", "railControl", "victory"]
	var left := {}
	var right := {}
	for field: String in fields:
		left[field] = actual.get(field)
		right[field] = expected.get(field)
	var difference := _first_difference(left, right, "")
	_expect(difference.is_empty(), label + ("" if difference.is_empty() else " · " + difference))


## The 08 first turn awards no Alert, so there is no oracle for this path. The fixture starts from the
## real variable-stage ledger and injects the pool's first Alert, then checks the mutations
## src/match/scorpion-reinforcement.ts performs: settle the pending draw, land one counter, drop the
## pool entry, and record ground control.
func _test_alert_placement(record: Dictionary, data: Dictionary) -> void:
	if record.is_empty() or record.state.get("availableAlerts", []).is_empty():
		_expect(false, "08 警戒营夹具缺少可变阶段账本")
		return
	var counter: Dictionary = record.state.availableAlerts[0]
	# Turn 1 is the Soviet player turn and the Alert pool belongs to the Axis, so the fixture hands the
	# variable stage to the Axis before injecting the pool's first Alert.
	var seeded: Dictionary = record.duplicate(true)
	seeded.state.cursor.phasing = "axis"
	seeded.state.window.pendingAlert = counter
	var bare: Dictionary = seeded.duplicate(true)
	bare.state.window.pendingAlert = null
	var at: Array = ReinforcementBoard.alert_destinations(data.view.mapGraph, data, seeded.state, counter,
		"axis", str(seeded.state.turn.weather.ground))
	_expect(at.size() >= 2, "08 警戒营有可落地的印刷 HQ 落点 (%d)" % at.size())
	_reject_scorpion(seeded, data, "axis", {"type": "place-alert", "hex": "s99.99"}, "alert_destination")
	var placed := ScorpionMatch.submit(seeded.duplicate(true), "axis",
		{"id": "alert-place", "expectedRevision": seeded.revision,
		"action": {"type": "place-alert", "hex": at[0]}}, data)
	_expect(placed.ok, "08 警戒营可以落在 %s %s" % [at[0], placed.get("errorMessage", "")])
	if placed.ok:
		var after: Dictionary = placed.value.record.state
		_expect(after.window.pendingAlert == null, "08 警戒营落子后清空待放置")
		_expect(after.availableAlerts.size() == seeded.state.availableAlerts.size() - 1, "08 警戒营从池中移除")
		_expect(after.placedAlerts.size() == seeded.state.placedAlerts.size() + 1, "08 警戒营记入已放置")
		_expect(str(after.placedAlerts[-1].hex) == at[0] and str(after.placedAlerts[-1].counter.id) == str(counter.id),
			"08 已放置账本记录落点与算子")
		var unit: Dictionary = after.units.get(str(counter.id), {})
		_expect(str(unit.get("hex")) == at[0] and str(unit.get("definition")) == str(counter.definition),
			"08 警戒营落子后生成本方算子")
		_expect(int(unit.get("stepsLost", -1)) == 0, "08 警戒营算子完整上场")
	var passed := ScorpionMatch.submit(seeded.duplicate(true), "axis",
		{"id": "alert-pass", "expectedRevision": seeded.revision, "action": {"type": "pass-alert"}}, data)
	_expect(passed.ok and passed.value.record.state.window.pendingAlert == null, "08 可以放弃本次警戒营")
	if passed.ok:
		var after: Dictionary = passed.value.record.state
		_expect(after.availableAlerts.size() == seeded.state.availableAlerts.size(), "08 放弃警戒营不损耗池")
		_expect(after.placedAlerts.is_empty(), "08 放弃警戒营不记入已放置")
	_reject_scorpion(seeded, data, "soviet", {"type": "place-alert", "hex": at[0]}, "wrong_actor")
	_reject_scorpion(bare, data, "axis", {"type": "place-alert", "hex": at[0]}, "alert_pending")
	_reject_scorpion(bare, data, "axis", {"type": "pass-alert"}, "alert_pending")
	_reject_scorpion(seeded, data, "axis", {"type": "complete-reinforcement"}, "variable_pending")


## Every guard below is a rule the TypeScript reinforcement phase enforces: the non-phasing side,
## an unknown or illegal entry hex, a delivery outside the printed hex, an oversized delivery, and
## closing the window before the scheduled obligations and the variable award are settled.
func _reject_reinforcements(record: Dictionary, data: Dictionary) -> void:
	_reject_scorpion(record, data, "axis", {"type": "place-arrival",
		"arrivalId": "1:soviet:land:id:2098", "hex": "s1.12"}, "wrong_actor")
	_reject_scorpion(record, data, "soviet", {"type": "place-arrival",
		"arrivalId": "1:soviet:land:id:9999", "hex": "s1.12"}, "unknown_arrival")
	_reject_scorpion(record, data, "soviet", {"type": "place-arrival",
		"arrivalId": "1:soviet:land:id:2098", "hex": "s99.99"}, "arrival_destination")
	_reject_scorpion(record, data, "soviet", {"type": "place-arrival",
		"arrivalId": "1:soviet:land:id:2098", "hex": "s22.02"}, "arrival_destination")
	_reject_scorpion(record, data, "soviet", {"type": "place-supply",
		"target": {"kind": "hex", "id": "s1.12"}, "tokens": 4}, "fixed_destination")
	_reject_scorpion(record, data, "soviet", {"type": "place-supply",
		"target": {"kind": "hex", "id": "s22.02"}, "tokens": 12}, "supply_tokens")
	_reject_scorpion(record, data, "soviet", {"type": "finish-scheduled-arrivals"}, "arrivals_pending")
	_reject_scorpion(record, data, "soviet", {"type": "complete-reinforcement"}, "variable_pending")


func _compare_reinforcement(actual: Dictionary, expected: Dictionary, label: String) -> void:
	if expected.is_empty():
		_expect(false, label + " · oracle 缺少该修订的增援账本")
		return
	var fields := ["kind", "turn", "cursor", "window", "arrival", "arrivalsOnMap", "dumps", "pax",
		"availableAlerts", "placedAlerts", "victory", "rng", "railControl", "units"]
	var left := {}
	var right := {}
	for field: String in fields:
		left[field] = actual.get(field)
		right[field] = expected.get(field)
	var difference := _first_difference(left, right, "")
	_expect(difference.is_empty(), label + ("" if difference.is_empty() else " · " + difference))


## Review check: transport stock counts by printed denominations, so a mobility/allowance edit on a
## deployed counter must not move counts between rows (src/match/scorpion-transport-points.ts).
func _test_transport_buckets(bundle: Dictionary) -> void:
	var units: Dictionary = bundle.opening.units.duplicate(true)
	var base: Array = ScorpionView.transport_stock(units, "soviet", bundle)
	var used := 0
	for row: Dictionary in base:
		used += int(row.inUse)
	_expect(used > 0, "08 苏军运输面额有在盘计数")
	var mutated := units.duplicate(true)
	var target := ""
	for id: String in mutated:
		var unit: Dictionary = mutated[id]
		var definition: Dictionary = bundle.view.catalog.definitions.get(unit.get("definition"), {})
		if unit.get("combat") != true and unit.get("organicTruck") == null \
				and definition.get("kind") == "transport" and definition.get("moveProfile") is Dictionary:
			target = id
			break
	if target == "":
		return
	mutated[target].mobility = "bogus"
	mutated[target].allowance = 999
	_compare(ScorpionView.transport_stock(mutated, "soviet", bundle), base,
		"运输面额按印面计数，不随盘上字段漂移")


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


## OCS 13.6 entry hexes for every printed arrival plus the Alert HQ locations; both are compared
## against the TypeScript reinforcement board at the same first-turn state.
func _test_reinforcement_board(state: Dictionary, bundle: Dictionary, path: String) -> void:
	var read := JsonFile.read(path)
	_expect(read.ok, read.get("errorMessage", "08 增援板对照有效"))
	if not read.ok:
		return
	var fixture: Dictionary = read.value.document
	_expect(str(bundle.fingerprint) == str(fixture.fingerprint), "08 增援板对照与初设指纹一致")
	var graph: Dictionary = bundle.view.mapGraph
	var units: Dictionary = state.get("units", {})
	_expect(units.size() > 0, "08 增援板对照读取对局算子")
	var mismatched: Array = []
	var checked := 0
	for entry: Dictionary in fixture.arrivals:
		var legal: Array = ReinforcementBoard.arrival_destinations(graph, bundle, state, entry)
		checked += 1
		if JSON.stringify(legal) == JSON.stringify(entry.legal):
			continue
		if mismatched.size() < 3:
			mismatched.append(" · %s 原生 %s ≠ TS %s" % [entry.id, JSON.stringify(legal), JSON.stringify(entry.legal)])
	_expect(mismatched.is_empty() and checked == fixture.arrivals.size(),
		"08 全编目抵达落点一致 (%d 条)%s" % [checked, "".join(mismatched)])
	var alerts: Array = []
	for counter: Dictionary in fixture.alerts:
		var legal: Array = ReinforcementBoard.alert_destinations(graph, bundle, state, counter,
			"axis", str(fixture.weather))
		if JSON.stringify(legal) != JSON.stringify(counter.legal):
			alerts.append(" · %s 原生 %s ≠ TS %s" % [counter.id, JSON.stringify(legal), JSON.stringify(counter.legal)])
	_expect(alerts.is_empty() and not fixture.alerts.is_empty(),
		"08 Alert 落点一致 (%d 枚)%s" % [fixture.alerts.size(), "".join(alerts)])


## The native trace must reproduce every per-hex option list and, once coverage is prepared,
## the same covered set the TypeScript network reports after prepareTraceCoverage.
func _test_supply_trace(state: Dictionary, bundle: Dictionary, path: String) -> void:
	var read := JsonFile.read(path)
	_expect(read.ok, read.get("errorMessage", "08 补给 trace 对照有效"))
	if not read.ok:
		return
	var fixture: Dictionary = read.value.document
	_expect(str(bundle.fingerprint) == str(fixture.fingerprint), "08 补给 trace 对照与初设指纹一致")
	var graph: Dictionary = bundle.view.mapGraph
	var units: Dictionary = state.get("units", {})
	var rail_control: Dictionary = state.get("railControl", {})
	var hexes: Array = fixture.hexes
	for side: String in ["axis", "soviet"]:
		var facts: Dictionary = SupplyPosition.position(units, rail_control, side, bundle)
		_expect(str(facts.weather) == str(fixture.sides[side].weather), "08 %s trace 天候" % side)
		var network: RefCounted = SupplyTrace.network(graph, facts, side, str(fixture.sides[side].weather))
		for mobility: String in fixture.mobilities:
			var expected: Dictionary = fixture.sides[side].trace[mobility]
			var samples: Array = []
			for hex: String in hexes:
				var actual: Array = SupplyTrace.options_of(network, hex, mobility)
				if JSON.stringify(actual) == JSON.stringify(expected.get(hex, [])):
					continue
				if samples.size() < 3:
					samples.append(" · %s 原生 %s ≠ TS %s" % [hex, JSON.stringify(actual), JSON.stringify(expected.get(hex, []))])
			_expect(samples.is_empty(), "08 %s %s trace 选项逐格一致 (%d 格)%s" % [side, mobility, hexes.size(), "".join(samples)])
			network.prepare_trace_coverage(mobility)
			var covered := {}
			for hex: String in fixture.sides[side].covered[mobility]:
				covered[hex] = true
			var missed: Array = []
			for hex: String in hexes:
				if network.has_trace(hex, mobility) == covered.has(hex):
					continue
				if missed.size() < 3:
					missed.append(" · %s 原生 %s" % [hex, str(network.has_trace(hex, mobility))])
			_expect(missed.is_empty(), "08 %s %s 覆盖集一致 (%d 格)%s" % [side, mobility, covered.size(), "".join(missed)])


## Every printed hexside, both directions, all three mobilities, freeze and thaw: the native
## step cost must equal scorpionTraceStepCost, and the ordinary dry column must match too.
func _test_terrain_cost(bundle: Dictionary, path: String) -> void:
	var read := JsonFile.read(path)
	_expect(read.ok, read.get("errorMessage", "08 格边取费对照有效"))
	if not read.ok:
		return
	var fixture: Dictionary = read.value.document
	_expect(str(bundle.fingerprint) == str(fixture.fingerprint), "08 格边取费对照与初设指纹一致")
	var graph: Dictionary = bundle.view.mapGraph
	_expect(graph.get("terrains", {}).size() > 0, "08 地图拓扑包含地形")
	var trace: Dictionary = _compare_costs(fixture.costs, graph, true)
	_expect(trace.passed, "08 全边天候取费与 TS 逐条一致 (%d 条)%s" % [trace.checked, trace.detail])
	var dry: Dictionary = _compare_costs(fixture.dry, graph, false)
	_expect(dry.passed, "08 全边干地取费与 TS 逐条一致 (%d 条)%s" % [dry.checked, dry.detail])


## Keys are "weather|mobility|from|to" for the trace and "mobility|from|to" for the dry column.
func _compare_costs(rows: Dictionary, graph: Dictionary, trace: bool) -> Dictionary:
	var checked := 0
	var samples: Array = []
	for key: String in rows:
		var parts := key.split("|")
		var actual: Variant
		if trace:
			actual = TerrainCost.trace_step_cost(graph, parts[2], parts[3], parts[1], parts[0])
		else:
			actual = TerrainCost.step_cost(graph, parts[1], parts[2], parts[0], "dry")
		checked += 1
		if _same_cost(actual, rows[key]):
			continue
		if samples.size() < 3:
			samples.append(" · %s 原生 %s ≠ TS %s" % [key, JSON.stringify(actual), JSON.stringify(rows[key])])
	return {"checked": checked, "passed": checked > 0 and samples.is_empty(), "detail": "".join(samples)}


func _same_cost(actual: Variant, expected: Variant) -> bool:
	var numeric := [TYPE_INT, TYPE_FLOAT]
	if actual == null or expected == null:
		return actual == null and expected == null
	if actual is String or expected is String:
		return actual is String and expected is String and actual == expected
	if typeof(actual) in numeric and typeof(expected) in numeric:
		return is_equal_approx(float(actual), float(expected))
	return false


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
