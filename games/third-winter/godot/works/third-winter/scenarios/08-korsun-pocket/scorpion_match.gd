extends RefCounted

const CommandLog := preload("res://scripts/core/command_log.gd")
const Deployment := preload("deployment.gd")
const Result := preload("res://scripts/core/result.gd")


static func submit(record: Dictionary, seat: String, command: Dictionary, data: Dictionary) -> Dictionary:
	return CommandLog.accept_command(record, seat, command, _apply.bind(data))


static func _apply(state: Dictionary, actor: String, action: Dictionary, data: Dictionary) -> Dictionary:
	if action.get("type") in ["base-aircraft", "place-setup-alert", "choose-setup-loss", "confirm-setup"]:
		if not data.has("deployment"):
			return Result.failure("deployment_data_unavailable", "请重新生成包含部署数据的 08 数据包")
		return Deployment.apply_action(state, actor, action, data)
	return Result.failure("unsupported_action", "该机制尚未接入原生 08 对局")
