extends RefCounted

## GDScript counterpart of desktop/local/actions.mjs and src/view/scorpion-map-counters.ts.
## Native projection for the printed 08 opening: roster, legal setup actions and the map stacks.
## Only the setup phase is projected here; later phases are added with their own mechanisms.

const HexLayout := preload("res://scripts/view/hex_layout.gd")

const SIDE_NAMES := {"axis": "轴心", "soviet": "苏军"}
const PHASE_NAMES := {
	"aircraft-refit": "飞机整备", "reinforcement": "增援", "movement": "移动", "supply": "补给",
	"reaction": "反应", "combat": "战斗", "exploitation": "进击", "cleanup": "清理",
}


static func side_name(side: String) -> String:
	return SIDE_NAMES.get(side, side)


static func decision_side(state: Dictionary) -> String:
	if state.kind == "setup":
		return state.opening.seat
	return state.cursor.phasing


## TTW S08 pp.53–56 — printing order of the setup roster: deployable counters, aircraft, placed counters.
static func roster(state: Dictionary, side: String, data: Dictionary) -> Array:
	var opening: Dictionary = state.opening
	var units: Dictionary = opening.units
	var air: Array = []
	for piece: Dictionary in opening.pieces:
		if piece.side == side and piece.kind == "aircraft" and piece.location.kind != "dead-pile":
			air.append(piece)
	air = _stable_sort(air, func(left: Dictionary, right: Dictionary) -> bool:
		return int(left.location.kind != "air-setup") < int(right.location.kind != "air-setup"))
	var counters: Array = []
	if side == "axis":
		var drawn: Array = _stable_sort(opening.drawnAlerts,
			func(left: Dictionary, right: Dictionary) -> bool:
				return int(units.has(left.id)) < int(units.has(right.id)))
		for counter: Dictionary in drawn:
			counters.append(_counter_entry(counter.id, counter.definition, units.get(counter.id, {}).get("hex"), "警戒营", data))
	else:
		for choice: Dictionary in opening.lossChoices:
			for candidate: String in choice.candidates:
				counters.append(_counter_entry(candidate, units[candidate].definition, units[candidate].hex,
					"已选步损" if choice.get("selected") == candidate else "二选一步损", data))
	var entries: Array = []
	if side == "axis":
		for entry: Dictionary in counters:
			if not units.has(entry.id):
				entries.append(entry)
	for piece: Dictionary in air:
		var hex: Variant = piece.location.get("hex")
		var detail: Variant = "待部署" if piece.location.kind == "air-setup" else (hex if hex != null else "地图外空军盒")
		entries.append(_counter_entry(piece.id, piece.definition, hex, detail, data))
	for entry: Dictionary in counters:
		if side != "axis" or units.has(entry.id):
			entries.append(entry)
	return entries


static func _counter_entry(id: String, definition: String, hex: Variant, detail: Variant, data: Dictionary) -> Dictionary:
	var name: String = _definition(data, definition).get("name", id)
	var label := name if detail == null or str(detail).is_empty() else "%s · %s" % [name, detail]
	var entry := {"id": id, "label": label}
	if hex != null:
		entry.hex = hex
	return entry


## Legal setup commands, in the printed order the desktop menu shows them.
static func choices(state: Dictionary, side: String, selection: Dictionary, data: Dictionary) -> Array:
	var choices: Array = []
	var opening: Dictionary = state.opening
	var unit_id: Variant = selection.get("unitId")
	var hex: Variant = selection.get("hex")
	var waiting: Array = []
	for piece: Dictionary in opening.pieces:
		if piece.side == side and piece.location.kind == "air-setup":
			waiting.append(piece)
	var aircraft: Dictionary = {}
	for piece: Dictionary in opening.pieces:
		if piece.id == unit_id and piece.side == side and piece.kind == "aircraft" and piece.location.kind != "dead-pile":
			aircraft = piece
			break
	var base: Dictionary = {}
	for airbase: Dictionary in data.deployment.airBases:
		if airbase.side == side:
			base = airbase
			break
	if not aircraft.is_empty():
		var parked := 0
		for piece: Dictionary in opening.pieces:
			if piece.id != unit_id and piece.location.kind == "hex" and piece.location.hex == base.hex:
				parked += 1
		# TTW S08 p.53 — an aircraft placed on the map occupies an active slot at its base.
		if aircraft.location.get("hex") != base.hex and parked < int(base.level) + 4:
			_choice(choices, "部署到机场 %s" % base.hex,
				[{"type": "base-aircraft", "id": unit_id, "base": {"kind": "hex", "hex": base.hex}}])
		if aircraft.location.kind != "off-map-air":
			_choice(choices, "部署到地图外空军盒",
				[{"type": "base-aircraft", "id": unit_id, "base": {"kind": "off-map-air"}}])
	if waiting.size() > 1:
		var batch: Array = []
		for piece: Dictionary in waiting:
			batch.append({"type": "base-aircraft", "id": piece.id, "base": {"kind": "off-map-air"}})
		_choice(choices, "将剩余 %d 架飞机部署到空军盒" % waiting.size(), batch)
	var alerts: Array = []
	var losses: Array = []
	if side == "axis":
		for counter: Dictionary in opening.drawnAlerts:
			if not opening.units.has(counter.id):
				alerts.append(counter)
	else:
		for choice: Dictionary in opening.lossChoices:
			if not choice.get("selected") is String or choice.selected.is_empty():
				losses.append(choice)
	var alert: Dictionary = {}
	for counter: Dictionary in opening.drawnAlerts:
		if counter.id == unit_id:
			alert = counter
			break
	if side == "axis" and not alert.is_empty():
		# TTW S08 pp.54–55 — the Alert counter joins a printed Axis ground stack within 10 RE.
		var re: float = _definition(data, alert.definition).get("re", 0)
		var destinations: Array = []
		for id: String in opening.units:
			var unit: Dictionary = opening.units[id]
			if not id.begins_with("setup:") or unit.side != side:
				continue
			if not destinations.has(unit.hex):
				destinations.append(unit.hex)
		var legal: Array = []
		for at: String in destinations:
			var total: float = re
			for id: String in opening.units:
				var unit: Dictionary = opening.units[id]
				if id != unit_id and unit.hex == at:
					total += unit.printedRe - unit.stepsLost
			if total <= 10.0:
				legal.append(at)
		var shown: Array = [hex] if legal.has(hex) else legal.slice(0, 4)
		for at: String in shown:
			_choice(choices, "警戒营部署到 %s" % at, [{"type": "place-setup-alert", "id": unit_id, "hex": at}])
	var pairs: Array = []
	if unit_id != null:
		for choice: Dictionary in losses:
			if choice.candidates.has(unit_id):
				pairs.append(choice)
	if pairs.is_empty():
		pairs = losses.slice(0, 1)
	for choice: Dictionary in pairs:
		for candidate: String in choice.candidates:
			var unit: Dictionary = opening.units[candidate]
			_choice(choices, "%s 损失 %d 步" % [_definition(data, unit.definition).get("name", candidate), choice.stepsLost],
				[{"type": "choose-setup-loss", "id": candidate}])
	if waiting.is_empty() and alerts.is_empty() and losses.is_empty():
		_choice(choices, "确认本方部署", [{"type": "confirm-setup"}])
	return choices


static func _choice(choices: Array, label: String, actions: Array) -> void:
	choices.append({"label": label, "actions": actions})


## Projection consumed by the map and the sidebar. Frame boxes, auxiliary cards and the turn track
## are still served by the TypeScript bridge and are not produced here yet.
static func project(record: Dictionary, selection: Dictionary, data: Dictionary, viewer: String = "axis") -> Dictionary:
	var state: Dictionary = record.state
	if state.kind != "setup":
		return {}
	var opening: Dictionary = state.opening
	var actor: String = opening.seat
	var revision: int = record.revision
	var entries := roster(state, actor, data)
	var selected: Dictionary = {}
	for entry: Dictionary in entries:
		if entry.id == selection.get("unitId"):
			selected = entry
			break
	if selected.is_empty() and not selection.has("unitIds") and not entries.is_empty():
		selected = entries[0]
	var unit_id: Variant = selected.get("id") if not selected.is_empty() else null
	var picked_hex: Variant = selection.get("hex") if selection.has("hex") else selected.get("hex")
	var unit_ids: Array = []
	if selection.has("unitIds"):
		for id: Variant in selection.unitIds:
			if _roster_has(entries, id):
				unit_ids.append(id)
	elif unit_id != null:
		unit_ids.append(unit_id)
	var picked := {"unitId": unit_id, "unitIds": unit_ids,
		"hex": selection.get("hex") if selection.has("hex") and selection.get("hex") != null else selected.get("hex")}
	var legal := choices(state, actor, picked, data)
	var actions: Array = []
	for choice: Dictionary in legal:
		var action: Dictionary = choice.actions[0]
		if unit_ids.size() >= 2 and action.type == "ground-move":
			continue
		actions.append({
			"key": "action:%d:%d" % [revision, actions.size()],
			"label": choice.label,
			"kind": "command",
			"actionTypes": choice.actions.map(func(step: Dictionary) -> String: return step.type),
		})
	var stacks := map_stacks(state, data)
	var frame := {
		"trackers": trackers(data), "inventories": inventories(state, data, viewer),
		"aidCounters": aid_counters(data), "auxiliaryCards": auxiliary_cards(state, data, viewer),
		"mapStacks": stacks, "selectedUnits": unit_ids, "targets": [], "route": [],
	}
	# The placeable counter has no printed hex, so the marker is absent rather than null.
	if picked_hex != null:
		var layout := HexLayout.layout(str(picked_hex))
		if not layout.is_empty():
			frame.selectedHex = layout
	var view := {
		"protocolVersion": 1, "revision": revision, "actor": actor,
		"headline": "%s · 开局部署" % side_name(actor),
		"phase": "开局部署", "phaseId": "setup",
		"roster": entries, "stack": _stack(selection, stacks, entries), "stacking": [],
		"unitId": unit_id, "unitIds": unit_ids, "hex": picked_hex, "route": [],
		"actions": actions, "menu": [], "ended": false,
		"transportStock": transport_stock(opening.units, viewer, data),
		"breakdownStock": breakdown_stock(opening.units, state.get("pieces", []), data),
		"frame": frame,
	}
	return view


static func _roster_has(entries: Array, id: Variant) -> bool:
	for entry: Dictionary in entries:
		if entry.id == id:
			return true
	return false


## Counters under the clicked hex, limited to the observing side's roster like the desktop sidebar.
static func _stack(selection: Dictionary, stacks: Array, entries: Array) -> Array:
	if not selection.has("stackHex") or selection.stackHex == null:
		return []
	var stack: Dictionary = {}
	for candidate: Dictionary in stacks:
		if candidate.hex == selection.stackHex:
			stack = candidate
			break
	if stack.is_empty():
		return []
	var counters: Array = []
	for page: Array in stack.pages:
		counters.append_array(page)
	var result: Array = []
	for counter: Dictionary in counters:
		if _roster_has(entries, counter.id):
			result.append(counter)
	return result


## Map counters in the printed draw order: ground units, aircraft, airbase strengths, supply dumps.
static func map_stacks(state: Dictionary, data: Dictionary) -> Array:
	var opening: Dictionary = state.opening
	var stacks: Dictionary = {}
	var order: Array = []
	var push := func(counter: Dictionary) -> void:
		var hex: String = counter.hex
		if not stacks.has(hex):
			stacks[hex] = []
			order.append(hex)
		stacks[hex].append(counter)
	var marked_reserves: Dictionary = {}
	for id: String in opening.units:
		var unit: Dictionary = opening.units[id]
		var definition := _definition(data, unit.definition)
		var asset: Variant = definition.get("faces", {}).get("combat")
		var label: String = definition.get("name", id)
		var show_reserve: bool = unit.get("reserve", false) == true and not marked_reserves.has("%s:%s" % [unit.side, unit.hex])
		if show_reserve:
			marked_reserves["%s:%s" % [unit.side, unit.hex]] = true
		var counter := {"id": id, "hex": unit.hex, "asset": asset, "label": label,
			"badges": _ground_badges(unit, data, show_reserve)}
		push.call(counter)
	for piece: Dictionary in opening.pieces:
		if piece.kind != "aircraft" or piece.location.kind != "hex":
			continue
		var definition := _definition(data, piece.definition)
		var face: Variant = definition.get("faces", {}).get("move" if piece.get("reduced") else "combat")
		var badges: Array = []
		if piece.get("active") == false:
			badges.append({"text": "停", "label": "非激活"})
		push.call({"id": piece.id, "hex": piece.location.hex, "asset": face,
			"label": definition.get("name", piece.id), "badges": badges})
	for airbase: Dictionary in data.deployment.airBases:
		var marker := _marker_asset(data, "Airbase Strength %d" % airbase.level)
		if marker.is_empty():
			continue
		push.call({"id": "airfield:%s:%s" % [airbase.side, airbase.hex], "hex": airbase.hex, "asset": marker,
			"label": "%s %d 级机场" % [side_name(airbase.side), airbase.level]})
	for id: String in opening.dumps:
		var dump: Dictionary = opening.dumps[id]
		if dump.location != "on-map" or int(dump.tokens) <= 0:
			continue
		var hex: String = id.substr(id.find(":hex:") + 5)
		for counter: Dictionary in supply_counters(id, int(dump.tokens), data):
			var placed: Dictionary = counter.duplicate()
			placed.hex = hex
			push.call(placed)
	var result: Array = []
	for hex: String in order:
		var layout := HexLayout.layout(hex)
		if layout.is_empty():
			continue
		result.append({"hex": hex, "x": layout.x, "y": layout.y, "scale": layout.scale,
			"pages": HexLayout.pages(stacks[hex], layout.scale)})
	return result


## Printed record track and counter boxes, mirroring scorpion-boxes.ts for the opening.
static func trackers(data: Dictionary) -> Array:
	var first: Dictionary = data.view.firstTurn
	var freeze: bool = str(first.ground) == "freeze"
	var trackers := [
		{"cell": 10 + int(first.number), "id": "turn", "asset": _marker_asset(data, "Turn"),
			"label": "第 %d 回合　%s" % [int(first.number), str(first.date)]},
		{"cell": 21 if freeze else 22, "id": "ground", "asset": _marker_asset(data, "Ground"),
			"label": "冻结" if freeze else "解冻"},
	]
	var flights := {"none": [23, "禁飞"], "limited": [24, "飞行受限"], "normal": [25, "正常飞行"]}
	var flight: Array = flights.get(str(first.flight), [25, "正常飞行"])
	trackers.append({"cell": int(flight[0]), "id": "flight", "asset": _marker_asset(data, "Flight"),
		"label": str(flight[1])})
	var vp := int(first.vp)
	trackers.append({"cell": 33 + clampi(vp, -5, 20), "id": "vp",
		"asset": _marker_asset(data, "Soviet VPs Tracker"), "label": "苏军净胜利分 %d" % vp})
	return trackers


static func inventories(state: Dictionary, data: Dictionary, viewer: String) -> Array:
	var opening: Dictionary = state.opening
	var cells := {"axis": {"dead": 19, "air": 20}, "soviet": {"dead": 27, "air": 26}}
	var names := {"axis": "轴心国", "soviet": "苏联"}
	var boxes: Array = []
	for side: String in ["axis", "soviet"]:
		for kind: String in ["dead-pile", "off-map-air"]:
			var hidden: bool = kind == "off-map-air" and viewer != side
			var counters: Array = []
			if not hidden:
				for piece: Dictionary in opening.pieces:
					if piece.side != side or piece.location.kind != kind:
						continue
					var definition := _definition(data, piece.definition)
					var faces: Dictionary = definition.get("faces", {})
					var asset: Variant = faces.get("move") if piece.get("reduced") else faces.get("combat")
					var counter := {"id": piece.id, "asset": asset, "label": definition.get("name", piece.id)}
					if kind == "off-map-air" and piece.get("active") == false:
						counter.badges = [{"text": "停", "label": "非激活"}]
					counters.append(counter)
			var cell: int = int(cells[side].dead) if kind == "dead-pile" else int(cells[side].air)
			var label: String = "%s死人堆" % names[side] if kind == "dead-pile" else "%s地图外空军" % names[side]
			boxes.append({"cell": cell, "label": label, "counters": counters, "hidden": hidden})
	return boxes


## Soviet aid card keeps the two army-group artillery markers on their ready slots.
static func aid_counters(data: Dictionary) -> Array:
	var refs := ["1st Ukr Arty Ready", "2nd Ukr Arty Ready"]
	var ids := ["first-ukrainian", "second-ukrainian"]
	var slots := [[907.0, 943.0], [947.0, 943.0]]
	var counters: Array = []
	for index in 2:
		counters.append({"id": "artillery:%s" % ids[index],
			"label": "第 %d 乌克兰方面军炮击标记 · 就绪" % (index + 1),
			"asset": _marker_asset(data, refs[index]),
			"x": slots[index][0], "y": slots[index][1], "size": 35.0})
	return counters


static func auxiliary_cards(state: Dictionary, data: Dictionary, viewer: String) -> Dictionary:
	var boxes: Array = inventories(state, data, viewer)
	return {
		"axis-off-map": _axis_card(state, data),
		"soviet-off-map": _reserve_card("soviet", state, data),
		"turn-weather": _turn_card(data),
		"axis-dead": _dead_card(boxes, 19),
		"soviet-dead": _dead_card(boxes, 27),
		"rail-sea-cap": {"counters": [], "captions": [
			{"x": 28.0, "y": 276.0, "text": "瓶中蝎：双方铁路运力 0，海运运力 0"}]},
	}


static func _axis_card(state: Dictionary, data: Dictionary) -> Dictionary:
	var card := _reserve_card("axis", state, data)
	var strips: Array = data.view.get("airstrips", [])
	for index in strips.size():
		var strip: Dictionary = strips[index]
		card.counters.append({"id": "airstrip:%s" % str(strip.definition), "asset": strip.get("asset", ""),
			"label": "可用简易跑道 %d" % (index + 1), "x": 183.0 + index * 75.0, "y": 438.0, "size": 54.0})
	# TTW S08 p.55 — the 1st Corps is in the setup snapshot, the 4th Corps starts available.
	var slots := ["hq:id:4150", "hq:id:4151"]
	for index in slots.size():
		var definition: String = slots[index]
		var source := _definition(data, definition)
		if not (source.get("abilities", []) as Array).has("kessel_supply"):
			continue
		var on_map := false
		for id: String in state.opening.units:
			if state.opening.units[id].definition == definition:
				on_map = true
		var dead := false
		for piece: Dictionary in state.opening.pieces:
			if piece.definition == definition and piece.location.kind == "dead-pile":
				dead = true
		if not on_map and not dead:
			card.counters.append({"id": "kessel-box:%s" % definition,
				"asset": source.get("faces", {}).get("combat"),
				"label": "%s · 可放置" % str(source.get("name", definition)),
				"x": 219.0 + 74.0 * index, "y": 729.0, "size": 54.0})
	for index in state.opening.get("availableAlerts", []).size():
		var alert: Dictionary = state.opening.availableAlerts[index]
		var source := _definition(data, alert.definition)
		card.counters.append({"id": "alert-pool:%s" % str(alert.id),
			"asset": source.get("faces", {}).get("combat"), "label": str(source.get("name", alert.definition)),
			"x": 418.0 + 75.0 * (index % 4), "y": 595.0 + floor(index / 4.0) * 75.0, "size": 55.0})
	var remnants := ["land:id:3999", "land:id:4499"]
	for index in remnants.size():
		var definition: String = remnants[index]
		var in_units := false
		for id: String in state.opening.units:
			if state.opening.units[id].definition == definition:
				in_units = true
		if in_units:
			continue
		var asset: Variant = _definition(data, definition).get("faces", {}).get("combat")
		if asset == null:
			continue
		card.counters.append({"id": "remnant-pool:%s" % definition, "asset": asset,
			"label": "可用德军残部营", "x": 183.0 + index * 75.0, "y": 317.0, "size": 54.0})
	return card


static func _reserve_card(side: String, state: Dictionary, data: Dictionary) -> Dictionary:
	var used: Dictionary = {}
	for id: String in state.opening.units:
		var unit: Dictionary = state.opening.units[id]
		if unit.side == side and unit.get("reserve") != null:
			used[unit.hex] = true
	var count: int = max(0, 6 - used.size())
	var axis: bool = side == "axis"
	var card := {"counters": [], "captions": []}
	for index in count:
		card.counters.append({"id": "reserve:%s:%d" % [side, index], "label": "可用预备标记",
			"asset": _marker_asset(data, "Axis Reserve" if axis else "Sov Reserve"),
			"x": (256.0 if axis else 196.0) + index * 93.0, "y": 852.0 if axis else 1176.0, "size": 50.0})
	var label := "剩余预备标记 %d" % count
	card.counters.append({"id": "reserve-count:%s" % side, "label": label,
		"asset": _marker_asset(data, "Axis Reserves Tracker" if axis else "Soviet Reserves Tracker"),
		"x": 915.0, "y": 852.0 if axis else 1176.0, "size": 57.0,
		"badges": [{"label": label, "text": str(count)}]})
	return card


static func _turn_card(data: Dictionary) -> Dictionary:
	var first: Dictionary = data.view.firstTurn
	var date: String = str(first.date)
	var freeze: bool = str(first.ground) == "freeze"
	var card := {"counters": [], "captions": []}
	card.counters.append({"id": "track-year", "label": date.substr(0, 4),
		"asset": _marker_asset(data, "Year", "move"), "x": 107.0, "y": 120.0, "size": 50.0})
	card.counters.append({"id": "track-month", "label": date.substr(0, 7),
		"asset": _marker_asset(data, "Month"), "x": 606.0 if int(date.substr(5, 2)) == 1 else 696.0,
		"y": 113.0, "size": 42.0})
	card.counters.append({"id": "track-turn", "label": "第 %d 回合 · %s" % [int(first.number), date],
		"asset": _marker_asset(data, "Turn"), "x": _day_slot(date), "y": 324.0, "size": 36.0})
	card.counters.append({"id": "track-ground", "asset": _marker_asset(data, "Ground"),
		"label": "冻结" if freeze else "解冻", "x": 547.0 if freeze else 631.0, "y": 504.0, "size": 43.0})
	var flights := {"normal": [742.0, "正常飞行"], "limited": [825.0, "飞行受限"], "none": [909.0, "禁飞"]}
	var flight: Array = flights.get(str(first.flight), [742.0, "正常飞行"])
	card.counters.append({"id": "track-flight", "asset": _marker_asset(data, "Flight"),
		"label": str(flight[1]), "x": flight[0], "y": 659.0, "size": 41.0})
	return card


static func _day_slot(date: String) -> float:
	var days := [1, 5, 8, 12, 15, 19, 22, 26, 29]
	return 121.0 + days.find(int(date.substr(8, 2))) * 90.0


static func _dead_card(boxes: Array, cell: int) -> Dictionary:
	var contents: Array = []
	for box: Dictionary in boxes:
		if int(box.get("cell", 0)) == cell:
			contents = box.get("counters", [])
	var count := contents.size()
	var columns: int = max(1, int(ceil(sqrt(count * 1.4)))) if count else 1
	var rows: int = max(1, int(ceil(float(count) / columns)))
	var pitch: float = minf(76.0, minf(840.0 / columns, 480.0 / rows))
	var counters: Array = []
	for index in count:
		var counter: Dictionary = contents[index].duplicate()
		counter.x = 65.0 + pitch * (index % columns)
		counter.y = 130.0 + pitch * int(index / columns)
		counter.size = pitch - 6.0
		counters.append(counter)
	return {"counters": counters, "captions": []}


## OCS v4.3 §12 — printed supply counters: every four tons become one SP counter.
static func supply_counters(id: String, tokens: int, data: Dictionary) -> Array:
	var counters: Array = []
	var left := tokens
	while left > 0:
		var points: int = min(5, left / 4)
		var used: int = points * 4 if points else left
		var label: String = "%d SP" % points if points else "%dT" % used
		var ref: String = "Supply Point %d" % points if points else "Supply Ton %dT" % used
		var asset := _marker_asset(data, ref)
		if asset.is_empty():
			break
		counters.append({"id": "%s:%d" % [id, counters.size() + 1], "label": label, "asset": asset})
		left -= used
	return counters


## TTW 13.2c — printed transport denominations on the board, counted per side like the sidebar.
static func transport_stock(units: Dictionary, side: String, data: Dictionary) -> Array:
	var rows: Array = []
	for row: Dictionary in data.view.transportRows:
		if row.side != side:
			continue
		rows.append({"side": row.side, "mobility": row.mobility, "allowance": row.allowance,
			"points": row.points, "inUse": 0, "limit": row.get("limit")})
	for id: Variant in units:
		var unit: Dictionary = units[id]
		# organicTruck carries the load label ('full'/'empty') rather than a boolean.
		if unit.get("side") != side or unit.get("combat") == true or unit.get("organicTruck") != null:
			continue
		var definition: Dictionary = data.view.catalog.definitions.get(unit.get("definition"), {})
		# TTW 13.2c — bucket by the printed counter, not by the deployed fields the board may have
		# changed (mode swaps, extenders). Track-mobility and organic-truck counters are not stock.
		if definition.get("kind") != "transport" or definition.get("abilities", []).has("organic_truck"):
			continue
		var profile: Variant = definition.get("moveProfile")
		if not profile is Dictionary or str(profile.get("mobility")) == "track":
			continue
		var points: Variant = definition.get("transport")
		if points == null:
			continue
		for row: Dictionary in rows:
			if row.mobility == profile.get("mobility") and row.allowance == profile.get("allowance") \
					and row.points == int(points):
				row.inUse += 1
				break
	rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		if a.mobility != b.mobility:
			return a.mobility < b.mobility
		if a.allowance != b.allowance:
			return a.allowance < b.allowance
		return a.points < b.points)
	return rows


## TTW 1.6e — every breakdown definition owns physical copies; the opening board has none deployed.
static func breakdown_stock(units: Dictionary, pieces: Array, data: Dictionary) -> Array:
	var rows: Array = []
	if data.view.breakdownRows.is_empty():
		return rows
	var occupied := {}
	var in_use := {}
	for id: Variant in units:
		occupied[str(id)] = true
		var definition: Variant = units[id].get("definition")
		in_use[definition] = in_use.get(definition, 0) + 1
	for piece: Dictionary in pieces:
		occupied[str(piece.id)] = true
		in_use[piece.definition] = in_use.get(piece.definition, 0) + 1
	for row: Dictionary in data.view.breakdownRows:
		if row.get("side") == null:
			continue
		var used: int = in_use.get(row.definition, 0)
		var wanted: int = 1 if row.copies == null else max(0, int(row.copies) - used)
		var ids: Array = []
		var copy := 1
		while ids.size() < wanted:
			var id := "breakdown:%s:%d" % [row.definition, copy]
			if not occupied.has(id):
				ids.append(id)
			copy += 1
		rows.append({"definition": row.definition, "side": row.side, "pool": row.pool,
			"copies": row.copies, "inUse": used, "availableIds": ids})
	return rows


static func _ground_badges(unit: Dictionary, data: Dictionary, show_reserve: bool) -> Array:
	var badges: Array = []
	if unit.get("disorganized"):
		badges.append(_badge(data, "DG (Disorganized)", "混乱", "DG"))
	if unit.get("reserve"):
		if show_reserve:
			badges.append(_badge(data, "Axis Reserve" if unit.side == "axis" else "Sov Reserve", "预备", "预"))
		else:
			badges.append({"label": "同格预备堆叠", "text": "预"})
	if unit.get("exploit"):
		badges.append(_badge(data, "Exploit %s" % str(unit.get("exploitRating", "")), "进击", "进"))
	if unit.get("outOfSupply"):
		badges.append(_badge(data, "Out of Supply", "断补", "断"))
	if unit.get("internalStocks") == "low":
		badges.append(_badge(data, "Low/Exhausted", "部队储备低下", "低"))
	if unit.get("internalStocks") == "exhausted":
		badges.append(_badge(data, "Exhausted", "部队储备耗尽", "耗"))
	if int(unit.get("stepsLost", 0)) > 0:
		var steps: int = int(unit.stepsLost)
		badges.append(_badge(data, "Step Loss %d" % steps, "已损失 %d 步" % steps, str(steps)))
	if unit.has("transportCargoTokens") or unit.get("organicTruck"):
		var tokens: int = int(unit.get("transportCargoTokens", 4 if unit.get("organicTruck") == "full" else 0))
		var label: String = "装载 %dT" % tokens if tokens else "空载"
		var organic: String = ""
		if unit.get("organicTruck") and tokens >= 1 and tokens <= 4:
			organic = "F Organic c.png" if tokens == 4 else "%dT Organic c.png" % tokens
		badges.append({"label": label, "asset": organic} if not organic.is_empty()
			else {"label": label, "text": "%dT" % tokens if tokens else "空"})
	return badges


static func _badge(data: Dictionary, ref: String, label: String, text: String) -> Dictionary:
	var asset := _marker_asset(data, ref)
	return {"label": label, "asset": asset} if not asset.is_empty() else {"label": label, "text": text}


static func _marker_asset(data: Dictionary, ref: String, face: String = "combat") -> String:
	var marker: Dictionary = data.view.catalog.markers.get(ref, {})
	var asset: Variant = marker.get(face)
	return "" if asset == null else str(asset)


static func _definition(data: Dictionary, id: String) -> Dictionary:
	return data.view.catalog.definitions.get(id, {})


## Godot's sort_custom is not stable; decorate so equal keys keep the printed order.
static func _stable_sort(items: Array, less: Callable) -> Array:
	var decorated: Array = []
	for index in items.size():
		decorated.append({"item": items[index], "index": index})
	decorated.sort_custom(func(left: Dictionary, right: Dictionary) -> bool:
		if less.call(left.item, right.item):
			return true
		if less.call(right.item, left.item):
			return false
		return left.index < right.index)
	var result: Array = []
	for entry: Dictionary in decorated:
		result.append(entry.item)
	return result
