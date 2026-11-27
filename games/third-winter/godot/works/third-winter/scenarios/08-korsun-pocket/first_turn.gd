extends RefCounted


## TTW S08 p.53 — 开局天气、首位玩家和重掷持有方。
static func start(opening: Dictionary, deployment: Dictionary) -> Dictionary:
	var control: Dictionary = deployment.frontControl.duplicate()
	# TTW S08 pp.54–55 — 在指定控制点上，实际初设位置覆盖开局战线。
	for unit: Dictionary in opening.units.values():
		if unit.hex in deployment.controlSites:
			control[unit.hex] = unit.side
	var state := {
		"kind": "playing",
		"turn": {
			"number": 1, "weather": {"ground": "freeze", "flight": "limited"},
			"thawSeen": false, "vp": 0,
			"step": {"kind": "player-turn", "first": "soviet", "retention": "soviet"},
		},
		# OCS v4.3 §2.2 — 玩家回合从飞机整备开始。
		"cursor": {"turn": 1, "first": "soviet", "phasing": "soviet", "phase": "aircraft-refit", "retention": "soviet"},
		"rng": opening.rng,
		"rerollHolder": "soviet",
		"airBases": deployment.airBases.duplicate(true),
		"units": opening.units,
		"pieces": opening.pieces,
		"moved": [],
		"supply": null,
		"railControl": control,
		"combat": null,
		"combatTargets": [],
		"combatAttackers": [],
		"dumps": opening.dumps,
		"arrival": {"placed": [], "mobilized": [], "sovietVp": 0},
		"arrivalsOnMap": [],
		"window": null,
		"pax": {"axis": 0, "soviet": 0},
		"availableAlerts": opening.availableAlerts,
		"placedAlerts": [],
		"victory": null,
	}
	if opening.get("dropPlan") != null:
		state.dropPlan = opening.dropPlan
	return state
