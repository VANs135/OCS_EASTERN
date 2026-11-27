extends RefCounted

const CommandLog := preload("res://scripts/core/command_log.gd")
const Deployment := preload("deployment.gd")
const Reinforcement := preload("res://works/third-winter/rules/reinforcement.gd")
const GroundMove := preload("res://works/third-winter/rules/ground_move.gd")
const Result := preload("res://scripts/core/result.gd")
const Stacking := preload("res://works/third-winter/rules/stacking.gd")


static func submit(record: Dictionary, seat: String, command: Dictionary, data: Dictionary) -> Dictionary:
	return CommandLog.accept_command(record, seat, command, _apply.bind(data))


static func _apply(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
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
	if action.get("type") in ["place-arrival", "place-supply", "finish-scheduled-arrivals",
			"place-alert", "pass-alert", "complete-reinforcement"]:
		if state.kind != "playing":
			return Result.failure("match_not_started", "请先开始 08 对局")
		return Reinforcement.apply(state, actor, action, data)
	return Result.failure("unsupported_action", "该机制尚未接入原生 08 对局")
