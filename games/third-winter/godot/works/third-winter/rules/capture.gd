extends RefCounted

## TTW Scorpion 进格夺取（src/match/scorpion-capture.ts）。
## 可夺取物：敌方补给堆、空军基地、停机飞机、非战斗运输队（含 Extender）与敌方刺猬。
## 本轮范围：地面控制记录、补给堆掷骰、刺猬降级、机场易手/苏军拆跑道、运输队夺取窗口与夺取历史。
## 飞机位移、Extender 崩塌位移与运输队结算尚未实现，遇到时返回明确失败码而不是猜数值。

const Result := preload("res://scripts/core/result.gd")
const Rng := preload("res://scripts/core/rng.gd")
const ReinforcementBoard := preload("res://works/third-winter/rules/reinforcement_board.gd")

## capturePercent（packages/series/src/tables/capture.ts），按骰面前 1–6 取百分比。
const CAPTURE_PERCENT := {
	"dump": [0, 25, 25, 50, 50, 75],
	"trucks": [0, 0, 25, 50, 50, 75],
	"wagons": [0, 0, 25, 50, 75, 100],
}


## capturedAmount：按类别与骰面取可夺取数量，沿用 TS 的 Math.round（正数半值进位）。
static func captured_amount(quantity: int, category: String, die: int) -> int:
	var percents: Array = CAPTURE_PERCENT.get(category, [])
	if die < 1 or die > percents.size():
		return 0
	return int(roundf(float(quantity) * float(percents[die - 1]) / 100.0))


## airBaseCaptureLoss：骰面 +（飞机在场 2）+（战后 2）≤ 6 即损失。
static func air_base_capture_loss(die: int, active: bool, after_combat: bool) -> bool:
	return die + (2 if active else 0) + (2 if after_combat else 0) <= 6


## scorpionCaptureAt：探测目标格内属于对方、可被夺取的对象。
static func capture_at(state: Dictionary, side: String, hex_id: String) -> Dictionary:
	var owner := _opponent(side)
	var dump: Variant = state.get("dumps", {}).get("%s:hex:%s" % [owner, hex_id])
	var hedgehog: Variant = state.get("hedgehogs", {}).get(hex_id)
	if not (hedgehog is Dictionary) or str(hedgehog.get("side", "")) != owner:
		hedgehog = null
	var transports: Array = []
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if unit.get("combat") == true or str(unit.get("side", "")) != owner:
			continue
		if str(unit.get("hex", "")) == hex_id:
			transports.append(id)
	var air_base := false
	var strip: Variant = null
	for base: Dictionary in state.get("airBases", []):
		if str(base.get("side", "")) == owner and str(base.get("hex", "")) == hex_id:
			air_base = true
			strip = base.get("strip")
			break
	var aircraft: Array = []
	for piece: Dictionary in state.get("pieces", []):
		var location: Dictionary = piece.get("location", {})
		if str(piece.get("kind", "")) != "aircraft" or str(piece.get("side", "")) != owner:
			continue
		if str(location.get("kind", "")) == "hex" and str(location.get("hex", "")) == hex_id:
			aircraft.append(piece)
	return {"owner": owner, "dump": dump, "transports": transports, "hedgehog": hedgehog,
		"airBase": air_base, "airBaseStrip": strip, "aircraft": aircraft}


## resolveScorpionEntry：进入格后记录控制、结算即时夺取物，必要时挂起位移待决。
## ids 为进入格的单位；route 为后续路线（自动位移排序用，本轮只透传给等待实现的部分）。
static func resolve_entry(state: Dictionary, side: String, hex_id: String, ids: Array, data: Dictionary,
		after_combat := false, _route: Array = []) -> Dictionary:
	var next := record_control(state, side, hex_id, data)
	var objects := capture_at(next, side, hex_id)
	var dump: Variant = objects.dump
	var hedgehog: Variant = objects.hedgehog
	var transports: Array = objects.transports
	var aircraft: Array = objects.aircraft
	var has_dump: bool = dump != null and int(dump.get("tokens", 0)) > 0
	if not has_dump and not bool(objects.airBase) and aircraft.is_empty() and transports.is_empty() \
			and hedgehog == null:
		return Result.success(next)
	if next.get("capture") != null:
		return Result.failure("capture_pending", "须先结算上一次进格夺取")
	var captor := _assert_captor(next, side, ids)
	if not captor.ok:
		return captor
	for id: String in transports:
		if next.get("units", {}).get(id, {}).get("extender") is Dictionary:
			return Result.failure("capture_extender_unimplemented", "Extender 崩塌位移尚未实现")
	var range_error := _assert_air_ranges(aircraft, data)
	if not range_error.ok:
		return range_error
	var cursor := {"rng": next.get("rng", {})}
	var rolled: Variant = _roll_transports(next, transports, data, cursor)
	if rolled is Dictionary:
		return rolled
	var groups: Array = rolled
	var dumps: Dictionary = (next.get("dumps", {}) as Dictionary).duplicate(true)
	var dump_result: Variant = null
	if has_dump:
		var die: Variant = _roll(cursor)
		if die is Dictionary:
			return die
		var tokens := int(dump.get("tokens", 0))
		var taken := captured_amount(tokens, "dump", int(die))
		var owner_key := "%s:hex:%s" % [str(objects.owner), hex_id]
		dumps.erase(owner_key)
		var captor_key := "%s:hex:%s" % [side, hex_id]
		var existing: Dictionary = dumps.get(captor_key, {})
		if taken > 0:
			dumps[captor_key] = {"side": side, "location": "on-map",
				"tokens": int(existing.get("tokens", 0)) + taken}
		dump_result = {"die": int(die), "taken": taken, "destroyed": tokens - taken}
	var air_bases: Array = (next.get("airBases", []) as Array).duplicate(true)
	var airstrip_removed: Variant = null
	for index: int in air_bases.size():
		var base: Dictionary = air_bases[index]
		if str(base.get("side", "")) != str(objects.owner) or str(base.get("hex", "")) != hex_id:
			continue
		# TTW 2.2h — 苏军占领轴心机场时收走跑道算子，而不是把基地翻面归己。
		if side == "soviet" and base.get("strip") != null:
			airstrip_removed = base.get("strip")
			air_bases.remove_at(index)
		else:
			var flipped: Dictionary = base.duplicate(true)
			flipped["side"] = side
			air_bases[index] = flipped
		break
	# 停机飞机：每枚掷夺取损失骰；跑道易手后按印刷航程位移，无处可去进死人堆。
	var displaced_aircraft: Array = []
	var aircraft_report: Array = []
	var pieces: Array = (next.get("pieces", []) as Array).duplicate(true)
	if not aircraft.is_empty():
		var at_risk: Dictionary = {}
		for piece: Dictionary in aircraft:
			at_risk[str(piece.get("id", ""))] = true
		for index: int in pieces.size():
			var piece: Dictionary = pieces[index]
			var piece_id := str(piece.get("id", ""))
			if not at_risk.has(piece_id):
				continue
			var air_die: Variant = _roll(cursor)
			if air_die is Dictionary:
				return air_die
			var loss := air_base_capture_loss(int(air_die), piece.get("active") == true, after_combat)
			var reduced: bool = piece.get("reduced") == true or loss
			var destinations: Array = []
			if not (loss and piece.get("reduced") == true):
				destinations = air_destinations(piece, reduced, hex_id, air_bases, data)
			aircraft_report.append({"id": piece_id, "die": int(air_die), "loss": loss,
				"eliminated": destinations.is_empty()})
			var moved_piece: Dictionary = piece.duplicate(true)
			moved_piece["active"] = false
			moved_piece["reduced"] = reduced
			if destinations.is_empty():
				moved_piece["location"] = {"kind": "dead-pile"}
			else:
				displaced_aircraft.append({"id": piece_id, "destinations": destinations})
			pieces[index] = moved_piece
	var hedgehogs: Dictionary = (next.get("hedgehogs", {}) as Dictionary).duplicate(true)
	var hedgehog_after: Variant = null
	if hedgehog is Dictionary:
		# TTW 1.1b — 夺取立减一级，不打夺取骰，也没有应答。
		hedgehog_after = {"side": side, "level": 1} if int(hedgehog.get("level", 0)) == 2 else null
		hedgehogs[hex_id] = hedgehog_after
	var capture: Variant = null
	if not displaced_aircraft.is_empty() or not groups.is_empty():
		capture = {"hex": hex_id, "captor": side, "owner": str(objects.owner),
			"aircraft": displaced_aircraft, "transports": groups}
	var history: Array = (next.get("captureHistory", []) as Array).duplicate(true)
	var report := {"hex": hex_id, "captor": side, "aircraft": aircraft_report, "transports": groups}
	if dump_result != null:
		report["dump"] = dump_result
	if hedgehog is Dictionary:
		report["hedgehog"] = {"before": hedgehog, "after": hedgehog_after}
	if airstrip_removed != null:
		report["airstripRemoved"] = airstrip_removed
	history.append(report)
	var settled: Dictionary = next.duplicate(true)
	settled["rng"] = cursor.rng
	settled["dumps"] = dumps
	settled["airBases"] = air_bases
	settled["pieces"] = pieces
	settled["hedgehogs"] = hedgehogs
	settled["capture"] = capture
	settled["captureHistory"] = history
	return Result.success(settled)


## recordScorpionGroundControl：进入有控制规则的格时记下控制方（只增不减，换手直接改写）。
static func record_control(state: Dictionary, side: String, hex_id: String, data: Dictionary) -> Dictionary:
	var sites: Array = data.get("deployment", {}).get("controlSites", [])
	if not sites.has(hex_id):
		return state
	var control: Dictionary = state.get("railControl", {})
	if str(control.get(hex_id, "")) == side:
		return state
	var next: Dictionary = state.duplicate(true)
	var next_control: Dictionary = control.duplicate(true)
	next_control[hex_id] = side
	next["railControl"] = next_control
	return next


## settleScorpionCapture：原属方为每个受影响运输队给出「夺取/留下」配属与剩余位移格。
## 本轮实现运输队配属与整队位移；飞机与 Extender 位移仍显式拒绝，不猜数值。
static func settle(state: Dictionary, side: String, action: Dictionary, data: Dictionary) -> Dictionary:
	var capture: Variant = state.get("capture")
	if capture == null:
		return Result.failure("capture_missing", "当前没有待决的进格夺取")
	if str(capture.get("owner", "")) != side:
		return Result.failure("capture_settle_owner", "须由原属方选择位移与配属")
	var aircraft: Array = capture.get("aircraft", [])
	var chosen_aircraft: Array = action.get("aircraft", [])
	if chosen_aircraft.size() != aircraft.size():
		return Result.failure("capture_settle_aircraft", "须为每枚存活飞机各选一个合法落点")
	for entry: Dictionary in chosen_aircraft:
		var entry_id := str(entry.get("id", ""))
		var destination: Variant = entry.get("destination")
		if not (destination is Dictionary):
			return Result.failure("capture_settle_aircraft", "飞机落点须为 {kind, hex} 形状")
		var allowed: Array = []
		for pending_entry: Dictionary in aircraft:
			if str(pending_entry.get("id", "")) == entry_id:
				allowed = pending_entry.get("destinations", [])
				break
		if not _destination_allowed(allowed, destination):
			return Result.failure("capture_settle_aircraft", "飞机落点须在印刷航程内的本方基地")
	var extenders: Array = capture.get("extenders", [])
	if not extenders.is_empty():
		return Result.failure("capture_settle_extender", "Extender 崩塌位移尚不可分配")
	if not (action.get("extenders", []) as Array).is_empty():
		return Result.failure("capture_settle_choice", "该窗口没有 Extender 可分配")
	var groups: Array = capture.get("transports", [])
	var choices: Array = action.get("transports", [])
	var count := 0
	for group: Dictionary in groups:
		count += (group.get("members", []) as Array).size()
	var selected: Dictionary = {}
	for choice: Dictionary in choices:
		var id := str(choice.get("id", ""))
		if selected.has(id):
			return Result.failure("capture_settle_choice", "同一运输队不能重复分配")
		selected[id] = choice
	if choices.size() != count or selected.size() != count:
		return Result.failure("capture_settle_choice", "须为每个受影响运输队各给一份分配")
	var units: Dictionary = state.get("units", {}).duplicate(true)
	var dumps: Dictionary = state.get("dumps", {}).duplicate(true)
	var moved: Array = (state.get("moved", []) as Array).duplicate()
	var captor := str(capture.get("captor", ""))
	var owner := str(capture.get("owner", ""))
	var hex_id := str(capture.get("hex", ""))
	var history_length := (state.get("captureHistory", []) as Array).size()
	var phase := str(state.get("cursor", {}).get("phase", ""))
	var pending := {"units": units, "dumps": dumps, "moved": moved}
	for group: Dictionary in groups:
		var kind := str(group.get("kind", ""))
		var total_points := 0
		var total_tokens := 0
		for member: Dictionary in group.get("members", []):
			var member_id := str(member.get("id", ""))
			var choice: Variant = selected.get(member_id)
			if not (choice is Dictionary) or not _safe_amount(choice.get("takenPoints")) \
					or not _safe_amount(choice.get("takenTokens")):
				return Result.failure("capture_settle_choice", "夺取数量须为非负整数")
			var taken_points := int(choice.takenPoints)
			var taken_tokens := int(choice.takenTokens)
			if taken_points > int(member.get("points", 0)) or taken_tokens > int(member.get("tokens", 0)) \
					or taken_points < 0 or taken_tokens < 0:
				return Result.failure("capture_settle_choice", "夺取数量超出该运输队的点数或载货")
			total_points += taken_points
			total_tokens += taken_tokens
			var left := int(member.get("points", 0)) - taken_points
			var remaining_cargo := int(member.get("tokens", 0)) - taken_tokens
			var at := str(choice.get("displacedTo", ""))
			if (left > 0 or remaining_cargo > 0) \
					and (at == "" or not can_displace(data, kind, hex_id, at)):
				return Result.failure("capture_settle_displacement",
					"剩余运输队与载货须落在射程内的空位移格")
			var source: Dictionary = (units.get(member_id, {}) as Dictionary).duplicate(true)
			if source.is_empty():
				return Result.failure("capture_settle_choice", "受影响的运输队不在盘面上")
			units.erase(member_id)
			var placed := _place_capacity(pending, data, source, member, kind, captor, captor, owner, hex_id,
				taken_points, taken_tokens, history_length, phase)
			if not placed.ok:
				return placed
			if left > 0 or remaining_cargo > 0:
				placed = _place_capacity(pending, data, source, member, kind, owner, captor, owner, at,
					left, remaining_cargo, history_length, phase)
				if not placed.ok:
					return placed
		if total_points != int(group.get("points", 0)) or total_tokens != int(group.get("tokens", 0)):
			return Result.failure("capture_settle_choice", "须按夺取骰的总点数与总载货如数分配")
	var settled: Dictionary = state.duplicate(true)
	settled["units"] = pending.units
	settled["dumps"] = pending.dumps
	settled["moved"] = pending.moved
	settled["capture"] = null
	if not aircraft.is_empty():
		var pieces: Array = (settled.get("pieces", []) as Array).duplicate(true)
		var chosen: Dictionary = {}
		for entry: Dictionary in chosen_aircraft:
			chosen[str(entry.get("id", ""))] = entry.get("destination")
		for index: int in pieces.size():
			var piece: Dictionary = pieces[index]
			var location: Variant = chosen.get(str(piece.get("id", "")))
			if location == null:
				continue
			var displaced: Dictionary = piece.duplicate(true)
			displaced["location"] = location
			displaced["active"] = false
			pieces[index] = displaced
		settled["pieces"] = pieces
	var history: Array = settled.get("captureHistory", [])
	if history.size() > 0:
		var latest: Dictionary = (history[history.size() - 1] as Dictionary).duplicate(true)
		if not choices.is_empty():
			latest["transportAllocation"] = choices
		if not chosen_aircraft.is_empty():
			latest["displacedAircraft"] = chosen_aircraft
		history[history.size() - 1] = latest
		settled["captureHistory"] = history
	return Result.success(settled)


## canDisplaceScorpionTransport：卡车 10 格、车队 5 格以内，且不是本格。
static func can_displace(data: Dictionary, kind: String, from_hex: String, at: String) -> bool:
	var graph: Dictionary = data.get("view", {}).get("mapGraph", {})
	if not (graph.get("neighbors", {}) as Dictionary).has(at) or at == from_hex:
		return false
	var limit := 10 if kind == "trucks" else 5
	return ReinforcementBoard.hex_distance(from_hex, at) <= limit


# ── 内部实现 ──────────────────────────────────────────────────────────────


## placeCapacity：原属方整队留下时直接把算子 relocate；否则按 nation/kind 别名发一列新算子，
## 装不下的载货落成补给堆（settleScorpionTransports 口径）。
static func _place_capacity(pending: Dictionary, data: Dictionary, source: Dictionary, member: Dictionary,
		kind: String, side: String, captor: String, owner: String, at: String, points: int, tokens: int,
		history_length: int, phase: String) -> Dictionary:
	var cargo := tokens
	if points == int(member.get("points", 0)) and side == owner:
		var kept: Dictionary = source.duplicate(true)
		kept["hex"] = at
		kept.erase("reserve")
		kept["transportCargoTokens"] = mini(cargo, points * 4)
		cargo -= mini(cargo, points * 4)
		pending.units[str(member.get("id", ""))] = kept
	else:
		var alias := ("Ge " if side == "axis" else "Sov ") + ("Truck" if kind == "trucks" else "Wagon")
		var template: Variant = data.get("view", {}).get("catalog", {}).get("capturedTransports", {}).get(alias)
		if points > 0 and not (template is Dictionary):
			return Result.failure("capture_transport_counter",
				"缺少夺得的 %s 一点算子资料" % alias)
		for copy: int in range(1, points + 1):
			var id := "captured:%d:%s:%d:%s" % [history_length, side, copy, str(member.get("id", ""))]
			var unit: Dictionary = (template as Dictionary).duplicate(true)
			unit["hex"] = at
			unit["transportCargoTokens"] = mini(cargo, 4)
			cargo -= mini(cargo, 4)
			pending.units[id] = unit
			if side == captor and phase != "movement":
				pending.moved.append(id)
	if cargo > 0:
		var key := "%s:hex:%s" % [side, at]
		var dump: Dictionary = (pending.dumps.get(key, {}) as Dictionary).duplicate(true)
		dump["side"] = side
		dump["location"] = "on-map"
		dump["tokens"] = int(dump.get("tokens", 0)) + cargo
		pending.dumps[key] = dump
	return Result.success(true)


static func _safe_amount(value: Variant) -> bool:
	if value == null:
		return true
	if value is int:
		return int(value) >= 0
	if value is float:
		return float(value) == floorf(float(value)) and float(value) >= 0.0
	return false


## printedAirRange：减编用 move 面，否则用 combat 面；缺数值就明确失败而不是编造航程。
static func _assert_air_ranges(aircraft: Array, data: Dictionary) -> Dictionary:
	var definitions: Dictionary = data.get("view", {}).get("catalog", {}).get("definitions", {})
	for piece: Dictionary in aircraft:
		var definition := str(piece.get("definition", ""))
		var defn: Dictionary = definitions.get(definition, {})
		var printed: Variant = defn.get("rangeMove") if piece.get("reduced") == true else defn.get("range")
		if not (printed is int or printed is float) or float(printed) <= 0.0:
			return Result.failure("capture_aircraft_range", "缺少该机型的印刷航程：%s" % definition)
	return Result.success(true)


## airDestinations：跑道易手后本方基地中航程 2 倍以内（按六角距离）的格，外加场外机场盒。
static func air_destinations(piece: Dictionary, reduced: bool, from_hex: String, air_bases: Array,
		data: Dictionary) -> Array:
	var definitions: Dictionary = data.get("view", {}).get("catalog", {}).get("definitions", {})
	var defn: Dictionary = definitions.get(str(piece.get("definition", "")), {})
	var printed: float = float(defn.get("rangeMove") if reduced else defn.get("range"))
	var hexes: Dictionary = data.get("view", {}).get("mapGraph", {}).get("neighbors", {})
	var destinations: Array = []
	for base: Dictionary in air_bases:
		var base_hex := str(base.get("hex", ""))
		if str(base.get("side", "")) != str(piece.get("side", "")) or base_hex == from_hex:
			continue
		if not hexes.has(base_hex):
			continue
		if float(ReinforcementBoard.hex_distance(from_hex, base_hex)) <= printed * 2.0:
			destinations.append({"kind": "hex", "hex": base_hex})
	destinations.append({"kind": "off-map-air"})
	return destinations


static func _destination_allowed(allowed: Array, destination: Dictionary) -> bool:
	for entry: Dictionary in allowed:
		if str(entry.get("kind", "")) != str(destination.get("kind", "")):
			continue
		if str(entry.get("kind", "")) == "off-map-air" or str(entry.get("hex", "")) == str(destination.get("hex", "")):
			return true
	return false


static func _opponent(side: String) -> String:
	return "soviet" if side == "axis" else "axis"


## assertScorpionCaptor：格内有敌方物资/机场/刺猬时，须有一枚可进攻且非预备的进入单位。
static func _assert_captor(state: Dictionary, side: String, ids: Array) -> Dictionary:
	for id: Variant in ids:
		var unit: Dictionary = state.get("units", {}).get(str(id), {})
		if unit.is_empty() or str(unit.get("side", "")) != side:
			continue
		if unit.get("attackCapable") == true and unit.get("reserve") == null:
			return Result.success(true)
	return Result.failure("capture_attack_capable",
		"进入有敌方物资、机场或刺猬的格需要一枚可进攻的单位")


## rollScorpionTransportCapture：按卡车/车队分类各掷一枚夺取骰，返回分组窗口。
static func _roll_transports(state: Dictionary, ids: Array, data: Dictionary, cursor: Dictionary) -> Variant:
	var groups: Array = []
	if ids.is_empty():
		return groups
	var definitions: Dictionary = data.get("view", {}).get("catalog", {}).get("definitions", {})
	var members := {"trucks": [], "wagons": []}
	for id: String in ids:
		var unit: Dictionary = state.get("units", {}).get(id, {})
		var definition: Dictionary = definitions.get(str(unit.get("definition", "")), {})
		var capacity := int(definition.get("transport", 0))
		if capacity <= 0:
			return Result.failure("capture_transport_capacity",
				"运输队缺少印刷运力：%s" % str(unit.get("definition", "")))
		var kind := "trucks" if int(unit.get("allowance", 0)) > 10 else "wagons"
		var cargo := int(unit.get("transportCargoTokens", 4 if str(unit.get("organicTruck", "")) == "full" else 0))
		members[kind].append({"id": id, "points": capacity, "tokens": cargo})
	for kind: String in ["trucks", "wagons"]:
		var rows: Array = members[kind]
		if rows.is_empty():
			continue
		var die: Variant = _roll(cursor)
		if die is Dictionary:
			return die
		var points := 0
		var tokens := 0
		for row: Dictionary in rows:
			points += int(row.points)
			tokens += int(row.tokens)
		groups.append({"kind": kind, "die": int(die), "members": rows,
			"points": captured_amount(points, kind, int(die)),
			"tokens": captured_amount(tokens, kind, int(die))})
	return groups


static func _roll(cursor: Dictionary) -> Variant:
	var draw: Dictionary = Rng.roll_die(cursor.get("rng", {}))
	if not draw.get("ok", false):
		return draw
	cursor["rng"] = draw.value.rng
	return int(draw.value.value)
