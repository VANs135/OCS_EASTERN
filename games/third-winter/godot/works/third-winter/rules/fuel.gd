extends RefCounted

## OCS 12.5c — the single-counter fuel throw of `fuelScorpionMovement`.
## 只有「战斗面 + 非腿机动 + 未加油」的算子才需要为一次移动付 1T；付过就把它标成 fueled，
## 阶段/补给/回合收尾处已经各自清标记（phase_flow / round / supply_phase）。
## 批量加油（`fuel-formation` / `fuel-headquarters`，4T）与「已加油司令部投送」都在本文件：
## 买标记时付费，投送时只查投程并把 `headquartersFuel` 的「本阶段从哪格投」锁上。

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


## OCS 12.5c(C) — 只有无编队且印值 `printedRe <= 1` 的算子算独立单位（TS `isIndependent`）。
## 缺 `printedRe` 的数据不放行：TS 里 `undefined <= 1` 为假，这里同样按“不独立”处理。
static func is_independent(unit: Dictionary) -> bool:
	if not str(unit.get("formation", "")).is_empty():
		return false
	var printed: Variant = unit.get("printedRe")
	return (printed is int or printed is float) and int(printed) <= 1


static func _is_headquarter(unit: Dictionary) -> bool:
	var flag: Variant = unit.get("headquarters")
	return flag is Dictionary or (flag is bool and flag == true)


## OCS 12.5c(C) — 已加油司令部把油投给范围内的独立单位（`fuelScorpionMovement` 的 HQ 分支）。
## 4T 早在买标记时付过，这里只记「本阶段从哪格投过」的锁：同一阶段换了格子就不能再投。
static func fuel_with_headquarters(state: Dictionary, side: String, unit_id: String, headquarters_id: String,
		data: Dictionary) -> Dictionary:
	if state.get("kind") != "playing":
		return Result.failure("match_not_started", "请先开始 08 对局")
	var unit: Dictionary = state.get("units", {}).get(unit_id, {})
	if unit.is_empty() or str(unit.get("side", "")) != side:
		return Result.failure("fuel_unit", "请选择本方的地面算子")
	if not needs_fuel(unit, side) or has_bulk_fuel(state, unit_id):
		return Result.failure("fuel_not_needed", "这枚算子不需要付油")
	if not is_independent(unit):
		return Result.failure("fuel_independent", "只有独立单位能接受司令部投送")
	var hq: Dictionary = state.get("units", {}).get(headquarters_id, {})
	if hq.is_empty() or not _is_headquarter(hq) or str(hq.get("side", "")) != side:
		return Result.failure("fuel_headquarters", "请选择本方的司令部")
	var marker := {}
	for fuel: Variant in state.get("headquartersFuel", []):
		var row: Dictionary = fuel
		if str(row.get("id", "")) == headquarters_id and str(row.get("side", "")) == side:
			marker = row
	if marker.is_empty():
		return Result.failure("fuel_headquarters_unfueled", "这支司令部还没有批量油标记")
	var used: Variant = marker.get("used")
	if used != null and used is Dictionary:
		var cursor: Dictionary = state.get("cursor", {})
		var same_phase := int((used as Dictionary).get("turn", -1)) == int(cursor.get("turn", -2)) \
			and str((used as Dictionary).get("phasing", "")) == str(cursor.get("phasing", "")) \
			and str((used as Dictionary).get("phase", "")) == str(cursor.get("phase", ""))
		if same_phase and str((used as Dictionary).get("hex", "")) != str(hq.get("hex", "")):
			return Result.failure("fuel_headquarters_phase", "这支司令部本阶段已从另一格投过油")
	var ledger := SpPayment.new(state, side, data)
	if not ledger.in_throw_range(headquarters_id, str(unit.get("hex", ""))):
		return Result.failure("fuel_headquarters_range", "该独立单位不在司令部投送范围内")
	var markers: Array = []
	for fuel: Variant in state.get("headquartersFuel", []):
		var row: Dictionary = fuel
		if str(row.get("id", "")) == headquarters_id and str(row.get("side", "")) == side:
			var next: Dictionary = row.duplicate(true)
			var cursor: Dictionary = state.get("cursor", {})
			next["used"] = {"turn": int(cursor.get("turn", 0)), "phasing": str(cursor.get("phasing", "")),
				"phase": str(cursor.get("phase", "")), "hex": str(hq.get("hex", ""))}
			markers.append(next)
		else:
			markers.append(row)
	state["headquartersFuel"] = markers
	var moved: Dictionary = state.units[unit_id]
	moved["fueled"] = true
	state.units[unit_id] = moved
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
		if hq.is_empty() or not _is_headquarter(hq) or str(hq.get("side", "")) != side:
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
	if hq.is_empty() or not _is_headquarter(hq) or str(hq.get("side", "")) != side:
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
