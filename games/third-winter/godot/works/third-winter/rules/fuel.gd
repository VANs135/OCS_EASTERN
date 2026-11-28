extends RefCounted

## OCS 12.5c — the single-counter fuel throw of `fuelScorpionMovement`.
## 只有「战斗面 + 非腿机动 + 未加油」的算子才需要为一次移动付 1T；付过就把它标成 fueled，
## 阶段/补给/回合收尾处已经各自清标记（phase_flow / round / supply_phase）。
## 批量加油（`fuel-formation` / `fuel-headquarters`）与「已加油司令部投送」还没移植：
## 前者要编队标记与共用抽源，后者要 `headquartersFuel` 的 throw 锁源。

const Result := preload("res://scripts/core/result.gd")
const SpPayment := preload("res://works/third-winter/rules/sp_payment.gd")

const SINGLE_UNIT_FUEL_COST := 1


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


## 与 TS `hasScorpionBulkFuel` 对应：批量油标记覆盖的算子不必再逐枚付油。
static func has_bulk_fuel(state: Dictionary, unit_id: String) -> bool:
	for fuel: Dictionary in state.get("formationFuel", []):
		if (fuel.get("recipients", []) as Array).has(unit_id):
			return true
	for marker: Dictionary in state.get("headquartersFuel", []):
		if str(marker.get("id", "")) == unit_id:
			return true
	return false
