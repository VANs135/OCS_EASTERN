extends RefCounted

## Counterpart of packages/match-core/src/command-log.ts.
## The session owns authenticated seat resolution and persistence.
## Records contain JSON-compatible data and published receipts are read-only to callers.

const Result := preload("res://scripts/core/result.gd")
const MAX_REVISION := 9007199254740991


static func create_record(state: Dictionary) -> Dictionary:
	return {"state": state.duplicate(true), "revision": 0, "receipts": []}


static func accept_command(record: Dictionary, seat: String, command: Dictionary, apply: Callable) -> Dictionary:
	var id: Variant = command.get("id")
	if not id is String or id.is_empty():
		return Result.failure("invalid_command_id", "命令 ID 无效")
	for receipt: Dictionary in record.receipts:
		if receipt.side == seat and receipt.id == id:
			return _accepted(record, receipt.revision, true)
	var expected: Variant = command.get("expectedRevision")
	if not expected is int or expected != record.revision:
		return Result.failure("stale_revision", "局面已更新，请重新选择")
	if record.revision >= MAX_REVISION:
		return Result.failure("revision_exhausted", "对局修订超出有效范围")
	var action: Variant = command.get("action")
	if not action is Dictionary:
		return Result.failure("invalid_command_action", "无法识别此操作")
	var state: Dictionary = record.state.duplicate(true)
	var outcome: Dictionary = apply.call(state, seat, action.duplicate(true))
	if not outcome.ok:
		return outcome
	var revision: int = record.revision + 1
	var receipts: Array = record.receipts.duplicate()
	receipts.append({"side": seat, "id": id, "action": action.duplicate(true), "revision": revision})
	return _accepted({"state": outcome.value, "revision": revision, "receipts": receipts}, revision, false)


static func _accepted(record: Dictionary, revision: int, duplicate: bool) -> Dictionary:
	return Result.success({"record": record, "acknowledgedRevision": revision, "duplicate": duplicate})
