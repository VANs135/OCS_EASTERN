extends RefCounted

const Fuel := preload("res://works/third-winter/rules/fuel.gd")
const CommandLog := preload("res://scripts/core/command_log.gd")
const Deployment := preload("deployment.gd")
const Reinforcement := preload("res://works/third-winter/rules/reinforcement.gd")
const GroundMove := preload("res://works/third-winter/rules/ground_move.gd")
const SupplyPhase := preload("res://works/third-winter/rules/supply_phase.gd")
const PhaseFlow := preload("res://works/third-winter/rules/phase_flow.gd")
const Round := preload("res://works/third-winter/rules/round.gd")
const Remnants := preload("res://works/third-winter/rules/remnants.gd")
const Result := preload("res://scripts/core/result.gd")
const Stacking := preload("res://works/third-winter/rules/stacking.gd")
const GroundModeActions := preload("res://works/third-winter/rules/ground_mode_actions.gd")
const Reserves := preload("res://works/third-winter/rules/reserves.gd")
const Combat := preload("res://works/third-winter/rules/combat.gd")
const CombatResult := preload("res://works/third-winter/rules/combat_result.gd")
const Barrage := preload("res://works/third-winter/rules/barrage.gd")
const Hedgehogs := preload("res://works/third-winter/rules/hedgehogs.gd")
const Capture := preload("res://works/third-winter/rules/capture.gd")
const Crt := preload("res://scripts/rules/series/crt.gd")
const TransportPoints := preload("res://works/third-winter/rules/transport_points.gd")
const Kessel := preload("res://works/third-winter/rules/kessel.gd")
const Overrun := preload("res://works/third-winter/rules/overrun.gd")


static func submit(record: Dictionary, seat: String, command: Dictionary, data: Dictionary) -> Dictionary:
	return CommandLog.accept_command(record, seat, command, _apply.bind(data))


static func _apply(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	# TS 会话级守卫：夺取窗口未结算时，除 settle-capture 外一切命令都被挡住。
	if state.get("kind") == "playing" and state.get("capture") != null \
			and str(action.get("type", "")) != "settle-capture":
		return Result.failure("capture_pending", "须先结算待决的进格夺取")
	if action.get("type") == "settle-capture":
		return Capture.settle(state, actor, action, data)
	if action.get("type") in ["base-aircraft", "place-setup-alert", "choose-setup-loss", "confirm-setup"]:
		if not data.has("deployment"):
			return Result.failure("deployment_data_unavailable", "请重新生成包含部署数据的 08 数据包")
		return Deployment.apply_action(state, actor, action, data)
	# OCS v4.3 §2.2 — the Aircraft Refit Phase closes once stacking is legal.
	# Only the off-map air box refit is free of the supply network; airbase refits still need it.
	if action.get("type") == "complete-refit":
		if state.kind != "playing":
			return Result.failure("match_not_started", "请先开始 08 对局")
		if state.cursor.phase != "aircraft-refit" or state.get("window") != null:
			return Result.failure("reinforcement_window", "当前阶段不能结束整备")
		var stacked := Stacking.assert_phase_stacking(state, actor)
		if not stacked.ok:
			return stacked
		return Reinforcement.enter(state, actor, data)
	# OCS 13.6 / TTW 1.7a — the reinforcement phase of src/match/scorpion-reinforcement.ts.
	if action.get("type") == "ground-move":
		return GroundMove.apply(state, actor, action, data)
	if action.get("type") == "fuel-from-paused-transport":
		return Fuel.fuel_from_transport(state, actor, str(action.get("unitId", "")),
			str(action.get("transportId", "")), data)
	if action.get("type") == "fuel-formation":
		return Fuel.buy_formation_fuel(state, actor, str(action.get("formation", "")),
			str(action.get("headquartersId", "")), action.get("payments", []), data)
	if action.get("type") == "fuel-headquarters":
		return Fuel.buy_headquarters_fuel(state, actor, str(action.get("headquartersId", "")),
			action.get("payments", []), data)
	if action.get("type") == "repack-transport":
		return TransportPoints.repack(state, actor, action, data)
	if action.get("type") in ["place-kessel-hq", "remove-kessel-hq"]:
		return Kessel.apply(state, actor, action, data)
	if action.get("type") == "kessel-move":
		return Kessel.move_apply(state, actor, action, data)
	if action.get("type") == "complete-movement":
		return SupplyPhase.complete_movement(state, actor, data)
	if action.get("type") == "check-attrition":
		return SupplyPhase.check_attrition(state, actor, data)
	if action.get("type") == "choose-formation-trace":
		return SupplyPhase.choose_formation(state, actor, action)
	if action.get("type") == "feed-units":
		return SupplyPhase.feed_units(state, actor, action, data)
	if action.get("type") == "assign-attrition":
		return SupplyPhase.assign_attrition(state, actor, action, data)
	if action.get("type") == "complete-supply":
		return SupplyPhase.complete_supply(state, actor)
	if action.get("type") in ["complete-reaction", "complete-combat", "complete-exploitation", "complete-cleanup"]:
		return PhaseFlow.apply(state, actor, action, data)
	if action.get("type") in ["retain-initiative", "roll-initiative", "choose-first"]:
		return Round.answer(state, actor, action, data)
	if action.get("type") == "rebuild-remnant":
		return Remnants.rebuild(state, actor, action, data)
	if action.get("type") in ["place-arrival", "place-supply", "finish-scheduled-arrivals",
			"place-alert", "pass-alert", "complete-reinforcement"]:
		if state.kind != "playing":
			return Result.failure("match_not_started", "请先开始 08 对局")
		return Reinforcement.apply(state, actor, action, data)
	# OCS 5.4 — 朝向面切换（战斗面/移动面），不消耗 MP。
	if action.get("type") == "set-ground-mode":
		return GroundModeActions.set_ground_mode(state, actor, action, data)
	# TTW 08 预备三命令：进预备 / 退预备 / 反应或进击阶段释放预备。
	if action.get("type") in ["mark-reserve", "leave-reserve", "release-reserve"]:
		return _reserve_command(state, actor, action, data)
	if action.get("type") == "declare-overrun":
		return Overrun.declare(state, actor, action, data, _combat_board(data))
	if action.get("type") == "continue-overrun-move":
		return Overrun.continue_apply(state, actor, action, data)
	# OCS v4.3 §9.5–9.13 正规战斗七步：宣告、守方补给、选行动值、选地形（攻/守方结算与进击见结果分支）。
	if action.get("type") in ["declare-combat", "defend-combat", "select-combat-rating", "choose-combat-terrain"]:
		return _combat_command(state, actor, action, data)
	# 战斗结果：攻/守方结算、战后推进与挂起撤退续跑。
	if action.get("type") in ["resolve-combat", "advance-after-combat", "continue-combat-retreat"]:
		return _combat_result_command(state, actor, action, data)
	# OCS 13.3 工事作业：构筑（8T）/ 拆除（0T），限本方移动阶段。
	if action.get("type") == "work-hedgehog":
		return Hedgehogs.work(state, actor, action, data)
	# OCS 10.0 地面炮兵炮击：声明 / 选地形 / 分配射击损失。
	if action.get("type") in ["declare-artillery-barrage", "choose-barrage-terrain", "assign-barrage-loss"]:
		return Barrage.apply(state, actor, action, data)
	return Result.failure("unsupported_action", "该机制尚未接入原生 08 对局")


static func _reserve_command(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	match str(action.get("type", "")):
		"mark-reserve":
			return Reserves.mark_reserve(state, actor, action, data)
		"leave-reserve":
			return Reserves.leave_reserve(state, actor, action, data)
		_:
			return Reserves.release_reserve(state, actor, action, data)


static func _combat_command(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var board := _combat_board(data)
	match str(action.get("type", "")):
		"declare-combat":
			return Combat.declare(state, actor, action, data, board)
		"defend-combat":
			return Combat.defend(state, actor, action, data)
		"select-combat-rating":
			return Combat.select_rating(state, actor, str(action.get("unitId", "")))
		"choose-combat-terrain":
			return Combat.choose_terrain(state, actor, action, data, board)
	return Result.failure("unsupported_action", "该战斗命令尚未接入原生 08 对局")


static func _combat_result_command(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var board := _combat_board(data)
	match str(action.get("type", "")):
		"resolve-combat":
			return _unwrap_match_state(CombatResult.resolve(state, actor, action, data, board))
		"advance-after-combat":
			return _unwrap_match_state(CombatResult.advance(state, actor, action.get("unitIds", []), data, board,
				action.get("breakdowns", [])))
		"continue-combat-retreat":
			return _unwrap_match_state(CombatResult.continue_retreat(state, actor, action, data, board))
	return Result.failure("unsupported_action", "该战斗结果命令尚未接入原生 08 对局")


## CombatResult.resolve/advance 返回 {state, granted/advanced/entrants} 包装；对局记录只落盘面状态，解包出 state。
static func _unwrap_match_state(res: Dictionary) -> Dictionary:
	if not res.get("ok", false):
		return res
	var value: Variant = res.get("value")
	if value is Dictionary and value.has("state"):
		return Result.success(value.state)
	return res


## 战斗掷骰用 CRT 表：数据包可注入 combatTable，缺省读通规默认表。
static func _combat_board(data: Dictionary) -> Dictionary:
	var table: Variant = data.get("combatTable")
	if table is Dictionary and not table.is_empty():
		return {"table": table}
	var loaded := Crt.load_table("")
	return {"table": loaded.value if loaded.ok else {}}
