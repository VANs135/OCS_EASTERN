extends RefCounted

## 端到端会话集成用例：LocalSession.open + session.dispatch 验证本轮接入原生 08 对局的命令路由。
## 覆盖：换面（战斗面↔移动面）、预备三命令合法/拒绝、七步战斗路由与步损落地、炮击接受/拒绝。
## 期望值来自真实 08 数据包与 dist/godot 夹具；断言一律走 ctx.expect / ctx.compare。
## 入口契约：static func run(ctx: Dictionary) -> void。

const JsonFile := preload("res://scripts/data/json_file.gd")
const LocalSession := preload("res://scripts/session/local_session.gd")
const CommandLog := preload("res://scripts/core/command_log.gd")

const DIST_REL := "../../../dist/godot"
const BUNDLE_REL := "../../../dist/godot/08-opening-data.json"
const VECTOR_REL := "../../../dist/godot/08-scorpion.json"


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var bundle := _load_bundle(ctx)
	if bundle.is_empty():
		expect.call(false, "集成用例：08 初设数据包可读")
		return
	var vector := _read_dist("08-scorpion.json")
	_check_ground_mode(ctx, bundle, vector)
	_check_reserves(ctx, bundle, vector)
	_check_combat(ctx, bundle)
	_check_barrage(ctx, bundle)


# ── 换面：真实开局会话回放部署序列后，在移动阶段切换战斗面/移动面并逐面模板比对 ──

static func _check_ground_mode(ctx: Dictionary, bundle: Dictionary, vector: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var session := _open_replayed_session(ctx, bundle, vector)
	if session == null:
		return
	var target_id := _first_soviet_combat(session.state())
	expect.call(target_id != "", "集成·换面：在盘找到合格苏军地面算子")
	if target_id == "":
		return
	_forge_movement(session)
	var unit0: Dictionary = session.state().get("units", {}).get(target_id, {})
	var definition := str(unit0.get("definition", ""))
	var faces: Dictionary = bundle.get("view", {}).get("catalog", {}).get("faces", {}).get(definition, {})
	var from_face := "move" if unit0.get("moveMode") == true else "combat"
	var to_face := "move" if from_face == "combat" else "combat"
	var revision_before: int = session.revision()

	var out: Dictionary = session.dispatch({"kind": "command",
		"action": {"type": "set-ground-mode", "unitId": target_id, "face": to_face}})
	expect.call(out.ok, "集成·换面：set-ground-mode 接受 · %s" % str(out.get("errorMessage", "")))
	if out.ok:
		expect.call(session.revision() == revision_before + 1, "集成·换面：切换后修订号 +1")
		var unit: Dictionary = session.state().get("units", {}).get(target_id, {})
		_assert_face(expect, unit, faces.get(to_face, {}), to_face, "集成·换面：%s 面模板" % to_face)

	var back: Dictionary = session.dispatch({"kind": "command",
		"action": {"type": "set-ground-mode", "unitId": target_id, "face": from_face}})
	expect.call(back.ok, "集成·换面：切回 %s 面接受" % from_face)
	if back.ok:
		var unit_back: Dictionary = session.state().get("units", {}).get(target_id, {})
		_assert_face(expect, unit_back, faces.get(from_face, {}), from_face, "集成·换面：%s 面模板" % from_face)


# ── 预备：进预备 / 退预备合法路径；移动阶段释放拒绝；进击阶段释放合法路径 ──

static func _check_reserves(ctx: Dictionary, bundle: Dictionary, vector: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var session := _open_replayed_session(ctx, bundle, vector)
	if session == null:
		return
	_forge_movement(session)

	# 逐个候选尝试进预备（拒绝命令不改盘面），取第一枚合法算子走完合法路径。
	var target_id := ""
	var candidates: Array = []
	for id: String in session.state().get("units", {}):
		var unit: Dictionary = session.state().units[id]
		if str(unit.get("side", "")) == "soviet" and unit.get("combat") == true \
				and str(unit.get("mobility", "")) == "leg" and unit.get("reserve") == null:
			candidates.append(id)
	for candidate: String in candidates:
		var probe: Dictionary = session.dispatch({"kind": "command",
			"action": {"type": "mark-reserve", "unitId": candidate}})
		if probe.ok:
			target_id = candidate
			break
	expect.call(target_id != "", "集成·预备：mark-reserve 找到合法苏军算子")
	if target_id == "":
		return
	expect.call(session.state().get("units", {}).get(target_id, {}).get("reserve") != null,
		"集成·预备：预备标记落盘")

	var leave: Dictionary = session.dispatch({"kind": "command",
		"action": {"type": "leave-reserve", "unitId": target_id}})
	expect.call(leave.ok, "集成·预备：leave-reserve 接受 · %s" % str(leave.get("errorMessage", "")))
	if leave.ok:
		expect.call(session.state().get("units", {}).get(target_id, {}).get("reserve") == null,
			"集成·预备：退预备清除标记")

	# 拒绝路径：移动阶段不得释放预备（阶段门禁，与 ZOC 无关）。
	var release_move: Dictionary = session.dispatch({"kind": "command",
		"action": {"type": "release-reserve", "unitId": target_id}})
	expect.call(not release_move.ok and str(release_move.get("errorCode", "")) == "reserve_release",
		"集成·预备：移动阶段拒绝释放预备（实际 %s）" % str(release_move.get("errorCode", "")))

	# 合法释放：再次进预备 → 进击阶段释放。
	var remark: Dictionary = session.dispatch({"kind": "command",
		"action": {"type": "mark-reserve", "unitId": target_id}})
	expect.call(remark.ok, "集成·预备：再次进预备接受 · %s" % str(remark.get("errorMessage", "")))
	if not remark.ok:
		return
	var state: Dictionary = session.state()
	state.cursor.phase = "exploitation"
	state.cursor.phasing = "soviet"
	state.combatTargets = []
	var release: Dictionary = session.dispatch({"kind": "command",
		"action": {"type": "release-reserve", "unitId": target_id}})
	expect.call(release.ok, "集成·预备：进击阶段 release-reserve 接受 · %s" % str(release.get("errorMessage", "")))
	if release.ok:
		var unit: Dictionary = session.state().get("units", {}).get(target_id, {})
		expect.call(unit.get("released") == true, "集成·预备：释放后 released 落盘")
		expect.call(unit.get("reserve") == null, "集成·预备：释放后预备标记清除")


# ── 七步战斗：08-combat.json 伪造局面换入真实数据包会话，逐命令走会话路由 ──

static func _check_combat(ctx: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var fixture := _read_dist("08-combat.json")
	var scenarios: Array = fixture.get("scenarios", [])
	if scenarios.is_empty():
		expect.call(false, "集成·战斗：08 战斗夹具可读")
		return
	var sc: Dictionary = scenarios[0]
	var base: Dictionary = sc.get("base", {}).duplicate(true)
	var opened := LocalSession.open(bundle, 1.0)
	expect.call(opened.ok, "集成·战斗：会话可从 08 数据包开局")
	if not opened.ok:
		return
	var session: RefCounted = opened.value
	session._record = CommandLog.create_record(base)

	var attacker_id := str(sc.get("attackerId", ""))
	var defender_id := str(sc.get("defenderId", ""))
	var attacker_side := str(base.get("units", {}).get(attacker_id, {}).get("side", "soviet"))
	var defender_side := str(base.get("units", {}).get(defender_id, {}).get("side", "axis"))
	var step_next := {
		"declare": "defender-supply", "defend": "attacker-rating",
		"attacker-rating": "defender-rating", "defender-rating": "defender-terrain",
		"defender-terrain": "attacker-result", "attacker-result": "defender-result",
	}
	for step: Dictionary in sc.get("steps", []):
		var step_name := str(step.get("step", ""))
		var action: Dictionary = step.get("action", {}).duplicate(true)
		action["type"] = _combat_action_type(step_name)
		var draws_before: int = int(session.state().get("rng", {}).get("drawCount", 0))
		var seat: String = defender_side if _is_defender_step(step_name) else attacker_side
		var outcome: Dictionary = session.dispatch({"kind": "command", "seat": seat, "action": action})
		expect.call(outcome.ok, "集成·战斗：路由可达 %s · %s" % [step_name, str(outcome.get("errorMessage", ""))])
		if not outcome.ok:
			return
		# 选地形这一步必须由引擎自掷骰并推进 rng，不接受外部注入骰面。
		if step_name == "defender-terrain":
			var result: Dictionary = step.get("roll", {})
			var expected_draws: int = 5 if int(result.get("shift", 0)) != 0 else 4
			expect.call(int(session.state().get("rng", {}).get("drawCount", 0)) == draws_before + expected_draws,
				"集成·战斗：选地形消耗随机数 %d 次" % expected_draws)
			expect.call(str(session.state().get("combat", {}).get("roll", {}).get("code", "")) == str(result.get("code", "")),
				"集成·战斗：选地形掷出与 oracle 相同的结果码")
		var combat: Variant = session.state().get("combat")
		if step_next.has(step_name):
			var expected_step := str(step_next[step_name])
			expect.call(combat != null and str(combat.get("step", "")) == expected_step,
				"集成·战斗：%s 后进入 %s 步骤" % [step_name, expected_step])

	expect.call(not session.state().get("units", {}).has(attacker_id),
		"集成·战斗：攻方承受强制损失后离场")
	var dead_pile := false
	for piece: Dictionary in session.state().get("pieces", []):
		if str(piece.get("id", "")) == attacker_id \
				and str(piece.get("location", {}).get("kind", "")) == "dead-pile":
			dead_pile = true
	expect.call(dead_pile, "集成·战斗：离场攻方进入死人堆")
	expect.call(session.state().get("combat") == null, "集成·战斗：结算后待决战斗清空")


# ── 炮击：08-barrage.json 一条接受路径 + 一条拒绝路径，均经会话路由 ──

static func _check_barrage(ctx: Dictionary, bundle: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var fixture := _read_dist("08-barrage.json")
	var cases: Array = fixture.get("cases", [])
	if cases.is_empty():
		expect.call(false, "集成·炮击：08 炮击夹具可读")
		return
	var accepted: Dictionary = {}
	var rejected: Dictionary = {}
	for entry: Dictionary in cases:
		if entry.get("reject") != null:
			# 优先选取声明阶段拒绝用例（待决炮击尚不存在，分配类拒绝无法在会话里复现）。
			var reject_actions: Array = entry.get("actions", [])
			if rejected.is_empty() or str(reject_actions[0].get("type", "")) == "declare-artillery-barrage":
				rejected = entry
		elif accepted.is_empty():
			accepted = entry

	if not accepted.is_empty():
		var base: Dictionary = accepted.get("state", {}).duplicate(true)
		var opened := LocalSession.open(bundle, 1.0)
		var session: RefCounted = opened.value
		session._record = CommandLog.create_record(base)
		var history_before: int = session.state().get("barrageHistory", []).size()
		var actions: Array = accepted.get("actions", [])
		var accepted_all := true
		for index: int in actions.size():
			var action: Dictionary = actions[index].duplicate(true)
			var seat: String = "soviet"
			if str(action.get("type", "")) != "declare-artillery-barrage":
				seat = str(session.state().get("barrage", {}).get("defender", "axis"))
			var outcome: Dictionary = session.dispatch({"kind": "command", "seat": seat, "action": action})
			expect.call(outcome.ok, "集成·炮击：路由可达 %s · %s" % [
				str(action.get("type", "")), str(outcome.get("errorMessage", ""))])
			if not outcome.ok:
				accepted_all = false
				break
		if accepted_all:
			expect.call(session.state().get("barrageHistory", []).size() > history_before,
				"集成·炮击：结算写入炮击历史")
			expect.call(session.state().get("barrage") == null, "集成·炮击：完成后待决炮击清空")

	if not rejected.is_empty():
		var base: Dictionary = rejected.get("state", {}).duplicate(true)
		var opened := LocalSession.open(bundle, 1.0)
		var session: RefCounted = opened.value
		session._record = CommandLog.create_record(base)
		var before: Dictionary = session.state().duplicate(true)
		var reject_actions: Array = rejected.get("actions", [])
		if not reject_actions.is_empty():
			var action: Dictionary = reject_actions[0].duplicate(true)
			var outcome: Dictionary = session.dispatch({"kind": "command", "seat": "soviet", "action": action})
			var expected_code := str(rejected.get("reject", {}).get("code", ""))
			expect.call(not outcome.ok and str(outcome.get("errorCode", "")) == expected_code,
				"集成·炮击：拒绝 %s（实际 %s）" % [expected_code, str(outcome.get("errorCode", ""))])
			expect.call(_state_same(session.state(), before), "集成·炮击：拒绝保持盘面")


# ── 辅助 ──

static func _open_replayed_session(ctx: Dictionary, bundle: Dictionary, vector: Dictionary) -> RefCounted:
	var expect: Callable = ctx.expect
	var opened := LocalSession.open(bundle, 1.0)
	expect.call(opened.ok, "集成：08 数据包会话可开局")
	if not opened.ok:
		return null
	var session: RefCounted = opened.value
	for step: Dictionary in vector.get("steps", []):
		if session.state().kind != "setup":
			break
		var outcome: Dictionary = session.dispatch(step.get("request", {}).duplicate(true))
		if not outcome.ok:
			break
	expect.call(session.state().kind == "playing", "集成：开局部署回放后进入 playing 状态")
	if session.state().kind != "playing":
		return null
	return session


static func _forge_movement(session: RefCounted) -> void:
	var state: Dictionary = session.state()
	state.cursor.phase = "movement"
	state.cursor.phasing = "soviet"
	state.moved = []
	state.groundActivity = {
		"turn": int(state.turn.number), "phasing": "soviet", "phase": "movement",
		"spent": {}, "airlifted": [],
	}


static func _first_soviet_combat(state: Dictionary) -> String:
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if str(unit.get("side", "")) == "soviet" and unit.get("combat") == true \
				and str(unit.get("mobility", "")) == "leg" and unit.get("reserve") == null:
			return id
	return ""


static func _is_defender_step(step_name: String) -> bool:
	return step_name in ["defend", "defender-rating", "defender-terrain", "defender-result"]


static func _combat_action_type(step_name: String) -> String:
	match step_name:
		"declare":
			return "declare-combat"
		"defend":
			return "defend-combat"
		"attacker-rating", "defender-rating":
			return "select-combat-rating"
		"defender-terrain":
			return "choose-combat-terrain"
		"attacker-result", "defender-result":
			return "resolve-combat"
	return ""


static func _assert_face(expect: Callable, unit: Dictionary, template: Dictionary, face: String,
		label: String) -> void:
	expect.call(bool(unit.get("moveMode", false)) == (face == "move"), label + " · moveMode")
	for field: String in ["mobility", "allowance", "strength", "actionRating"]:
		expect.call(_num_eq(unit.get(field), template.get(field)), label + " · " + field)


static func _num_eq(actual: Variant, expected: Variant) -> bool:
	if expected == null:
		return actual == null
	if not (actual is int or actual is float) or not (expected is int or expected is float):
		return actual == expected
	return absf(float(actual) - float(expected)) <= 1e-9


static func _state_same(a: Dictionary, b: Dictionary) -> bool:
	if not _units_same(a.get("units", {}), b.get("units", {})):
		return false
	if not _dumps_same(a.get("dumps", {}), b.get("dumps", {})):
		return false
	if a.get("barrage", null) != b.get("barrage", null):
		return false
	if str(a.get("barrageHistory", [])) != str(b.get("barrageHistory", [])):
		return false
	return true


static func _units_same(a: Dictionary, b: Dictionary) -> bool:
	if a.size() != b.size():
		return false
	for id: String in a:
		if not b.has(id):
			return false
		var ua: Dictionary = a[id]
		var ub: Dictionary = b[id]
		if str(ua.get("hex", "")) != str(ub.get("hex", "")):
			return false
		if int(ua.get("stepsLost", 0)) != int(ub.get("stepsLost", 0)):
			return false
		if str(ua.get("side", "")) != str(ub.get("side", "")):
			return false
	return true


static func _dumps_same(a: Dictionary, b: Dictionary) -> bool:
	if a.size() != b.size():
		return false
	for id: String in a:
		if not b.has(id):
			return false
		if int(a[id].get("tokens", 0)) != int(b[id].get("tokens", 0)):
			return false
	return true


static func _load_bundle(ctx: Dictionary) -> Dictionary:
	var args: Array = ctx.get("args", [])
	var path: String = str(args[0]) if args.size() >= 1 and str(args[0]) != "" else _rel(BUNDLE_REL)
	var read := JsonFile.read(path)
	if read.get("ok", false):
		return read.value.document
	return {}


static func _read_dist(file: String) -> Dictionary:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var read := JsonFile.read((base + "/" + DIST_REL + "/" + file).simplify_path())
	if read.get("ok", false):
		return read.value.document
	return {}


static func _rel(rel: String) -> String:
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	return (base + "/" + rel).simplify_path()
