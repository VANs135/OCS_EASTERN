extends RefCounted

## OCS v4.3 §9.5b / §12.10h 战斗补给支付（src/match/scorpion-combat-supply.ts）。
## 攻方在宣告时按存活步数付 token；守方整堆只付一次（≤1 RE 付 1T，否则 2T），
## 或由参战单位自身内部库存消耗。本模块只做支付口径，不触碰状态机步骤。

const Result := preload("res://scripts/core/result.gd")
const StepLoss := preload("res://scripts/rules/series/step_loss.gd")


## 攻方支付：每枚攻方单位要么付足存活步数的 token，要么走自身内部库存。
## ledger 为 sp_payment.gd 的账面实例；返回 Result.success({ units }) 或失败回执。
static func attack_with_supply(state: Dictionary, ledger: RefCounted, attackers: Array,
		payments: Array, internal: Array) -> Dictionary:
	var participants_check := _require_participants(attackers, internal)
	if not participants_check.ok:
		return participants_check
	var totals := {}
	var spend: Dictionary = ledger.spend(payments, func(payment: Dictionary) -> bool:
		var unit_id := str(payment.get("unitId", ""))
		if not attackers.has(unit_id) or internal.has(unit_id):
			return false
		var unit: Dictionary = state.get("units", {}).get(unit_id, {})
		return ledger.can_use(unit, str(payment.get("dumpId", ""))))
	if not spend.ok:
		return spend
	for row: Dictionary in payments:
		var unit_id := str(row.get("unitId", ""))
		totals[unit_id] = int(totals.get(unit_id, 0)) + int(row.get("tokens", 0))
	var units: Dictionary = state.get("units", {}).duplicate(true)
	var waste := {}
	for id: String in attackers:
		var unit: Dictionary = units.get(id, {})
		if unit.is_empty():
			return Result.failure("supply_attacker_unit", "攻方算子不在盘面：%s" % id)
		var cost: int = StepLoss.remaining(unit)
		if internal.has(id):
			var drawn := _draw_internal(unit, cost, ledger, waste)
			if not drawn.ok:
				return drawn
			units[id] = drawn.value
		elif int(totals.get(id, 0)) != cost:
			return Result.failure("supply_attacker_payment",
				"每枚攻方单位须按存活步数付 1 token，或使用自身内部库存")
	var waste_rows: Array = waste.values()
	var waste_spend: Dictionary = ledger.spend(waste_rows, func(_row: Dictionary) -> bool: return true)
	if not waste_spend.ok:
		return waste_spend
	return Result.success({"units": units})


## 守方支付：on-map 补给堆按整堆价格一次付清；无堆支付时只能走内部库存（未付补给）。
## 返回 Result.success({ units, supplied })。
static func defend_with_supply(state: Dictionary, ledger: RefCounted, defenders: Array,
		payments: Array, internal: Array) -> Dictionary:
	var participants_check := _require_participants(defenders, internal)
	if not participants_check.ok:
		return participants_check
	var stack: Array = []
	for id: String in defenders:
		var unit: Dictionary = state.get("units", {}).get(id, {})
		if unit.is_empty():
			return Result.failure("supply_defender_unit", "守方算子不在盘面：%s" % id)
		stack.append(unit)
	var cost: int = _defensive_cost(stack)
	if payments.size() > 0:
		if _total_tokens(payments) != cost or internal.size() > 0:
			return Result.failure("supply_defender_payment", "守方整堆须以盘上补给一次付清")
		var coverage := {}
		var spend: Dictionary = ledger.spend(payments, func(payment: Dictionary) -> bool:
			var dump_id := str(payment.get("dumpId", ""))
			var reached: Array = []
			for unit: Dictionary in stack:
				if ledger.can_use(unit, dump_id):
					reached.append(unit)
			for unit: Dictionary in reached:
				coverage[unit] = int(coverage.get(unit, 0)) + int(payment.get("tokens", 0))
			return reached.size() > 0)
		if not spend.ok:
			return spend
		for unit: Dictionary in stack:
			var unit_cost: int = _defensive_cost([unit])
			if int(coverage.get(unit, 0)) < unit_cost:
				return Result.failure("supply_defender_coverage",
					"每枚守方单位须能领到其所需的盘上战斗补给")
		return Result.success({"units": state.get("units", {}), "supplied": true})
	var units: Dictionary = state.get("units", {}).duplicate(true)
	var waste := {}
	for id: String in internal:
		var drawn := _draw_internal(units[id], cost, ledger, waste)
		if not drawn.ok:
			return drawn
		units[id] = drawn.value
	var waste_rows: Array = waste.values()
	var waste_spend: Dictionary = ledger.spend(waste_rows, func(_row: Dictionary) -> bool: return true)
	if not waste_spend.ok:
		return waste_spend
	return Result.success({"units": units, "supplied": false})


## OCS v4.3 §12.4 防御战斗补给：整堆 ≤1 RE 付 1T，否则 2T；每堆只付一次。
static func defensive_supply_cost(units: Array) -> int:
	var total_re := 0
	for unit: Dictionary in units:
		total_re += int(unit.get("printedRe", 0)) - int(unit.get("stepsLost", 0))
	return 1 if total_re <= 1 else 2


static func total_tokens(payments: Array) -> int:
	return _total_tokens(payments)


static func _total_tokens(payments: Array) -> int:
	var total := 0
	for row: Dictionary in payments:
		total += int(row.get("tokens", 0))
	return total


static func _defensive_cost(units: Array) -> int:
	return defensive_supply_cost(units)


## 内部库存只属于参战者本人；名单不得重复。
static func _require_participants(participants: Array, internal: Array) -> Dictionary:
	var seen := {}
	for id: String in internal:
		if seen.has(id):
			return Result.failure("supply_internal_duplicate", "内部库存名单重复：%s" % id)
		seen[id] = true
		if not participants.has(id):
			return Result.failure("supply_internal_participant", "内部库存只能属于参战者本人：%s" % id)
	return Result.success({})


## 消耗内部库存：尚有盘上可取补给时不允许走库存；库存等级 low → exhausted，exhausted 不可再用。
static func _draw_internal(unit: Dictionary, cost: int, ledger: RefCounted, waste: Dictionary) -> Dictionary:
	var available: Array = ledger.available([unit], false)
	if _total_tokens(available) >= cost:
		return Result.failure("supply_internal_obtainable", "该单位可领到所需的盘上战斗补给")
	var level: Variant = unit.get("internalStocks")
	if str(level) == "exhausted":
		return Result.failure("internal_stocks_exhausted", "该单位内部库存已耗尽")
	var next_level: String = "exhausted" if str(level) == "low" else "low"
	if int(unit.get("printedRe", 0)) > 1:
		for payment: Dictionary in available:
			waste[str(payment.get("dumpId", ""))] = payment
	var next: Dictionary = unit.duplicate(true)
	next["internalStocks"] = next_level
	return Result.success(next)
