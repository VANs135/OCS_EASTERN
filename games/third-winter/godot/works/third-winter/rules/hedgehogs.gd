extends RefCounted

## OCS v4.3 §13.8d / §16.0b–c 与 TTW §1.1b 工事（scorpion-hedgehogs.ts）。
## 规则层：工事等级取值、0–4 合法性口径、构筑/拆除条件与对战斗/炮击的影响口径。
## 不改数据、不接 UI；战斗与炮击模块各自消费本模块给出的等级与口径常量。

const Result := preload("res://scripts/core/result.gd")
const TerrainCost := preload("res://works/third-winter/rules/terrain_cost.gd")
const ReinforcementBoard := preload("res://works/third-winter/rules/reinforcement_board.gd")
const SupplyPayment := preload("res://works/third-winter/rules/sp_payment.gd")
const GroundActivity := preload("res://works/third-winter/rules/ground_activity.gd")

const MAX_LEVEL := 4
const BUILD_COST := 8


## scorpionHedgehogLevel：盘面工事等级；无盘面记录时回退 fallback（可调用），再缺省 0。
static func level(state: Dictionary, hex_id: String, fallback: Variant = null) -> int:
	var hedgehogs: Variant = state.get("hedgehogs")
	if hedgehogs != null and hedgehogs is Dictionary and hedgehogs.has(hex_id):
		var entry: Variant = hedgehogs[hex_id]
		if entry != null and entry is Dictionary:
			return int(entry.get("level", 0))
		return 0
	if fallback is Callable:
		return int(fallback.call(hex_id))
	return 0


## 战斗/炮击口径：工事等级必须是 0–4 整数（scorpion-combat.ts / scorpion-barrage.ts 校验）。
static func is_valid_level(value: Variant) -> bool:
	if not (value is int or value is float):
		return false
	var level_value: int = int(value)
	return level_value >= 0 and level_value <= MAX_LEVEL


## 战斗口径：工事等级 > 0 时守方反坦克 ≥2（scorpion-combat.ts antiTank 取值）。
static func anti_tank(level_value: int) -> int:
	return 2 if level_value > 0 else 0


## 炮击口径：工事等级 > 0 时炮击列向有利方向移 1 格（scorpion-barrage.ts hedgehog_shift）。
static func barrage_shift(level_value: int) -> float:
	return -1.0 if level_value > 0 else 0.0


## workScorpionHedgehog：构筑（build）或拆除（reduce）工事。
## action: { operation: 'build'|'reduce', hex, unitIds: string[], payments?: [{dumpId, tokens}] }。
## 返回 Result.success(state)；资格/支付/工人不合法时 Result.failure。
static func work(state: Dictionary, side: String, action: Dictionary, data: Dictionary,
		_board: Variant = null) -> Dictionary:
	var cursor: Dictionary = state.get("cursor", {})
	if str(cursor.get("phase", "")) != "movement" or str(cursor.get("phasing", "")) != side:
		return Result.failure("hedgehog_phase", "工事作业只能在本方移动阶段进行")
	var operation := str(action.get("operation", ""))
	if operation != "build" and operation != "reduce":
		return Result.failure("hedgehog_operation", "工事作业只能是构筑或拆除")
	var hex_id := _hex_id(str(action.get("hex", "")))
	var graph: Dictionary = data.get("view", {}).get("mapGraph", {})
	if not graph.get("terrains", {}).has(hex_id):
		return Result.failure("hedgehog_hex", "工事作业格不在地图上：%s" % hex_id)
	var hedgehogs: Dictionary = state.get("hedgehogs", {})
	var current: Variant = hedgehogs.get(hex_id)
	var current_level := level(state, hex_id)
	var building := operation == "build"
	if current != null and str(current.get("side", "")) != side:
		return Result.failure("hedgehog_owner", "该格工事属于另一方")
	if current == null and current_level > 0:
		return Result.failure("hedgehog_owner", "该格已有他方工事等级")
	if not building and current == null:
		return Result.failure("hedgehog_reduce", "只能拆除本方格上的工事")
	if building and current_level >= 2:
		return Result.failure("hedgehog_level", "工事等级已达上限，不能再构筑")
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if str(unit.get("side", "")) != side and str(unit.get("hex", "")) == hex_id:
			return Result.failure("hedgehog_hex", "敌方单位所在格不能作业工事")
	# 每回合每格只能以此方式变动一次等级。
	var log_key := "hedgehogBuiltAt" if building else "hedgehogReducedAt"
	var log: Dictionary = state.get(log_key, {})
	if log.get(hex_id) == cursor.get("turn"):
		return Result.failure("hedgehog_once_per_turn", "该格工事等级本回合已变动过一次")
	var unit_ids: Array = action.get("unitIds", [])
	if unit_ids.is_empty() or unit_ids.size() != _distinct(unit_ids).size():
		return Result.failure("hedgehog_workers", "须选择互不重复的作业单位")
	var workers: Array = []
	for id: String in unit_ids:
		var worker := _stationary_worker(state, side, str(id))
		if worker.is_empty():
			return Result.failure("hedgehog_workers", "工事作业须由静止的战斗模式合格单位承担")
		workers.append(worker)
	var local: bool = true
	var local_re := 0
	for worker: Dictionary in workers:
		if str(worker.get("hex", "")) != hex_id or worker.get("disorganized", false) == true:
			local = false
		local_re += int(worker.get("printedRe", 0)) - int(worker.get("stepsLost", 0))
	var eligible_local := local and local_re >= 1
	var eligible_engineer := workers.size() == 1 and _can_engineer_at(state, side,
		str(unit_ids[0]), hex_id, graph)
	if not eligible_local and not eligible_engineer:
		return Result.failure("hedgehog_workers", "须选择格内 1 RE 本地单位，或两格内的工程合格单位")
	var payments: Array = action.get("payments", [])
	var cost := BUILD_COST if building else 0
	if _total_tokens(payments) != cost:
		return Result.failure("hedgehog_cost", "工事%s须恰付 %dT" % ["构筑" if building else "拆除", cost])
	var ledger: Variant = null
	if payments.size() > 0:
		ledger = SupplyPayment.new(state, side, data)
		var spend: Dictionary = ledger.spend(payments, func(row: Dictionary) -> bool:
			var dump_id := str(row.get("dumpId", ""))
			return workers.all(func(worker: Dictionary) -> bool:
				return ledger.can_use(worker, dump_id)))
		if not spend.ok:
			return spend
	var next_level: int = 1
	if building:
		next_level = 2 if current_level == 1 else 1
	else:
		next_level = 1 if current_level == 2 else 0
	var next_state := state.duplicate(true)
	var settled_units: Dictionary = state.get("units", {})
	var settled_dumps: Dictionary = state.get("dumps", {})
	if ledger != null:
		var settled: Dictionary = ledger.settle(settled_units)
		settled_units = settled.get("units", settled_units)
		settled_dumps = settled.get("dumps", settled_dumps)
	next_state["units"] = settled_units
	next_state["dumps"] = settled_dumps
	var moved: Array = state.get("moved", []).duplicate()
	for id: String in unit_ids:
		if not moved.has(id):
			moved.append(id)
	next_state["moved"] = moved
	var next_hedgehogs: Dictionary = hedgehogs.duplicate(true)
	if next_level == 0:
		next_hedgehogs[hex_id] = null
	else:
		next_hedgehogs[hex_id] = {"side": side, "level": next_level}
	next_state["hedgehogs"] = next_hedgehogs
	var next_log: Dictionary = log.duplicate(true)
	next_log[hex_id] = cursor.get("turn")
	next_state[log_key] = next_log
	return Result.success(next_state)


## scorpionStationaryCombatWorker：战斗模式、未移动、未空运、非预备/进击的本方战斗单位。
static func _stationary_worker(state: Dictionary, side: String, id: String) -> Dictionary:
	var unit: Dictionary = state.get("units", {}).get(id, {})
	if unit.is_empty() or str(unit.get("side", "")) != side or unit.get("combat") != true:
		return {}
	if unit.get("moveMode", false) == true or unit.get("reserve") != null or unit.get("exploit", false) == true:
		return {}
	if state.get("moved", []).has(id):
		return {}
	var airlifted: Array = GroundActivity.airlifted(state)
	if airlifted.has(id):
		return {}
	return unit


## scorpionCanEngineerAt：非 Kessel 司令部、距目标 ≤2 格，且腿式可通达（直连或经一格中转）。
static func _can_engineer_at(state: Dictionary, side: String, id: String, hex_id: String,
		graph: Dictionary) -> bool:
	var worker := _stationary_worker(state, side, id)
	if worker.is_empty():
		return false
	var headquarters: Variant = worker.get("headquarters")
	if headquarters == null or (headquarters is Dictionary and headquarters.get("kessel") == true):
		return false
	if ReinforcementBoard.hex_distance(str(worker.get("hex", "")), hex_id) > 2:
		return false
	if str(worker.get("hex", "")) == hex_id:
		return true
	var weather := "freeze" if str(state.get("turn", {}).get("weather", {}).get("ground", "")) == "freeze" \
			else "dry"
	var passable := func(from: String, to: String) -> bool:
		return TerrainCost.step_cost(graph, from, to, "leg", weather) != null
	var blocked := {}
	for unit_id: String in state.get("units", {}):
		var unit: Dictionary = state.units[unit_id]
		if str(unit.get("side", "")) != side:
			blocked[str(unit.get("hex", ""))] = true
	var worker_hex := str(worker.get("hex", ""))
	if passable.call(worker_hex, hex_id):
		return true
	for near: String in graph.get("neighbors", {}).get(worker_hex, []):
		if blocked.has(near):
			continue
		if passable.call(worker_hex, near) and passable.call(near, hex_id):
			return true
	return false


static func _total_tokens(payments: Array) -> int:
	var total := 0
	for row: Dictionary in payments:
		total += int(row.get("tokens", 0))
	return total


static func _distinct(list: Array) -> Array:
	var seen := {}
	var out: Array = []
	for entry: Variant in list:
		if not seen.has(entry):
			seen[entry] = true
			out.append(entry)
	return out


static func _hex_id(source: String) -> String:
	var match := RegEx.create_from_string("^s(\\d+)\\.(\\d{1,2})$").search(source)
	if match == null:
		return source
	return "s%s.%s" % [match.get_string(1), match.get_string(2).pad_zeros(2)]
