extends RefCounted

## GDScript counterpart of desktop/local/actions.mjs and src/view/scorpion-map-counters.ts.
## Native projection for the printed 08 opening: roster, legal setup actions and the map stacks.
## Only the setup phase is projected here; later phases are added with their own mechanisms.

const HexLayout := preload("res://scripts/view/hex_layout.gd")
const Reinforcement := preload("res://works/third-winter/rules/reinforcement.gd")
const Combat := preload("res://works/third-winter/rules/combat.gd")
const CombatResult := preload("res://works/third-winter/rules/combat_result.gd")
const Barrage := preload("res://works/third-winter/rules/barrage.gd")
const SpPayment := preload("res://works/third-winter/rules/sp_payment.gd")
const ReinforcementBoard := preload("res://works/third-winter/rules/reinforcement_board.gd")
const SupplyPhase := preload("res://works/third-winter/rules/supply_phase.gd")
const StepLoss := preload("res://scripts/rules/series/step_loss.gd")
const Remnants := preload("res://works/third-winter/rules/remnants.gd")
const Hedgehogs := preload("res://works/third-winter/rules/hedgehogs.gd")
const GroundMove := preload("res://works/third-winter/rules/ground_move.gd")
const Fuel := preload("res://works/third-winter/rules/fuel.gd")
const TransportPoints := preload("res://works/third-winter/rules/transport_points.gd")
const Capture := preload("res://works/third-winter/rules/capture.gd")
const Kessel := preload("res://works/third-winter/rules/kessel.gd")
const Overrun := preload("res://works/third-winter/rules/overrun.gd")
const AirRefit := preload("res://works/third-winter/rules/air_refit.gd")
const Breakdown := preload("res://works/third-winter/rules/breakdown.gd")

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
	if str(state.cursor.phase) == "reaction":
		return "soviet" if str(state.cursor.phasing) == "axis" else "axis"
	return state.cursor.phasing


## TTW S08 pp.53–56 — printing order of the setup roster: deployable counters, aircraft, placed counters.
static func roster(state: Dictionary, side: String, data: Dictionary) -> Array:
	var opening := _source(state)
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
	if state.kind == "playing":
		if str(state.cursor.get("phase")) == "reinforcement" and state.get("window") != null:
			return reinforcement_choices(state, side, selection, data)
		if _closable_phase(str(state.cursor.get("phase"))):
			var commands := playing_choices(state, side, selection, data)
			var rated: Array = []
			for command: Dictionary in commands:
				rated.append({"label": command.label, "actions": [command]})
			return rated
		return []
	var choices: Array = []
	var opening := _source(state)
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
	for airbase: Dictionary in opening.get("airBases", data.deployment.get("airBases", [])):
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




## Projection consumed by the map and the sidebar. Frame boxes, auxiliary cards and the turn track
## are still served by the TypeScript bridge and are not produced here yet.
## Setup keeps its facts under `opening`; the in-play state moves them to the top level. Boxes, map
## stacks and cards read one shape through this adapter.
static func _source(state: Dictionary) -> Dictionary:
	if state.kind != "playing":
		return state.opening
	return {"units": state.get("units", {}), "pieces": state.get("pieces", []),
		"dumps": state.get("dumps", {}), "availableAlerts": state.get("availableAlerts", []),
		"airBases": state.get("airBases", [])}


## TTW S08 — the reinforcement phase projection, plus the bare projection of the phases that only
## offer their closing command so far. Yet unmigrated phases are still refused instead of drawn.
static func _choice(choices: Array, label: String, actions: Array) -> void:
	choices.append({"label": label, "actions": actions})


## Revisions 38–42 of the oracle: movement, supply and reaction with no selection. Only the closing
## command is exposed, because the move, reserve, fuel and trace choices are not native yet.
static func _project_phase(record: Dictionary, selection: Dictionary, data: Dictionary,
		viewer: String) -> Dictionary:
	var state: Dictionary = record.state
	var revision: int = record.revision
	var actor: String = decision_side(state)
	var entries := roster_playing(state, actor, data)
	var unit_id: Variant = selection.get("unitId")
	var unit_ids: Array = []
	if selection.has("unitIds"):
		for id: Variant in selection.unitIds:
			if _roster_has(entries, id):
				unit_ids.append(id)
	elif unit_id != null:
		unit_ids.append(unit_id)
	var actions: Array = _choice_actions(revision,
		playing_choices(state, actor, selection, data))
	var stacks := map_stacks(state, data)
	var frame := {
		"trackers": trackers(data), "inventories": inventories(state, data, viewer),
		"aidCounters": aid_counters(data), "auxiliaryCards": auxiliary_cards(state, data, viewer),
		"mapStacks": stacks, "selectedUnits": unit_ids, "targets": [], "route": [],
	}
	var picked_hex: Variant = selection.get("hex")
	if picked_hex != null:
		var layout := HexLayout.layout(str(picked_hex))
		if not layout.is_empty():
			frame.selectedHex = layout
	var phase: String = PHASE_NAMES.get(str(state.cursor.phase), str(state.cursor.phase))
	return {
		"protocolVersion": 1, "revision": revision, "actor": actor,
		"headline": "第 %d 回合 · %s · %s" % [int(state.turn.number), side_name(actor), phase],
		"phase": phase, "phaseId": str(state.cursor.phase),
		"roster": entries, "stack": _stack(selection, stacks, entries), "stacking": [],
		"unitId": unit_id, "unitIds": unit_ids, "hex": picked_hex, "route": [],
		"actions": actions, "menu": _menu_keys(menu_entries(state, actor, selection, data), revision),
		"ended": state.get("victory") != null,
		"turnNumber": int(state.turn.number), "phasingSide": str(state.cursor.phasing),
		"transportStock": transport_stock(state.get("units", {}), viewer, data),
		"breakdownStock": breakdown_stock(state.get("units", {}), state.get("pieces", []), data),
		"frame": frame,
	}


static func _closable_phase(phase: String) -> bool:
	return phase == "movement" or phase == "supply" or phase == "reaction" or phase == "combat" \
		or phase == "exploitation" or phase == "cleanup"


## The segment commands the panel offers, as real actions rather than text: the map resolves a
## pressed key back through this same list, so the payloads have to live here.
## Mirrors desktop/local/actions.mjs `supplyChoices` and the segment closing commands.
static func playing_choices(state: Dictionary, side: String, selection: Dictionary,
		data: Dictionary) -> Array:
	var phase := str(state.cursor.get("phase"))
	if phase == "supply":
		return _supply_choices(state, side, selection, data)
	# OCS 2.2 — the closing command of each segment with no pending combat.
	return [{"label": "结束" + str(PHASE_NAMES.get(phase, phase)), "type": "complete-" + phase}]


static func _supply_choices(state: Dictionary, side: String, selection: Dictionary, data: Dictionary) -> Array:
	var decision := SupplyPhase.decision(state, side)
	var step := str(decision.get("step", ""))
	var window: Dictionary = state.get("supply", {})
	var names: Dictionary = data.view.get("catalog", {}).get("definitions", {})
	if step == "choose-formation-trace":
		var formation := str(decision.get("formation", ""))
		var pending: Dictionary = {}
		for split: Dictionary in (window.get("splits", []) as Array):
			if str(split.get("formation", "")) == formation:
				pending = split
				break
		var choices: Array = []
		if not pending.is_empty():
			for anchor: Variant in (pending.get("anchors", []) as Array):
				var anchor_id := str(anchor)
				var unit_id := anchor_id.substr(anchor_id.find(":") + 1)
				var display := unit_id
				var unit: Dictionary = state.get("units", {}).get(unit_id, {})
				if not unit.is_empty():
					var name := str(names.get(str(unit.get("definition", "")), {}).get("name", "HQ"))
					display = "%s %s" % [str(unit.get("hex", "")), name]
				choices.append({"label": "%s 追溯 · %s" % [formation, display],
					"type": "choose-formation-trace", "formation": formation, "anchor": anchor_id})
		return choices
	if step == "assign-attrition":
		var stack_hex := str(decision.get("hex", ""))
		var stack: Dictionary = {}
		for entry: Dictionary in (window.get("attrition", []) as Array):
			if str(entry.get("hex", "")).to_lower() == stack_hex.to_lower() and entry.get("assigned") != true:
				stack = entry
				break
		var losses := []
		if not stack.is_empty():
			for unit_id: Variant in (stack.get("units", []) as Array):
				var order: Array = [unit_id]
				for other: Variant in (stack.get("units", []) as Array):
					if other != unit_id:
						order.append(other)
				var left := int(stack.get("losses", 0))
				var allocation: Array = []
				for candidate: Variant in order:
					var remaining := StepLoss.remaining(state.get("units", {}).get(str(candidate), {}))
					var steps: int = min(left, remaining)
					if steps < 1:
						break
					allocation.append({"unitId": str(candidate), "steps": steps})
					left -= steps
				var name := str(names.get(str(state.get("units", {}).get(str(unit_id), {}).get("definition", "")), {}).get("name", str(unit_id)))
				losses.append({"label": "%s 分配 %d 步损失 · 优先 %s" % [str(stack.get("hex", "")),
					int(stack.get("losses", 0)), name], "type": "assign-attrition",
					"hex": str(stack.get("hex", "")), "allocation": allocation})
		return losses
	if step == "settle-trace-and-feeding":
		var choices: Array = _feed_choices(state, side, selection, data)
		choices.append({"label": "确认追溯补给并检查断补损耗", "type": "check-attrition"})
		return choices
	if step == "complete-supply":
		return [{"label": "结束补给", "type": "complete-supply"}]
	return []


## desktop/local/supply-draft.mjs `supplyDraft` — only the selected counters that lack an abstract
## trace can be fed, one shared payment per source, `ceil(RE/2)` tokens each.
static func _feed_choices(state: Dictionary, side: String, selection: Dictionary, data: Dictionary) -> Array:
	var window: Dictionary = state.get("supply", {})
	var ids: Array = []
	if selection.get("unitIds") is Array:
		ids = (selection.get("unitIds") as Array).duplicate()
	elif selection.get("unitId") != null:
		ids = [selection.get("unitId")]
	var selected: Array = []
	for id: Variant in ids:
		var unit: Dictionary = state.get("units", {}).get(str(id), {})
		if unit.is_empty() or unit.get("combat") != true or str(unit.get("side")) != side:
			continue
		if not selected.has(str(id)):
			selected.append(str(id))
	if selected.is_empty():
		return []
	var unresolved: Array = []
	for id: String in selected:
		if (window.get("fed", []) as Array).has(id) or SupplyPhase.has_trace(window, id):
			continue
		unresolved.append(id)
	if unresolved.is_empty() or window.get("attrition") != null:
		return []
	for split: Dictionary in (window.get("splits", []) as Array):
		if split.get("selected") == null:
			return []
	var total := 0
	var portions: Array = []
	for id: String in unresolved:
		var re: int = StepLoss.remaining(state.get("units", {}).get(id, {}))
		portions.append({"unitId": id, "re": re})
		total += re
	## Internal-stock recovery only intervenes for counters that carry `internalStocks`; the native
	## 08 state never does, so `planScorpionStockRecovery` settles without spending here.
	var ledger: RefCounted = SpPayment.new(state, side, data)
	var cost := int(ceil(float(total) / 2.0))
	var choices: Array = []
	for row: Dictionary in ledger.available(unresolved.map(func(id: String) -> Dictionary:
			return state.get("units", {}).get(id, {}))):
		var tokens := int(row.get("tokens", 0))
		if tokens < cost:
			continue
		var from: Dictionary = ledger.source(str(row.get("dumpId", "")))
		if from.is_empty():
			continue
		var place := "%s 补给堆" % str(from.get("hex", ""))
		var truck: Dictionary = from.get("truck", {})
		if not truck.is_empty():
			place = "%s %s 车载补给" % [str(from.get("hex", "")),
				_unit_name(state, str(row.get("dumpId", "")), data)]
		choices.append({"label": "%s · 支付 %dT 供养 %d 枚（%d RE，余 %dT）"
			% [place, cost, portions.size(), total, tokens - cost], "type": "feed-units",
			"payments": [{"dumpId": str(row.get("dumpId", "")), "portions": portions}]})
	return choices


static func _unit_name(state: Dictionary, id: String, data: Dictionary) -> String:
	var unit: Dictionary = state.get("units", {}).get(id, {})
	var names: Dictionary = data.view.get("catalog", {}).get("definitions", {})
	return str(names.get(str(unit.get("definition", "")), {}).get("name", id))


## 菜单条目自带内联动作；补 menu:<revision>:<index> 键供 apply 寻址（对照 TS localMenu 键口径）。
static func _menu_keys(entries: Array, revision: int) -> Array:
	for index: int in entries.size():
		entries[index]["key"] = "menu:%d:%d" % [revision, index]
	return entries


static func _choice_actions(revision: int, choices: Array) -> Array:
	var actions: Array = []
	for choice: Dictionary in choices:
		actions.append({"key": "action:%d:%d" % [revision, actions.size()],
			"label": choice.label, "kind": "command",
			"actionTypes": [choice.type]})
	return actions


static func project_playing(record: Dictionary, selection: Dictionary, data: Dictionary, viewer: String) -> Dictionary:
	var state: Dictionary = record.state
	if str(state.turn.get("step", {}).get("kind")) != "player-turn":
		return {}
	var phase_id := str(state.cursor.get("phase"))
	if phase_id == "reinforcement" and state.get("window") != null:
		pass
	elif _closable_phase(phase_id):
		return _project_phase(record, selection, data, viewer)
	else:
		return {}
	var revision: int = record.revision
	var actor: String = decision_side(state)
	var entries := roster_playing(state, actor, data)
	var selected := {}
	for entry: Dictionary in entries:
		if entry.id == selection.get("unitId"):
			selected = entry
			break
	var placement: bool = str(state.window.get("stage")) == "scheduled"
	if selected.is_empty() and placement and not selection.has("unitIds") and not entries.is_empty():
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
		"hex": selection.get("hex") if selection.get("hex") != null else selected.get("hex")}
	var legal := reinforcement_choices(state, actor, picked, data)
	var actions: Array = []
	for choice: Dictionary in legal:
		actions.append({"key": "action:%d:%d" % [revision, actions.size()], "label": choice.label,
			"kind": "command",
			"actionTypes": choice.actions.map(func(step: Dictionary) -> String: return step.type)})
	var stacks := map_stacks(state, data)
	var frame := {
		"trackers": trackers(data), "inventories": inventories(state, data, viewer),
		"aidCounters": aid_counters(data), "auxiliaryCards": auxiliary_cards(state, data, viewer),
		"mapStacks": stacks, "selectedUnits": unit_ids, "targets": [], "route": [],
	}
	if picked_hex != null:
		var layout := HexLayout.layout(str(picked_hex))
		if not layout.is_empty():
			frame.selectedHex = layout
	var phase: String = PHASE_NAMES.get(str(state.cursor.phase), str(state.cursor.phase))
	return {
		"protocolVersion": 1, "revision": revision, "actor": actor,
		"headline": "第 %d 回合 · %s · %s" % [int(state.turn.number), side_name(actor), phase],
		"phase": phase, "phaseId": str(state.cursor.phase),
		"roster": entries, "stack": _stack(selection, stacks, entries), "stacking": [],
		"unitId": unit_id, "unitIds": unit_ids, "hex": picked_hex, "route": [],
		"actions": actions, "menu": _menu_keys(menu_entries(state, actor, picked, data), revision), "ended": false,
			"turnNumber": int(state.turn.number), "phasingSide": str(state.cursor.phasing),
			"transportStock": transport_stock(state.get("units", {}), viewer, data),
			"breakdownStock": breakdown_stock(state.get("units", {}), state.get("pieces", []), data),
		"frame": frame,
	}


## S08 scheduled arrivals list only the counters that still owe this phase; afterwards the panel falls
## back to the side's counters and aircraft, matching src/view/campaign-match-view.ts.
static func roster_playing(state: Dictionary, side: String, data: Dictionary) -> Array:
	if str(state.cursor.get("phase")) == "reinforcement" and str(state.window.get("stage")) == "scheduled":
		var entries: Array = []
		for entry: Dictionary in arrivals(state, side, data):
			entries.append(_counter_entry(str(entry.id), str(entry.definition), null,
				"可选增援" if entry.get("optionalForce") != null else "定期增援", data))
		return entries
	var entries: Array = []
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if unit.side != side:
			continue
		entries.append(_counter_entry(id, str(unit.definition), unit.get("hex"), unit.get("hex"), data))
	for piece: Dictionary in state.get("pieces", []):
		if piece.side != side or piece.kind != "aircraft" or piece.location.kind == "dead-pile":
			continue
		var hex: Variant = piece.location.get("hex")
		entries.append(_counter_entry(str(piece.id), str(piece.definition), hex,
			hex if hex != null else "地图外空军盒", data))
	return entries


## The catalog entries that still owe this turn: scheduled ones only in their own turn, optional
## formations from their printed turn onward.
static func arrivals(state: Dictionary, side: String, data: Dictionary) -> Array:
	var turn := int(state.cursor.turn)
	var placed: Array = state.get("arrival", {}).get("placed", [])
	var result: Array = []
	for entry: Dictionary in data.view.get("arrivals", []):
		if str(entry.side) != side or placed.has(entry.id):
			continue
		if entry.get("optionalForce") != null:
			if int(entry.turn) <= turn:
				result.append(entry)
		elif int(entry.turn) == turn:
			result.append(entry)
	return result


## The reinforcement-phase command list of desktop/local/actions.mjs, in its printed order.
static func reinforcement_choices(state: Dictionary, side: String, selection: Dictionary, data: Dictionary) -> Array:
	var choices: Array = []
	var window: Dictionary = state.window
	var graph: Dictionary = data.view.mapGraph
	if str(window.get("stage")) == "scheduled":
		var candidates := arrivals(state, side, data)
		var status: Dictionary = Reinforcement.scheduled(state, side, data)
		var placeable: Array = status.placeable
		var picked := {}
		for entry: Dictionary in candidates:
			if entry.id == selection.get("unitId"):
				picked = entry
				break
		if picked.is_empty() and not (selection.has("unitIds") and selection.get("unitIds", []).is_empty()):
			picked = placeable[0] if not placeable.is_empty() else {}
		if not picked.is_empty():
			var first_call: bool = picked.get("optionalForce") != null \
				and not state.get("arrival", {}).get("mobilized", []).has(picked.optionalForce)
			for at: String in ReinforcementBoard.arrival_destinations(graph, data, state, picked):
				var suffix := " · 首次调入扣 5 VP" if first_call else ""
				_choice(choices, "入场到 %s%s" % [at, suffix],
					[{"type": "place-arrival", "arrivalId": picked.id, "hex": at}])
		var fixed: Array = []
		for entry: Dictionary in placeable:
			var at: Array = ReinforcementBoard.arrival_destinations(graph, data, state, entry)
			if at.size() == 1:
				fixed.append({"type": "place-arrival", "arrivalId": entry.id, "hex": at[0]})
		if fixed.size() > 1:
			choices.append({"label": "放置 %d 枚只有一个入场格的定期增援" % fixed.size(), "actions": fixed})
		if int(window.get("fixedTokens", 0)) > 0:
			for id: String in window.get("fixedDestinations", []):
				_choice(choices, "放置固定补给 %dT · %s" % [int(window.fixedTokens), id],
					[{"type": "place-supply", "target": {"kind": "hex", "id": id}, "tokens": int(window.fixedTokens)}])
		if placeable.is_empty() and int(window.get("fixedTokens", 0)) == 0:
			for entry: Dictionary in status.blocked:
				_choice(choices, "无法入场：%s 印刷入场格全部被敌方占据，按 OCS 13.6 记录为未到场" % str(entry.id),
					[{"type": "finish-scheduled-arrivals"}])
			_choice(choices, "完成定期增援并处理可变补给", [{"type": "finish-scheduled-arrivals"}])
		return choices
	var tokens := int(window.get("variableTokens", 0))
	if tokens > 0:
		var enemy := "soviet" if side == "axis" else "axis"
		var open: Array = []
		for id: String in data.view.get("supplySources", {}).get(side, []):
			if Reinforcement.control_of(state, id, data) != enemy:
				open.append(id)
		var shown: Array = [selection.get("hex")] if open.has(selection.get("hex")) else open
		for id: String in shown:
			_choice(choices, "放置 %dT · %s" % [tokens, id],
				[{"type": "place-supply", "target": {"kind": "hex", "id": id}, "tokens": tokens}])
		_choice(choices, "放置 %dT · 地图外空军盒" % tokens,
			[{"type": "place-supply", "target": {"kind": "air-box"}, "tokens": tokens}])
	var pending: Variant = window.get("pendingAlert")
	if pending != null:
		for hex: String in ReinforcementBoard.alert_destinations(graph, data, state, pending, side,
				str(state.turn.weather.ground)):
			_choice(choices, "警戒营入场 · %s" % hex, [{"type": "place-alert", "hex": hex}])
		_choice(choices, "放弃本次警戒营", [{"type": "pass-alert"}])
	## TTW 2.4d and 1.7a — a remnant stacked with a supplied HQ can be exchanged for its parent at
	## one step, spending one Axis Pax.
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.units[id]
		if str(unit.get("side")) != side or unit.get("remnantOf") == null:
			continue
		for face: String in ["combat", "move"]:
			var probe: Dictionary = state.duplicate(true)
			var rebuilt := Remnants.rebuild(probe, side,
				{"type": "rebuild-remnant", "remnantId": id, "face": face}, data)
			if not rebuilt.ok:
				continue
			_choice(choices, "重建 %s · %s · 1 人员补充点"
				% [_unit_name(state, id, data), "战斗面" if face == "combat" else "移动面"],
				[{"type": "rebuild-remnant", "remnantId": id, "face": face}])
	if tokens == 0 and pending == null:
		_choice(choices, "结束增援", [{"type": "complete-reinforcement"}])
	return choices




static func project(record: Dictionary, selection: Dictionary, data: Dictionary, viewer: String = "axis") -> Dictionary:
	var state: Dictionary = record.state
	if state.kind == "playing":
		return project_playing(record, selection, data, viewer)
	if state.kind != "setup":
		return {}
	var opening := _source(state)
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
	var opening := _source(state)
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
		var show_reserve: bool = unit.get("reserve") != null and not marked_reserves.has("%s:%s" % [unit.side, unit.hex])
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
	for airbase: Dictionary in opening.get("airBases", data.deployment.get("airBases", [])):
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
	var opening := _source(state)
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
	var soviet := _reserve_card("soviet", state, data)
	var pax: Variant = _pax_marker(state, "soviet", data)
	if pax != null:
		soviet.counters.append(pax)
	return {
		"axis-off-map": _axis_card(state, data),
		"soviet-off-map": soviet,
		"turn-weather": _turn_card(state, data),
		"axis-dead": _dead_card(boxes, 19),
		"soviet-dead": _dead_card(boxes, 27),
		"rail-sea-cap": {"counters": [], "captions": [
			{"x": 28.0, "y": 276.0, "text": "瓶中蝎：双方铁路运力 0，海运运力 0"}]},
	}


static func _axis_card(state: Dictionary, data: Dictionary) -> Dictionary:
	var opening := _source(state)
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
		for id: String in opening.units:
			if opening.units[id].definition == definition:
				on_map = true
		var dead := false
		for piece: Dictionary in opening.pieces:
			if piece.definition == definition and piece.location.kind == "dead-pile":
				dead = true
		if not on_map and not dead:
			card.counters.append({"id": "kessel-box:%s" % definition,
				"asset": source.get("faces", {}).get("combat"),
				"label": "%s · 可放置" % str(source.get("name", definition)),
				"x": 219.0 + 74.0 * index, "y": 729.0, "size": 54.0})
	for index in opening.get("availableAlerts", []).size():
		var alert: Dictionary = opening.availableAlerts[index]
		var source := _definition(data, alert.definition)
		card.counters.append({"id": "alert-pool:%s" % str(alert.id),
			"asset": source.get("faces", {}).get("combat"), "label": str(source.get("name", alert.definition)),
			"x": 418.0 + 75.0 * (index % 4), "y": 595.0 + floor(index / 4.0) * 75.0, "size": 55.0})
	var remnants := ["land:id:3999", "land:id:4499"]
	for index in remnants.size():
		var definition: String = remnants[index]
		var in_units := false
		for id: String in opening.units:
			if opening.units[id].definition == definition:
				in_units = true
		if in_units:
			continue
		var asset: Variant = _definition(data, definition).get("faces", {}).get("combat")
		if asset == null:
			continue
		card.counters.append({"id": "remnant-pool:%s" % definition, "asset": asset,
			"label": "可用德军残部营", "x": 183.0 + index * 75.0, "y": 317.0, "size": 54.0})
	var pax: Variant = _pax_marker(state, "axis", data)
	if pax != null:
		card.counters.append(pax)
	return card


static func _reserve_card(side: String, state: Dictionary, data: Dictionary) -> Dictionary:
	var opening := _source(state)
	var used: Dictionary = {}
	for id: String in opening.units:
		var unit: Dictionary = opening.units[id]
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


static func _turn_card(state: Dictionary, data: Dictionary) -> Dictionary:
	var playing: bool = state.kind == "playing"
	var first: Dictionary = data.view.firstTurn
	var number := int(state.turn.number) if playing else int(first.number)
	var dates: Array = data.view.get("dates", [])
	var date: String = str(dates[number - 1]) if number >= 1 and number <= dates.size() else str(first.date)
	var ground := str(state.turn.weather.ground) if playing else str(first.ground)
	var freeze: bool = ground == "freeze"
	var card := {"counters": [], "captions": []}
	card.counters.append({"id": "track-year", "label": date.substr(0, 4),
		"asset": _marker_asset(data, "Year", "move"), "x": 107.0, "y": 120.0, "size": 50.0})
	card.counters.append({"id": "track-month", "label": date.substr(0, 7),
		"asset": _marker_asset(data, "Month"), "x": 606.0 if int(date.substr(5, 2)) == 1 else 696.0,
		"y": 113.0, "size": 42.0})
	card.counters.append({"id": "track-turn", "label": "第 %d 回合 · %s" % [number, date],
		"asset": _marker_asset(data, "Turn"), "x": _day_slot(date), "y": 324.0, "size": 36.0})
	if playing and str(state.turn.step.kind) == "player-turn":
		var player_turn := 1 if str(state.cursor.phasing) == str(state.cursor.first) else 2
		card.counters.append({"id": "track-player-turn", "label": "第 %d 个玩家回合" % player_turn,
			"asset": _marker_asset(data, "Player Turn", "move" if player_turn == 2 else "combat"),
			"x": 795.0, "y": 219.0, "size": 51.0})
	card.counters.append({"id": "track-ground", "asset": _marker_asset(data, "Ground"),
		"label": "冻结" if freeze else "解冻", "x": 547.0 if freeze else 631.0, "y": 504.0, "size": 43.0})
	var flight: Array = []
	if playing:
		var flights := {"normal": [742.0, "正常飞行"], "limited": [825.0, "飞行受限"], "none": [909.0, "禁飞"]}
		flight = flights.get(str(state.turn.weather.flight), [742.0, "正常飞行"])
	else:
		var flights := {"normal": [742.0, "正常飞行"], "limited": [825.0, "飞行受限"], "none": [909.0, "禁飞"]}
		flight = flights.get(str(first.flight), [742.0, "正常飞行"])
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


## src/view/scorpion-auxiliary-cards.ts only draws the Pax trackers once play starts.
static func _pax_marker(state: Dictionary, side: String, data: Dictionary) -> Variant:
	if state.kind != "playing":
		return null
	var value: int = int(state.get("pax", {}).get(side, 0))
	var asset := _marker_asset(data, "German Pax Tracker" if side == "axis" else "Soviet Pax Tracker")
	if asset == "":
		return null
	var label := "人员补充点 %d" % value
	var x := 54.0 if side == "axis" else 58.0
	if value > 0:
		x = (255.0 if side == "axis" else 265.0) + 82.0 * (min(9, value) - 1)
	return {"id": "pax:%s" % side, "label": label, "asset": asset, "x": x, "y": 174.0, "size": 32.0,
		"badges": [{"label": label, "text": str(value)}]}


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


## ── 右键/单位菜单（对照 desktop/local/actions.mjs、interaction.mjs、replies.mjs） ──
## menu 字段不参与 runner 视图对照；被比对的 actions 列表仍只由 playing_choices 等生成。
static func menu_entries(state: Dictionary, side: String, selection: Dictionary, data: Dictionary) -> Array:
	var menu: Array = []
	if state.get("kind") != "playing" or state.get("victory") != null:
		return menu
	# 夺取窗口是阻塞状态：面板只给结算，其它命令等窗口结清（会话层同样会拒）。
	if state.get("capture") != null:
		_append_capture_menu(state, side, data, menu)
		return menu
	if state.get("breakdownAbsorb") is Dictionary:
		_append_breakdown_absorb_menu(state, side, data, menu)
		return menu
	_append_unit_menu(state, side, selection, data, menu)
	_append_air_refit_menu(state, side, data, menu)
	_append_move_menu(state, side, selection, data, menu)
	_append_breakdown_menu(state, side, selection, data, menu)
	_append_overrun_rows(state, side, selection, data, menu)
	_append_overrun_continue_rows(state, side, selection, data, menu)
	_append_kessel_move_rows(state, side, selection, data, menu)
	_append_transport_fuel_menu(state, side, selection, data, menu)
	_append_repack_rows(state, side, selection, data, menu)
	_append_kessel_rows(state, side, selection, data, menu)
	_append_engage_menu(state, side, selection, data, menu)
	_append_hedgehog_menu(state, side, selection, data, menu)
	_append_combat_menu(state, side, data, menu)
	_append_barrage_menu(state, side, selection, data, menu)
	return menu


## TTW 2.3a / Q05 — 轴心增援阶段可把 Kessel 司令部放回有本方战斗算子的格，或把盘上的移除。
static func _append_kessel_rows(state: Dictionary, side: String, selection: Dictionary,
		data: Dictionary, menu: Array) -> void:
	if not Kessel.window(state, side):
		return
	var unit_id := _selected_unit_id(selection)
	if not unit_id.is_empty():
		var unit: Dictionary = state.get("units", {}).get(unit_id, {})
		var headquarters: Variant = unit.get("headquarters")
		if headquarters is Dictionary and (headquarters as Dictionary).get("kessel") == true \
				and str(unit.get("side", "")) == side:
			menu.append({"label": "移除 Kessel 司令部 %s" % _tail(unit_id), "group": "Kessel",
				"actions": [{"type": "remove-kessel-hq", "unitId": unit_id}]})
			return
	var hex := str(selection.get("hex", ""))
	if hex.is_empty() and not unit_id.is_empty():
		hex = str(state.get("units", {}).get(unit_id, {}).get("hex", ""))
	if hex.is_empty():
		return
	for slot: Dictionary in Kessel.slots(state, data):
		if not slot.get("ready", false):
			continue
		menu.append({"label": "部署 Kessel 司令部 %s · 格 %s" % [_tail(str(slot.definition)), hex],
			"group": "Kessel", "actions": [{"type": "place-kessel-hq",
				"definition": str(slot.definition), "hex": hex}]})


static func _append_unit_menu(state: Dictionary, side: String, selection: Dictionary, data: Dictionary, menu: Array) -> void:
	var unit_id: Variant = selection.get("unitId")
	if unit_id == null:
		var ids: Array = selection.get("unitIds", [])
		if ids.size() == 1:
			unit_id = ids[0]
	if unit_id == null:
		return
	var uid := str(unit_id)
	var unit: Dictionary = state.get("units", {}).get(uid, {})
	if unit.is_empty() or str(unit.get("side", "")) != side:
		return
	var phase := str(state.get("cursor", {}).get("phase", ""))
	var moved: Array = state.get("moved", [])
	if phase == "movement" and not moved.has(uid):
		if unit.get("combat") == true and unit.get("reserve") == null:
			var to_face := "combat" if unit.get("moveMode") == true else "move"
			var face_label := "战斗面" if to_face == "combat" else "移动面"
			menu.append({"label": "切换到%s" % face_label, "group": "模式",
				"actions": [{"type": "set-ground-mode", "unitId": uid, "face": to_face}]})
			if unit.get("disorganized") != true and unit.get("exploit") != true:
				menu.append({"label": "进入预备队", "group": "预备队",
					"actions": [{"type": "mark-reserve", "unitId": uid}]})
		elif unit.get("reserve") != null:
			menu.append({"label": "取消预备队状态", "group": "预备队",
				"actions": [{"type": "leave-reserve", "unitId": uid}]})
	if unit.get("reserve") != null and phase != "movement":
		menu.append({"label": "释放预备队", "group": "预备队",
			"actions": [{"type": "release-reserve", "unitId": uid}]})


## OCS 20.0a — 选中多步战斗单位且本阶段尚未移动时，逐条列出可拆出的 1 RE 拆分单位。
static func _append_breakdown_menu(state: Dictionary, side: String, selection: Dictionary, data: Dictionary,
		menu: Array) -> void:
	var parent_id := _selected_unit_id(selection)
	if parent_id.is_empty():
		return
	for option: Dictionary in Breakdown.options(state, side, parent_id, data):
		menu.append({"label": "拆出 %s · 1 步" % str(option.name), "group": "拆分",
			"actions": [{"type": "detach-breakdown", "parentId": parent_id,
				"definitions": [str(option.definition)]}]})


## OCS 20.0d — 段末吸收窗口：只列义务清单里的母单位与拆分单位，玩家逐条并回。
static func _append_breakdown_absorb_menu(state: Dictionary, side: String, data: Dictionary, menu: Array) -> void:
	var window: Dictionary = state.get("breakdownAbsorb", {})
	if str(window.get("side", "")) != side:
		return
	var units: Dictionary = state.get("units", {})
	var names: Dictionary = data.get("view", {}).get("catalog", {}).get("definitions", {})
	for obligation: Dictionary in (window.get("obligations", []) as Array):
		var parent_id := str(obligation.get("parentId", ""))
		var parent: Dictionary = units.get(parent_id, {})
		var parent_name := str((names.get(parent.get("definition", ""), {}) as Dictionary).get(
			"name", parent_id))
		for detached_id: Variant in (obligation.get("breakdownIds", []) as Array):
			var detached: Dictionary = units.get(str(detached_id), {})
			var detached_name := str((names.get(detached.get("definition", ""), {}) as Dictionary).get(
				"name", str(detached_id)))
			menu.append({"label": "吸收 %s 回 %s" % [detached_name, parent_name], "group": "拆分吸收",
				"actions": [{"type": "absorb-breakdown", "parentId": parent_id,
					"breakdownId": str(detached_id)}]})


## OCS v4.3 §2.2 / §14.2 — 飞机整备阶段逐架列出本方机场的 Inactive 飞机；首架带 1T 机场费，
## 同一机场再整备则免费。机场被敌方 ZOC 封锁或名额已满时不出行。
static func _append_air_refit_menu(state: Dictionary, side: String, data: Dictionary, menu: Array) -> void:
	if str(state.get("cursor", {}).get("phase", "")) != "aircraft-refit":
		return
	for option: Dictionary in AirRefit.base_options(state, side, data):
		menu.append({"label": "整备 %s · %s%s" % [str(option.hex), _tail(str(option.id)),
			"" if option.paid else " · 1T"], "group": "飞机整备",
			"actions": [{"type": "refit-aircraft", "id": str(option.id), "hex": str(option.hex)}]})


## OCS 6.1 — the move rows of desktop `moveChoices`: the clicked hex (or an explicit path) is offered
## only when the whole leg passes the same check the command runs. A mechanised combat face that still
## needs fuel gets one row per payable source, carrying `fuelDumpId`.
static func _append_move_menu(state: Dictionary, side: String, selection: Dictionary,
		data: Dictionary, menu: Array) -> void:
	if str(state.get("cursor", {}).get("phase", "")) != "movement":
		return
	if str(state.get("turn", {}).get("weather", {}).get("ground", "")) != "freeze":
		return
	var unit_id := ""
	var ids: Array = selection.get("unitIds", [])
	if selection.get("unitId") != null:
		unit_id = str(selection.unitId)
	elif ids.size() == 1:
		unit_id = str(ids[0])
	if unit_id.is_empty():
		return
	var unit: Dictionary = state.get("units", {}).get(unit_id, {})
	if unit.is_empty() or str(unit.get("side", "")) != side:
		return
	if unit.get("extender") != null or state.get("moved", []).has(unit_id):
		return
	if int(unit.get("allowance", 0)) <= 0:
		return
	var from := str(unit.get("hex", ""))
	var path: Array = []
	var requested: Variant = selection.get("path")
	if requested is Array and not (requested as Array).is_empty():
		for hex: Variant in requested:
			path.append(str(hex))
	elif selection.get("hex") != null:
		var target := str(selection.hex)
		if target != from and _neighbors(data).get(from, []).has(target):
			path = [target]
	## 与桌面一致：没点邻格（或点的是自己那格）就不出移动行，避免把整圈邻格摊在侧栏。
	if path.is_empty():
		return
	var needs_fuel := Fuel.needs_fuel(unit, side) and not Fuel.has_bulk_fuel(state, unit_id)
	if not needs_fuel and GroundMove.check(state, side, unit_id, path, data).ok:
		var destination := str(path[path.size() - 1])
		menu.append({"label": "移动到 %s" % destination, "group": "移动",
			"actions": [{"type": "ground-move", "unitId": unit_id, "path": path}]})
		return
	if not needs_fuel or not GroundMove.check(state, side, unit_id, path, data, true).ok:
		return
	## OCS 12.5c — 机械面逐枚付 1T：只列该算子真能抽到的油源，行里带 `fuelDumpId`。
	var ledger := SpPayment.new(state, side, data)
	for source: Dictionary in ledger.available([unit]):
		var dump_id := str(source.get("dumpId", ""))
		if int(source.get("tokens", 0)) < Fuel.SINGLE_UNIT_FUEL_COST or not ledger.can_use(unit, dump_id):
			continue
		var tail := dump_id.substr(dump_id.rfind(":") + 1)
		menu.append({"label": "移动到 %s · %s 支付 1T" % [str(path[path.size() - 1]), tail], "group": "移动",
			"actions": [{"type": "ground-move", "unitId": unit_id, "path": path, "fuelDumpId": dump_id}]})
	## OCS 12.5c(C) — 独立单位可以用已加油司令部投送：只列还在投程内、本阶段没换格投过的司令部。
	_append_headquarters_throw_rows(state, side, unit_id, unit, path, ledger, menu)


## 突袭（TTW 2.3a）：选中同格攻方后再点相邻敌格，给出「突袭 X · N 枚 · 3 MP · 堆 支付 T」。
static func _append_overrun_rows(state: Dictionary, side: String, selection: Dictionary,
		data: Dictionary, menu: Array) -> void:
	if not Overrun.window(state, side):
		return
	var ids: Array = []
	if selection.get("unitIds") is Array:
		for id: Variant in selection.unitIds:
			ids.append(str(id))
	elif selection.get("unitId") != null:
		ids = [str(selection.unitId)]
	if ids.is_empty() or selection.get("hex") == null:
		return
	var target := str(selection.hex)
	var checked := Overrun.check(state, side, {"attackers": ids, "target": target}, data)
	if not checked.ok:
		return
	var cost := 0
	for id: String in ids:
		cost += StepLoss.remaining(state.get("units", {}).get(id, {}))
	if cost <= 0:
		return
	var attackers: Array = []
	for id: String in ids:
		attackers.append(state.get("units", {}).get(id, {}))
	var ledger := SpPayment.new(state, side, data)
	for source: Dictionary in ledger.available(attackers):
		if int(source.get("tokens", 0)) < cost:
			continue
		var dump_id := str(source.get("dumpId", ""))
		var payments: Array = []
		for id: String in ids:
			payments.append({"unitId": id, "dumpId": dump_id,
				"tokens": StepLoss.remaining(state.get("units", {}).get(id, {}))})
		menu.append({"label": "突袭 %s · %d 枚 · 3 MP · %s 支付 %dT" % [target, ids.size(),
			_tail(dump_id), cost], "group": "突袭", "actions": [{"type": "declare-overrun",
				"target": target, "attackers": ids, "payments": payments}]})
		break


static func _append_overrun_continue_rows(state: Dictionary, side: String, selection: Dictionary,
		data: Dictionary, menu: Array) -> void:
	var march: Variant = state.get("overrunMarch")
	if not (march is Dictionary) or state.get("combat") != null or state.get("capture") != null:
		return
	var unit_id := _selected_unit_id(selection)
	if unit_id.is_empty() or not (march as Dictionary).get("remaining", {}).has(unit_id):
		return
	var from := str(state.get("units", {}).get(unit_id, {}).get("hex", ""))
	if selection.get("hex") == null:
		return
	var target := str(selection.hex)
	if target == from or not _neighbors(data).get(from, []).has(target):
		return
	var checked := Overrun.continue_check(state, side, {"path": [target]}, data)
	if not checked.ok:
		return
	menu.append({"label": "继续突袭行军到 %s" % target, "group": "突袭",
		"actions": [{"type": "continue-overrun-move", "path": [target]}]})


## TTW 2.3a(B) — 选中轴心步行战斗算子后再点邻格，若整段通过 Kessel 特规校验，额外给一条
## 「Kessel 行军到 X」；普通移动行与它并列，由玩家自己选。
static func _append_kessel_move_rows(state: Dictionary, side: String, selection: Dictionary,
		data: Dictionary, menu: Array) -> void:
	if side != "axis" or str(state.get("cursor", {}).get("phase", "")) != "movement":
		return
	var unit_id := ""
	var ids: Array = selection.get("unitIds", [])
	if selection.get("unitId") != null:
		unit_id = str(selection.unitId)
	elif ids.size() == 1:
		unit_id = str(ids[0])
	if unit_id.is_empty():
		return
	var unit: Dictionary = state.get("units", {}).get(unit_id, {})
	if unit.is_empty() or str(unit.get("side", "")) != side or str(unit.get("mobility", "")) != "leg":
		return
	var headquarters_id := ""
	for slot: Dictionary in Kessel.slots(state, data):
		if not str(slot.get("id", "")).is_empty():
			headquarters_id = str(slot.id)
			break
	if headquarters_id.is_empty():
		return
	var from := str(unit.get("hex", ""))
	var path: Array = []
	var requested: Variant = selection.get("path")
	if requested is Array and not (requested as Array).is_empty():
		for hex: Variant in requested:
			path.append(str(hex))
	elif selection.get("hex") != null:
		var target := str(selection.hex)
		if target != from and _neighbors(data).get(from, []).has(target):
			path = [target]
	if path.is_empty():
		return
	var checked := Kessel.move_check(state, side, {"unitId": unit_id, "headquartersId": headquarters_id,
		"path": path}, data)
	if not checked.ok:
		return
	menu.append({"label": "Kessel 行军到 %s" % str(path[path.size() - 1]), "group": "Kessel",
		"actions": [{"type": "kessel-move", "unitId": unit_id, "headquartersId": headquarters_id,
			"path": path}]})


static func _append_headquarters_throw_rows(state: Dictionary, side: String, unit_id: String, unit: Dictionary,
		path: Array, ledger: RefCounted, menu: Array) -> void:
	if not Fuel.is_independent(unit):
		return
	var cursor: Dictionary = state.get("cursor", {})
	for marker: Variant in state.get("headquartersFuel", []):
		var row: Dictionary = marker
		if str(row.get("side", "")) != side:
			continue
		var hq_id := str(row.get("id", ""))
		var hq: Dictionary = state.get("units", {}).get(hq_id, {})
		if hq.is_empty() or not ledger.in_throw_range(hq_id, str(unit.get("hex", ""))):
			continue
		var used: Variant = row.get("used")
		if used != null and used is Dictionary:
			var same_phase := int((used as Dictionary).get("turn", -1)) == int(cursor.get("turn", -2)) \
				and str((used as Dictionary).get("phasing", "")) == str(cursor.get("phasing", "")) \
				and str((used as Dictionary).get("phase", "")) == str(cursor.get("phase", ""))
			if same_phase and str((used as Dictionary).get("hex", "")) != str(hq.get("hex", "")):
				continue
		menu.append({"label": "移动到 %s · 司令部 %s 投送" % [str(path[path.size() - 1]), _tail(hq_id)], "group": "移动",
			"actions": [{"type": "ground-move", "unitId": unit_id, "path": path, "fuelHeadquartersId": hq_id}]})


## OCS 12.5c — 暂驻运输队给选中算子付 1T（`fuel-from-paused-transport`），以及选中算子所在
## 编队/司令部的批量油（`fuel-formation` / `fuel-headquarters`，4T）。行只列规则层允许的来源，
## 真正扣账仍交给 fuel.gd 复核。
static func _append_transport_fuel_menu(state: Dictionary, side: String, selection: Dictionary,
		data: Dictionary, menu: Array) -> void:
	var phase := str(state.get("cursor", {}).get("phase", ""))
	if not ["movement", "reaction", "exploitation"].has(phase):
		return
	var unit_id := ""
	var ids: Array = selection.get("unitIds", [])
	if selection.get("unitId") != null:
		unit_id = str(selection.unitId)
	elif ids.size() == 1:
		unit_id = str(ids[0])
	if unit_id.is_empty():
		return
	var unit: Dictionary = state.get("units", {}).get(unit_id, {})
	if unit.is_empty() or str(unit.get("side", "")) != side:
		return
	var ledger := SpPayment.new(state, side, data)
	_append_bulk_fuel_rows(state, side, unit_id, unit, ledger, menu)
	if phase != "movement":
		return
	var paused: Variant = state.get("groundActivity", {}).get("transport")
	if paused == null or not paused is Dictionary:
		return
	var transport_id := str((paused as Dictionary).get("unitId", ""))
	if transport_id.is_empty() or unit_id == transport_id:
		return
	if not Fuel.needs_fuel(unit, side) or Fuel.has_bulk_fuel(state, unit_id):
		return
	var transport: Dictionary = state.get("units", {}).get(transport_id, {})
	if transport.is_empty() or str(transport.get("side", "")) != side:
		return
	var source: Dictionary = ledger.source(transport_id)
	if (source.get("truck", {}) as Dictionary).is_empty() or int(source.get("tokens", 0)) < Fuel.SINGLE_UNIT_FUEL_COST:
		return
	var tail := transport_id.substr(transport_id.rfind(":") + 1)
	menu.append({"label": "由暂驻运输队 %s 加油（1T）" % tail, "group": "加油",
		"actions": [{"type": "fuel-from-paused-transport", "unitId": unit_id, "transportId": transport_id}]})


## OCS 13.2c — 普通运输算子可把同格同型的点数重新打包成印值分母。只列空载情形：
## 有货载时怎么分到各盒是玩家选择，规则层已支持带 tokens 的 `repack-transport`，界面不代选。
static func _append_repack_rows(state: Dictionary, side: String, selection: Dictionary, data: Dictionary,
		menu: Array) -> void:
	if not TransportPoints.window(state, side):
		return
	var unit_id := _selected_unit_id(selection)
	if unit_id.is_empty():
		return
	var unit: Dictionary = state.get("units", {}).get(unit_id, {})
	if unit.is_empty() or unit.get("combat") == true or unit.get("organicTruck") != null \
			or unit.get("extender") != null:
		return
	var total := TransportPoints.points(unit, data)
	if total <= 1:
		return
	var cargo := TransportPoints.tokens(unit)
	var catalog: Dictionary = data.get("view", {}).get("catalog", {})
	var denominations: Array = []
	for key: String in catalog.get("definitions", {}):
		var row: Dictionary = catalog.definitions[key]
		if str(row.get("kind", "")) != "transport" or str(row.get("side", "")) != side \
				or (row.get("abilities", []) as Array).has("organic_truck") \
				or int(row.get("transport", 0)) <= 0:
			continue
		var profile_value: Variant = row.get("moveProfile")
		if not profile_value is Dictionary:
			continue
		var profile: Dictionary = profile_value
		if str(profile.get("mobility", "")) != str(unit.get("mobility", "")) \
				or int(profile.get("allowance", 0)) != int(unit.get("allowance", 0)):
			continue
		var denom := int(row.get("transport"))
		if not denominations.has(denom):
			denominations.append(denom)
	if denominations.is_empty():
		return
	denominations.sort()
	denominations.reverse()
	var partitions: Array = []
	_transport_partitions(total, denominations, 0, [], partitions)
	var emitted := 0
	for parts: Array in partitions:
		if parts.size() < 2:
			continue
		var valid := true
		for count: int in parts:
			if TransportPoints.regular_definition(catalog, unit, count).is_empty():
				valid = false
				break
		if not valid:
			continue
		## 货载分到哪几个盒是玩家的选择，侧栏不代选：逐种装法都列成独立条目（上限 24 条）。
		var splits: Array = []
		_transport_token_splits(cargo, parts, 0, [], splits)
		var points_label_parts: Array = []
		for count: int in parts:
			points_label_parts.append(str(count))
		var points_label: String = "+".join(points_label_parts)
		for split: Array in splits:
			var divisions: Array = []
			var load_label: Array = []
			for index in parts.size():
				var load := int(split[index])
				divisions.append({"points": int(parts[index]), "tokens": load})
				load_label.append("%dT" % load)
			var label := "重新打包 %s：%d 点 → %s" % [_tail(unit_id), total, points_label]
			if cargo > 0:
				label += "（%dT 分载：%s）" % [cargo, "+".join(load_label)]
			menu.append({"label": label, "group": "运输",
				"actions": [{"type": "repack-transport", "unitIds": [unit_id], "divisions": divisions}]})
			emitted += 1
			if emitted >= 24:
				return


## 把 `total` 吨货载分到各盒，每盒上限为点数 × 4；生成会按盒序穷举，总数交给规则层复核。
static func _transport_token_splits(total: int, parts: Array, index: int, picked: Array, out: Array) -> void:
	var capacity := int(parts[index]) * 4
	if index == parts.size() - 1:
		if total <= capacity:
			var done: Array = picked.duplicate()
			done.append(total)
			out.append(done)
		return
	for take in range(0, mini(capacity, total) + 1):
		picked.append(take)
		_transport_token_splits(total - take, parts, index + 1, picked, out)
		picked.pop_back()


## 非递增的整数分拆，避免 2+1 与 1+2 重复；上限 8 套由调用方截断。
static func _transport_partitions(remaining: int, denominations: Array, start: int, picked: Array,
		out: Array) -> void:
	if remaining == 0:
		out.append(picked.duplicate())
		return
	for index in range(start, denominations.size()):
		var count: int = int(denominations[index])
		if count > remaining:
			continue
		picked.append(count)
		_transport_partitions(remaining - count, denominations, index, picked, out)
		picked.pop_back()


static func _selected_unit_id(selection: Dictionary) -> String:
	if selection.get("unitId") != null:
		return str(selection.unitId)
	var ids: Array = selection.get("unitIds", [])
	return str(ids[0]) if ids.size() == 1 else ""


static func _append_bulk_fuel_rows(state: Dictionary, side: String, unit_id: String, unit: Dictionary,
		ledger: RefCounted, menu: Array) -> void:
	if not Fuel.bulk_window(state, side):
		return
	var hq_flag: Variant = unit.get("headquarters")
	var hq_id := unit_id if hq_flag is Dictionary or (hq_flag is bool and hq_flag == true) else ""
	var formation := str(unit.get("formation", ""))
	if hq_id.is_empty() and formation.is_empty():
		return
	if not hq_id.is_empty():
		for marker: Variant in state.get("headquartersFuel", []):
			if str((marker as Dictionary).get("id", "")) == hq_id:
				return
		for source: Dictionary in ledger.available([unit]):
			var dump_id := str(source.get("dumpId", ""))
			if int(source.get("tokens", 0)) < Fuel.BULK_FUEL_COST:
				continue
			menu.append({"label": "为司令部 %s 买批量油（4T · %s）" % [ _tail(hq_id), _tail(dump_id) ], "group": "加油",
				"actions": [{"type": "fuel-headquarters", "headquartersId": hq_id,
					"payments": [{"dumpId": dump_id, "tokens": Fuel.BULK_FUEL_COST}]}]})
		return
	for fuel: Variant in state.get("formationFuel", []):
		if str((fuel as Dictionary).get("formation", "")) == formation \
				and str((fuel as Dictionary).get("side", "")) == side:
			return
	var members: Array = []
	for id: String in state.get("units", {}):
		var member: Dictionary = state.units[id]
		if member.get("combat") == true and str(member.get("side", "")) == side \
				and str(member.get("formation", "")) == formation:
			members.append(member)
	if members.is_empty():
		return
	for source: Dictionary in ledger.available(members):
		var dump_id := str(source.get("dumpId", ""))
		if int(source.get("tokens", 0)) < Fuel.BULK_FUEL_COST:
			continue
		menu.append({"label": "为编队 %s 买批量油（4T · %s）" % [formation, _tail(dump_id)], "group": "加油",
			"actions": [{"type": "fuel-formation", "formation": formation,
				"payments": [{"dumpId": dump_id, "tokens": Fuel.BULK_FUEL_COST}]}]})
	## 编队也能由一支司令部投送：不压掉直接抽源，两类都作为合法候选列出，靠文案区分。
	## 全体成员须能经这支司令部抽同一堆油（与规则层 `buy_formation_fuel` 同一判据）。
	for hq_route: String in state.get("units", {}):
		var hq: Dictionary = state.units[hq_route]
		var route_flag: Variant = hq.get("headquarters")
		if str(hq.get("side", "")) != side or not (route_flag is Dictionary or (route_flag is bool and route_flag == true)):
			continue
		for dump_id: String in state.get("dumps", {}):
			var dump: Dictionary = state.dumps[dump_id]
			if str(dump.get("side", "")) != side or int(dump.get("tokens", 0)) < Fuel.BULK_FUEL_COST:
				continue
			var usable := true
			for member: Dictionary in members:
				if not ledger.can_use(member, dump_id, {"headquartersId": hq_route}):
					usable = false
					break
			if usable:
				menu.append({"label": "为编队 %s 买批量油（4T · 司令部 %s 经 %s）" % [formation, _tail(hq_route), _tail(dump_id)],
					"group": "加油", "actions": [{"type": "fuel-formation", "formation": formation,
						"headquartersId": hq_route, "payments": [{"dumpId": dump_id, "tokens": Fuel.BULK_FUEL_COST}]}]})


static func _tail(id: String) -> String:
	return id.substr(id.rfind(":") + 1)


static func _neighbors(data: Dictionary) -> Dictionary:
	var graph: Variant = data.get("view", {}).get("mapGraph", {}).get("neighbors")
	if graph is Dictionary:
		return graph
	return {}


## OCS 9.1 — the attack rows of desktop `engagementChoices`: neighbouring enemy combat hex, one row per
## dump that can pay the unit's remaining steps, plus the internal-stocks row. Artillery and air-base
## barrage stay out until the native barrage table knows facility targets.
static func _append_engage_menu(state: Dictionary, side: String, selection: Dictionary,
		data: Dictionary, menu: Array) -> void:
	var phase := str(state.get("cursor", {}).get("phase", ""))
	if phase != "combat" and phase != "exploitation":
		return
	if str(state.get("turn", {}).get("weather", {}).get("ground", "")) == "thaw":
		return
	var unit_id := ""
	var ids: Array = selection.get("unitIds", [])
	if selection.get("unitId") != null:
		unit_id = str(selection.unitId)
	elif ids.size() == 1:
		unit_id = str(ids[0])
	if unit_id.is_empty() or selection.get("hex") == null:
		return
	var unit: Dictionary = state.get("units", {}).get(unit_id, {})
	if unit.is_empty() or str(unit.get("side", "")) != side or unit.get("attackCapable") != true:
		return
	if (state.get("combatAttackers", []) as Array).has(unit_id):
		return
	var target := str(selection.hex)
	var from := str(unit.get("hex", ""))
	if target == from or not _neighbors(data).get(from, []).has(target):
		return
	var enemy := "soviet" if side == "axis" else "axis"
	var has_target := false
	for id: String in state.get("units", {}):
		var other: Dictionary = state.units[id]
		if str(other.get("side", "")) == enemy and other.get("combat") == true and str(other.get("hex", "")) == target:
			has_target = true
			break
	if not has_target:
		return
	var tokens := int(unit.get("printedRe", 0)) - int(unit.get("stepsLost", 0))
	if tokens <= 0:
		return
	var ledger := SpPayment.new(state, side, data)
	var usable: Array = ledger.available([unit])
	var total := 0
	for source: Dictionary in usable:
		total += int(source.get("tokens", 0))
		if int(source.get("tokens", 0)) < tokens:
			continue
		var dump_id := str(source.get("dumpId", ""))
		if not ledger.can_use(unit, dump_id):
			continue
		var tail := dump_id.substr(dump_id.rfind(":") + 1)
		menu.append({"label": "攻击 %s · %s 支付 %dT" % [target, tail, tokens], "group": "攻击",
			"actions": [{"type": "declare-combat", "target": target, "attackers": [unit_id],
				"payments": [{"unitId": unit_id, "dumpId": dump_id, "tokens": tokens}]}]})
	if str(unit.get("internalStocks", "")) != "exhausted" and total < tokens:
		menu.append({"label": "攻击 %s · 动用部队储备" % target, "group": "攻击",
			"actions": [{"type": "declare-combat", "target": target, "attackers": [unit_id],
				"payments": [], "internalUnitIds": [unit_id]}]})


## 夺取窗口（手动）：临时简化 UI——玩家点一下，按候选顺序把飞机落点与运输队分配填好再提交。
## 正式选点面板待设计；这里只保证窗口不被自动代选、也不卡死。
static func _append_capture_menu(state: Dictionary, side: String, data: Dictionary, menu: Array) -> void:
	var capture: Dictionary = state.capture
	var hex_id := str(capture.get("hex", ""))
	if str(capture.get("owner", "")) != side:
		var owner_label: String = SIDE_NAMES.get(str(capture.get("owner", "")), str(capture.get("owner", "")))
		menu.append({"label": "等待%s安排夺取位移 %s" % [owner_label, hex_id], "group": "位移",
			"actions": []})
		return
	var order := Capture.automatic_order(capture, state, data)
	if order.has("error"):
		menu.append({"label": "夺取位移 %s · 需人工分配（面板待设计）" % hex_id, "group": "位移",
			"actions": []})
		return
	var aircraft: Array = capture.get("aircraft", [])
	var groups: Array = capture.get("transports", [])
	var flexible: Array = []
	var complete := true
	for entry: Dictionary in aircraft:
		if (entry.get("destinations", []) as Array).is_empty():
			complete = false
		if (entry.get("destinations", []) as Array).size() > 1:
			flexible.append(entry)
	# 需要选落点的飞机组合不多时，把每种组合各列一行，玩家点哪行就按哪套落点安置。
	if complete and groups.is_empty() and (capture.get("extenders", []) as Array).is_empty() and not flexible.is_empty():
		var combos: Array = []
		_capture_combinations(aircraft, 0, [], combos, 8)
		if combos.size() <= 8:
			var flexible_ids: Array = []
			for entry: Dictionary in flexible:
				flexible_ids.append(str(entry.get("id", "")))
			for combo: Array in combos:
				var parts: Array = []
				for row: Dictionary in combo:
					if not flexible_ids.has(str(row.get("id", ""))):
						continue
					var tail := str(row.get("id", "")).substr(str(row.get("id", "")).rfind(":") + 1)
					parts.append("%s → %s" % [tail, _destination_name(row.get("destination", {}) as Dictionary)])
				menu.append({"label": "安置夺取飞机 %s" % " · ".join(parts), "group": "位移",
					"actions": [{"type": "settle-capture", "aircraft": combo, "transports": []}]})
			return
	var filled: Array = order.get("aircraft", [])
	var transports: Array = order.get("transports", [])
	var summary := "%d 枚飞机、%d 支运输队" % [filled.size(), transports.size()]
	menu.append({"label": "安排夺取位移 %s · 按候选顺序填好（%s）" % [hex_id, summary], "group": "位移",
		"actions": [{"type": "settle-capture", "aircraft": filled, "transports": transports}]})


static func _capture_combinations(entries: Array, index: int, picked: Array, out: Array, limit: int) -> void:
	if out.size() > limit:
		return
	if index >= entries.size():
		out.append(picked.duplicate(true))
		return
	var entry: Dictionary = entries[index]
	for target: Variant in entry.get("destinations", []):
		picked.append({"id": str(entry.get("id", "")), "destination": target})
		_capture_combinations(entries, index + 1, picked, out, limit)
		picked.pop_back()


static func _destination_name(target: Dictionary) -> String:
	if str(target.get("kind", "")) == "hex":
		return str(target.get("hex", ""))
	return "地图外"


## OCS 13.3 — 工事作业（构筑 8T / 拆除 0T）：worker 由当前选中的静止战斗单位承担，
## 目标格取选中格，缺省取 worker 所在格；补给源只列能同时供所有 worker 追溯的那些。
static func _append_hedgehog_menu(state: Dictionary, side: String, selection: Dictionary,
		data: Dictionary, menu: Array) -> void:
	var cursor: Dictionary = state.get("cursor", {})
	if str(cursor.get("phase", "")) != "movement" or str(cursor.get("phasing", "")) != side:
		return
	var ids: Array = selection.get("unitIds", [])
	if ids.is_empty() and selection.get("unitId") != null:
		ids = [selection.get("unitId")]
	var units: Dictionary = state.get("units", {})
	var moved: Array = state.get("moved", [])
	var workers: Array = []
	var worker_ids: Array = []
	for entry: Variant in ids:
		var id := str(entry)
		var unit: Dictionary = units.get(id, {})
		if unit.is_empty() or str(unit.get("side", "")) != side:
			continue
		if unit.get("combat") != true or unit.get("moveMode") == true:
			continue
		if unit.get("reserve") != null or unit.get("exploit") != null or unit.get("disorganized") == true:
			continue
		if moved.has(id):
			continue
		workers.append(unit)
		worker_ids.append(id)
	if workers.is_empty():
		return
	var hex_id := str(selection.get("hex", workers[0].get("hex", "")))
	if hex_id.is_empty():
		return
	var entry: Variant = state.get("hedgehogs", {}).get(hex_id)
	var level_now := Hedgehogs.level(state, hex_id)
	if entry != null and str(entry.get("side", "")) != side:
		return
	if entry == null and level_now > 0:
		return
	if level_now < 2:
		var ledger := SpPayment.new(state, side, data)
		_append_hedgehog_build_rows(menu, hex_id, worker_ids, ledger.available(workers))
	if level_now > 0:
		menu.append({"label": "拆除工事 · 格 %s" % hex_id, "group": "工事",
			"actions": [{"type": "work-hedgehog", "operation": "reduce", "hex": hex_id,
				"unitIds": worker_ids, "payments": []}]})


## OCS 13.2c — 8T 可以从多个补给堆拼：先枚单一来源，再列至多三源的组合，
## 每条只带真实存在的 Token 份额；规则层仍按 `payments` 总额复核。
static func _append_hedgehog_build_rows(menu: Array, hex_id: String, worker_ids: Array, sources: Array) -> void:
	var usable: Array = []
	for source: Dictionary in sources:
		if int(source.get("tokens", 0)) > 0:
			usable.append(source)
	if usable.is_empty():
		return
	var subsets: Array = []
	_hedgehog_subsets(usable, 3, subsets)
	var seen := {}
	var emitted := 0
	for subset: Array in subsets:
		var plan := _hedgehog_plan(subset, 8)
		if plan.is_empty():
			continue
		var signature := ""
		var labels: Array = []
		for payment: Dictionary in plan:
			signature += "%s:%d|" % [str(payment.dumpId), int(payment.tokens)]
			labels.append("%s %dT" % [_tail(str(payment.dumpId)), int(payment.tokens)])
		if seen.has(signature):
			continue
		seen[signature] = true
		menu.append({"label": "构筑工事 · 格 %s（8T · %s）" % [hex_id, " + ".join(labels)], "group": "工事",
			"actions": [{"type": "work-hedgehog", "operation": "build", "hex": hex_id,
				"unitIds": worker_ids, "payments": plan}]})
		emitted += 1
		if emitted >= 8:
			return


## 按来源数分层列出组合：先单源，再多源；首行总是最省事的单堆支付。
static func _hedgehog_subsets(sources: Array, max_sources: int, out: Array) -> void:
	var count := sources.size()
	for first in range(count):
		out.append([sources[first]])
	if max_sources >= 2:
		for first in range(count):
			for second in range(first + 1, count):
				out.append([sources[first], sources[second]])
	if max_sources >= 3:
		for first in range(count):
			for second in range(first + 1, count):
				for third in range(second + 1, count):
					out.append([sources[first], sources[second], sources[third]])


## 从选中的来源里按顺序取到恰好 8T；单源够付时自然只留一笔。
static func _hedgehog_plan(subset: Array, total: int) -> Array:
	var plan: Array = []
	var left := total
	for source: Dictionary in subset:
		var take := mini(int(source.get("tokens", 0)), left)
		if take <= 0:
			continue
		plan.append({"dumpId": str(source.get("dumpId", "")), "tokens": take})
		left -= take
		if left == 0:
			return plan
	return []


static func _append_combat_menu(state: Dictionary, side: String, data: Dictionary, menu: Array) -> void:
	var combat: Variant = state.get("combat")
	if combat == null or not combat is Dictionary:
		return
	var decision: Dictionary = Combat.decision(combat)
	if decision.is_empty() or str(decision.get("actor", "")) != side:
		return
	var waiting: Variant = state.get("pendingCombat")
	if waiting is Dictionary:
		if str(waiting.get("actor", "")) != side:
			return
		var request: Dictionary = waiting.get("pending", {})
		var division := str(request.get("divisionId", ""))
		for hex: String in request.get("candidates", []):
			var stored: Dictionary = waiting.get("action", {})
			var action: Dictionary = stored.duplicate(true)
			var remnants: Array = action.get("remnants", []).duplicate(true)
			remnants.append({"divisionId": division, "hex": hex})
			action["remnants"] = remnants
			menu.append({"label": "残部 %s → %s" % [_unit_name(state, division, data), hex],
				"group": "地面战斗", "actions": [action]})
		return
	var retreat_waiting: Variant = state.get("pendingRetreat")
	if retreat_waiting is Dictionary:
		if str(retreat_waiting.get("actor", "")) != side:
			return
		_append_retreat_pending(retreat_waiting, state, data, menu)
		return
	var action_type := str(decision.get("actionType", ""))
	var attacker := str(combat.get("attacker", ""))
	var involved: Array = combat.get("attackers", []) if side == attacker else combat.get("defenders", [])
	match action_type:
		"defend-combat":
			menu.append({"label": "守方免付战斗补给", "group": "地面战斗",
				"actions": [{"type": "defend-combat", "payments": [], "internalUnitIds": []}]})
		"select-combat-rating":
			for id: String in involved:
				menu.append({"label": "用 %s 的行动值" % _unit_name(state, id, data), "group": "地面战斗",
					"actions": [{"type": "select-combat-rating", "unitId": id}]})
		"choose-combat-terrain":
			var target := str(combat.get("target", ""))
			var terrains: Array = data.view.get("mapGraph", {}).get("terrains", {}).get(target, [])
			for terrain: String in terrains:
				var attacking := {}
				for id: String in combat.get("attackers", []):
					var origin: Variant = state.get("units", {}).get(id, {}).get("hex")
					if origin != null:
						attacking[str(origin)] = terrain
				menu.append({"label": "选择%s，结算奇袭与战斗" % _terrain_name(terrain), "group": "地面战斗",
					"actions": [{"type": "choose-combat-terrain", "terrain": terrain, "attackingTerrain": attacking}]})
		"resolve-combat":
			var options: Array = CombatResult.resolve_options(state, side, data)
			for option: Dictionary in options:
				menu.append({"label": _combat_result_label(state, option, data), "group": "地面战斗",
					"actions": [option.action]})
		"advance-after-combat":
			menu.append({"label": "放弃战后推进", "group": "地面战斗",
				"actions": [{"type": "advance-after-combat", "unitIds": []}]})
			for id: String in combat.get("attackers", []):
				if state.get("units", {}).has(id):
					menu.append({"label": "推进 1 枚 · %s" % _unit_name(state, id, data), "group": "地面战斗",
						"actions": [{"type": "advance-after-combat", "unitIds": [id]}]})
					# OCS 20.0a 第二窗口：该攻方可在推进前拆出，拆分单位随同进格。
					for option: Dictionary in Breakdown.advance_options(state, side, id, data,
							combat.get("attackers", [])):
						menu.append({"label": "推进并拆出 %s · %s" % [str(option.name),
							_unit_name(state, id, data)], "group": "地面战斗",
							"actions": [{"type": "advance-after-combat", "unitIds": [id],
								"breakdowns": [{"parentId": id, "definitions": [str(option.definition)]}]}]})
		"continue-combat-retreat":
			menu.append({"label": "继续撤退 · 原地续跑", "group": "地面战斗",
				"actions": [{"type": "continue-combat-retreat"}]})


## 待决撤退：先列完整路线；选定后若格内需要 ZOC 损步/残部落点，再列对应单位或落点。
static func _append_retreat_pending(waiting: Dictionary, state: Dictionary, data: Dictionary, menu: Array) -> void:
	var request: Dictionary = waiting.get("pending", {})
	var stored: Dictionary = waiting.get("action", {})
	var kind := str(request.get("kind", ""))
	if kind == "retreat-route":
		var units: Array = request.get("units", [])
		for path: Array in request.get("options", []):
			var action: Dictionary = stored.duplicate(true)
			action["retreats"] = [{"group": "group:0", "units": units.duplicate(),
				"path": path.duplicate()}]
			menu.append({"label": "撤退 %d 格 → %s" % [int(request.get("distance", path.size())),
				str(path[-1] if path.size() > 0 else "")],
				"group": "地面战斗", "actions": [action]})
		return
	var step := int(request.get("step", 0))
	var group := str(request.get("group", ""))
	if kind == "retreat-zoc-loss":
		for id: String in request.get("candidates", []):
			var action := _with_retreat_choice(stored, group, step, "zocLosses", str(id))
			if action.is_empty():
				continue
			menu.append({"label": "ZOC 被迫损 %s · %s" % [_unit_name(state, id, data),
				str(request.get("hex", ""))], "group": "地面战斗", "actions": [action]})
		return
	if kind == "retreat-remnant":
		var division := str(request.get("divisionId", ""))
		for hex: String in request.get("candidates", []):
			var action := _with_retreat_choice(stored, group, step, "remnantHexes", hex)
			if action.is_empty():
				continue
			menu.append({"label": "撤退残部 %s → %s" % [_unit_name(state, division, data), hex],
				"group": "地面战斗", "actions": [action]})


## 复制原命令，只改指定撤退堆在该步的选择；组/步不存在时返回空字典。
static func _with_retreat_choice(stored: Dictionary, group: String, step: int,
		field: String, value: String) -> Dictionary:
	var action: Dictionary = stored.duplicate(true)
	var routes: Array = action.get("retreats", [])
	for index: int in routes.size():
		var route: Dictionary = routes[index]
		if str(route.get("group", "")) != group:
			continue
		var merged: Dictionary = route.duplicate(true)
		var choices: Dictionary = merged.get(field, {}).duplicate(true)
		choices[str(step)] = value
		merged[field] = choices
		routes[index] = merged
		action["retreats"] = routes
		return action
	return {}


## 战果行的可读摘要：损失步数、可选损失、后撤距离，以及会被消灭的师与其残部落点。
static func _combat_result_label(state: Dictionary, entry: Dictionary, data: Dictionary) -> String:
	var parts: Array = []
	var losses := int(entry.get("totalLosses", 0))
	if losses > 0:
		parts.append("结算 %d 步" % losses)
	else:
		parts.append("结算无损失")
	if int(entry.get("optionLosses", 0)) > 0:
		parts.append("含 %d 可选" % int(entry.get("optionLosses", 0)))
	if entry.get("ignore", false) == true:
		parts.append("忽略选项")
	if int(entry.get("retreatDistance", 0)) > 0:
		parts.append("后撤 %d 格" % int(entry.get("retreatDistance", 0)))
	var doomed: Array = entry.get("remnantsFor", [])
	if not doomed.is_empty():
		var remnants: Array = entry.get("remnants", [])
		var segments: Array = []
		for id: String in doomed:
			var hex := ""
			for remnant: Dictionary in remnants:
				if str(remnant.get("divisionId", "")) == id:
					hex = str(remnant.get("hex", ""))
					break
			var segment := _unit_name(state, id, data)
			if hex != "":
				segment += "→" + hex
			segments.append(segment)
		parts.append("残部 " + "、".join(segments))
	return " · ".join(parts)


static func _append_barrage_menu(state: Dictionary, side: String, selection: Dictionary, data: Dictionary, menu: Array) -> void:
	var barrage: Variant = state.get("barrage")
	if barrage != null and barrage is Dictionary:
		_append_barrage_reply_menu(state, side, barrage, data, menu)
	_append_barrage_declare_menu(state, side, selection, data, menu)


static func _append_barrage_reply_menu(state: Dictionary, side: String, barrage: Dictionary, data: Dictionary, menu: Array) -> void:
	if str(barrage.get("defender", "")) != side:
		return
	var target := str(barrage.get("target", ""))
	if barrage.get("roll") == null:
		var terrains: Array = data.view.get("mapGraph", {}).get("terrains", {}).get(target, [])
		for terrain: String in terrains:
			menu.append({"label": "以%s结算射击" % _terrain_name(terrain), "group": "射击",
				"actions": [{"type": "choose-barrage-terrain", "terrain": terrain}]})
		return
	var candidates: Array = []
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.get("units", {}).get(id, {})
		if unit.get("combat") == true and str(unit.get("side", "")) == side and str(unit.get("hex", "")) == target:
			candidates.append(id)
	var losses_due := int(barrage.get("lossesDue", 0))
	for preferred: String in candidates:
		var order: Array = [preferred]
		for other: String in candidates:
			if other != preferred:
				order.append(other)
		var left := losses_due
		var allocation: Array = []
		for id: String in order:
			if left <= 0:
				break
			var remaining := StepLoss.remaining(state.get("units", {}).get(id, {}))
			var steps: int = mini(left, remaining)
			if steps > 0:
				allocation.append({"unitId": id, "steps": steps})
				left -= steps
		if left <= 0:
			menu.append({"label": "分配 %d 步射击损失 · 优先 %s" % [losses_due, _unit_name(state, preferred, data)],
				"group": "射击", "actions": [{"type": "assign-barrage-loss", "allocation": allocation}]})


static func _append_barrage_declare_menu(state: Dictionary, side: String, selection: Dictionary, data: Dictionary, menu: Array) -> void:
	var target := str(selection.get("hex", ""))
	if target.is_empty():
		return
	var batteries: Array = []
	for id: String in state.get("units", {}):
		var unit: Dictionary = state.get("units", {}).get(id, {})
		if str(unit.get("side", "")) != side:
			continue
		var art: Variant = unit.get("artillery")
		if not art is Dictionary:
			continue
		var preview := Barrage.volley_preview(state, side, {"target": target, "batteries": [{"unitId": id}]}, data)
		if preview.get("ok", false) == true:
			batteries.append({"unitId": id})
	if batteries.is_empty():
		return
	var battery_units: Array = []
	for battery: Dictionary in batteries:
		battery_units.append(state.get("units", {}).get(str(battery.get("unitId", "")), {}))
	## 费用按整轮齐射的强度列决定，单门预演可能落在更低的列；支付也必须由同一堆供应全部炮组。
	var volley := Barrage.volley_preview(state, side, {"target": target, "batteries": batteries}, data)
	if volley.get("ok", false) != true:
		return
	var resolved: Dictionary = volley.value
	var cost := int(resolved.get("cost", 0))
	var fired: Array = resolved.get("batteries", [])
	var payments: Array = []
	var ledger := SpPayment.new(state, side, data)
	var fired_batteries: Array = fired if not fired.is_empty() else batteries
	if cost > 0:
		var picked := ""
		for source: Dictionary in ledger.available(battery_units):
			if int(source.get("tokens", 0)) >= cost:
				picked = str(source.get("dumpId", ""))
				break
		if picked.is_empty():
			## 直接抽源不行时仍可由一支共同司令部投送：全体炮组须能经同一支司令部抽同一堆。
			var hq_rows := _barrage_headquarters_rows(state, side, target, fired_batteries, battery_units, ledger, cost)
			if hq_rows.is_empty():
				return
			for row: Dictionary in hq_rows:
				menu.append(row)
			return
		payments.append({"dumpId": str(picked), "tokens": cost})
	menu.append({"label": "炮击 %s · %d 门 · %dT" % [target, batteries.size(), cost], "group": "射击",
		"actions": [{"type": "declare-artillery-barrage", "target": target,
			"batteries": fired_batteries,
			"supply": {"kind": "direct", "payments": payments}}]})
	if cost > 0:
		for row: Dictionary in _barrage_headquarters_rows(state, side, target, fired_batteries, battery_units,
				ledger, cost):
			menu.append(row)


## OCS 12.6 / 5.11 — 多方炮组可经同一支司令部抽同一堆补给支付；逐 (HQ, 堆) 组合列一行，
## 规则层仍按 `kind:"hq"` + `hqId` 复核全体炮组的投送关系。最多 6 行，避免侧栏过长。
static func _barrage_headquarters_rows(state: Dictionary, side: String, target: String, batteries: Array,
		battery_units: Array, ledger: RefCounted, cost: int) -> Array:
	var rows: Array = []
	for hq_id: String in state.get("units", {}):
		var hq: Dictionary = state.units[hq_id]
		var flag: Variant = hq.get("headquarters")
		if str(hq.get("side", "")) != side or not (flag is Dictionary or (flag is bool and flag == true)):
			continue
		for dump_id: String in state.get("dumps", {}):
			var dump: Dictionary = state.dumps[dump_id]
			if str(dump.get("side", "")) != side or int(dump.get("tokens", 0)) < cost:
				continue
			var usable := true
			for battery: Dictionary in battery_units:
				if not ledger.can_use(battery, dump_id, {"headquartersId": hq_id}):
					usable = false
					break
			if not usable:
				continue
			rows.append({"label": "炮击 %s · 司令部 %s 经 %s（%dT）" % [target, _tail(hq_id), _tail(dump_id), cost],
				"group": "射击", "actions": [{"type": "declare-artillery-barrage", "target": target,
					"batteries": batteries, "supply": {"kind": "hq", "hqId": hq_id,
						"payments": [{"dumpId": dump_id, "tokens": cost}]}}]})
			if rows.size() >= 6:
				return rows
	return rows


static func _terrain_name(terrain: String) -> String:
	var names := {
		"Open": "开阔地", "Village": "村庄", "Minor City": "小城市", "Major City": "大城市",
		"Hills": "丘陵", "Woods": "疏林", "Forest": "密林", "Rough": "崎岖地",
		"Mountain": "山地", "Swamp": "沼泽",
	}
	return str(names.get(terrain, terrain))
