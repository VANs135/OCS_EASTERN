extends RefCounted

## OCS 12.5c — the single-counter fuel throw of `fuelScorpionMovement`.
## 只有「战斗面 + 非腿机动 + 未加油」的算子才需要为一次移动付 1T；付过就把它标成 fueled，
## 阶段/补给/回合收尾处已经各自清标记（phase_flow / round / supply_phase）。
## 批量加油（`fuel-formation` / `fuel-headquarters`）与「已加油司令部投送」还没移植：
## 前者要编队标记与共用抽源，后者要 `headquartersFuel` 的 throw 锁源。

const Result := preload("res://scripts/core/result.gd")
const SpPayment := preload("res://works/third-winter/rules/sp_payment.gd")

const SINGLE_UNIT_FUEL_COST := 1
const BULK_FUEL_COST := 4


## 这枚算子是否必须先加油才能用机械面移动（`needsFuel`）。
static func needs_fuel(unit: Dictionary, side: String) -> bool:
	return unit.get("combat") == true and str(unit.get("side", "")) == side \
		and str(unit.get("mobility", "")) != "leg" and unit.get("fueled") != true


## 单枚加油：`dumpId` 必须能追到且在该算子的抽取范围内；付 1T 后把 `fueled` 置真。
static func fuel_with_dump(state: Dictionary, side: String, unit_id: String, dump_id: String,
		data: Dictionary) -> Dictionary:
	if state.get("kind") != "playing":
		return Result.failure("match_not_started", "请先开始 08 对局")
	var unit: Dictionary = state.get("units", {}).get(unit_id, {})
	if unit.is_empty() or str(unit.get("side", "")) != side:
		return Result.failure("fuel_unit", "请选择本方的地面算子")
	if not needs_fuel(unit, side):
		return Result.failure("fuel_not_needed", "这枚算子不需要付油")
	if dump_id.is_empty():
		return Result.failure("fuel_source", "请选择可追溯的补给来源")
	var ledger := SpPayment.new(state, side, data)
	if not ledger.can_use(unit, dump_id):
		return Result.failure("fuel_source_range", "所选油源不在抽取或投送范围")
	var spent := ledger.spend([{"dumpId": dump_id, "tokens": SINGLE_UNIT_FUEL_COST}], func(_row: Dictionary) -> bool:
		return true)
	if not spent.ok:
		return spent
	var settled: Dictionary = ledger.settle(state.get("units", {}))
	state.units = settled.units
	state.dumps = settled.dumps
	state.units[unit_id].fueled = true
	return Result.success(state)


## OCS 12.5c(C) — 用当前暂驻停下的运输队给一枚算子付 1T（TS `fuel-from-paused-transport`）。
## 只有 `groundActivity.transport` 正停在这支运输队时才认；油源资格仍交给同一本账。
static func fuel_from_transport(state: Dictionary, side: String, unit_id: String, transport_id: String,
		data: Dictionary) -> Dictionary:
	if state.get("kind") != "playing":
		return Result.failure("match_not_started", "请先开始 08 对局")
	var paused: Variant = state.get("groundActivity", {}).get("transport")
	if paused == null or not paused is Dictionary \
			or str((paused as Dictionary).get("unitId", "")) != transport_id:
		return Result.failure("fuel_transport_paused", "请选择当前暂驻停下的运输队")
	var transport: Dictionary = state.get("units", {}).get(transport_id, {})
	if transport.is_empty() or str(transport.get("side", "")) != side:
		return Result.failure("fuel_transport_paused", "请选择本方的暂驻运输队")
	if transport.get("combat") == true or transport.get("extender") != null:
		return Result.failure("fuel_source", "该算子不是可装载的运输队")
	return fuel_with_dump(state, side, unit_id, transport_id, data)


## OCS 12.5c(A–B) — 批量油只能在现行动作序列的移动段买：本方玩家回合、移动/反应/进击段、
## 地面非解冻、没有在结算的战斗或正规炮击（TS `buyScorpionFuel` 的窗口条件）。
static func bulk_window(state: Dictionary, side: String) -> bool:
	if str(state.get("kind", "")) != "playing":
		return false
	var cursor: Dictionary = state.get("cursor", {})
	if str(state.get("turn", {}).get("step", {}).get("kind", "")) != "player-turn":
		return false
	var acting := str(cursor.get("phasing", ""))
	if str(cursor.get("phase", "")) == "reaction":
		acting = "soviet" if acting == "axis" else "axis"
	if acting != side:
		return false
	if state.get("combat") != null:
		return false
	var phase := str(cursor.get("phase", ""))
	if not ["movement", "reaction", "exploitation"].has(phase):
		return false
	if str(state.get("turn", {}).get("weather", {}).get("ground", "")) == "thaw":
		return false
	if state.get("barrage") != null:
		return false
	if phase == "exploitation" and (state.get("combatTargets", []) as Array).size() > 0:
		return false
	return true


## `fuel-formation`：付 1 SP（4T），给整编队盖批量油标记，覆盖仍在场的编队成员。
static func buy_formation_fuel(state: Dictionary, side: String, formation: String, headquarters_id: String,
		payments: Array, data: Dictionary) -> Dictionary:
	if not bulk_window(state, side):
		return Result.failure("fuel_window", "批量油只能在并非解冻的移动段购买")
	if _total_tokens(payments) != BULK_FUEL_COST:
		return Result.failure("fuel_bulk_cost", "批量油需要支付 4T")
	if formation.is_empty():
		return Result.failure("fuel_formation", "请选择编队")
	var marker := {"side": side, "formation": formation, "recipients": []}
	for fuel: Variant in state.get("formationFuel", []):
		if str((fuel as Dictionary).get("formation", "")) == formation \
				and str((fuel as Dictionary).get("side", "")) == side:
			return Result.failure("fuel_formation_active", "该编队已有批量油标记")
	if not headquarters_id.is_empty():
		var hq: Dictionary = state.get("units", {}).get(headquarters_id, {})
		if hq.is_empty() or hq.get("headquarters") != true or str(hq.get("side", "")) != side:
			return Result.failure("fuel_headquarters", "请选择本方的司令部")
	elif _distinct_sources(payments) != 1:
		return Result.failure("fuel_formation_source", "编队批量油要么单一直接抽源，要么由一支司令部投送")
	var ledger := SpPayment.new(state, side, data)
	var method := {} if headquarters_id.is_empty() else {"headquartersId": headquarters_id}
	var recipients: Array = []
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if unit.get("combat") != true or str(unit.get("side", "")) != side \
				or str(unit.get("formation", "")) != formation:
			continue
		var ok := true
		for payment: Dictionary in payments:
			if not ledger.can_use(unit, str(payment.get("dumpId", "")), method):
				ok = false
				break
		if ok:
			recipients.append(id)
	if recipients.is_empty():
		return Result.failure("fuel_recipients", "该编队没有成员能从这些来源取油")
	var spent := ledger.spend(payments, func(_row: Dictionary) -> bool: return true)
	if not spent.ok:
		return spent
	var settled: Dictionary = ledger.settle(state.get("units", {}))
	state.units = settled.units
	state.dumps = settled.dumps
	marker["recipients"] = recipients
	var markers: Array = (state.get("formationFuel", []) as Array).duplicate()
	markers.append(marker)
	state["formationFuel"] = markers
	return Result.success(state)


## `fuel-headquarters`：付 1 SP 给一支未投送过的本方司令部盖批量油标记。
static func buy_headquarters_fuel(state: Dictionary, side: String, headquarters_id: String,
		payments: Array, data: Dictionary) -> Dictionary:
	if not bulk_window(state, side):
		return Result.failure("fuel_window", "批量油只能在并非解冻的移动段购买")
	if _total_tokens(payments) != BULK_FUEL_COST:
		return Result.failure("fuel_bulk_cost", "批量油需要支付 4T")
	var hq: Dictionary = state.get("units", {}).get(headquarters_id, {})
	if hq.is_empty() or hq.get("headquarters") != true or str(hq.get("side", "")) != side:
		return Result.failure("fuel_headquarters", "请选择本方的司令部")
	for marker: Variant in state.get("headquartersFuel", []):
		if str((marker as Dictionary).get("id", "")) == headquarters_id:
			return Result.failure("fuel_headquarters_active", "这支司令部已有批量油标记")
	var ledger := SpPayment.new(state, side, data)
	var spent := ledger.spend(payments, func(row: Dictionary) -> bool: return ledger.can_use(hq, str(row.get("dumpId", ""))))
	if not spent.ok:
		return spent
	var settled: Dictionary = ledger.settle(state.get("units", {}))
	state.units = settled.units
	state.dumps = settled.dumps
	var markers: Array = (state.get("headquartersFuel", []) as Array).duplicate()
	markers.append({"side": side, "id": headquarters_id})
	state["headquartersFuel"] = markers
	return Result.success(state)


static func _total_tokens(payments: Array) -> int:
	var total := 0
	for payment: Dictionary in payments:
		total += int(payment.get("tokens", 0))
	return total


static func _distinct_sources(payments: Array) -> int:
	var seen := {}
	for payment: Dictionary in payments:
		seen[str(payment.get("dumpId", ""))] = true
	return seen.size()


## 与 TS `hasScorpionBulkFuel` 对应：批量油标记覆盖的算子不必再逐枚付油。
static func has_bulk_fuel(state: Dictionary, unit_id: String) -> bool:
	for fuel: Dictionary in state.get("formationFuel", []):
		if (fuel.get("recipients", []) as Array).has(unit_id):
			return true
	for marker: Dictionary in state.get("headquartersFuel", []):
		if str(marker.get("id", "")) == unit_id:
			return true
	return false
