extends RefCounted

## 08 初设数据包目录切片断言：counters/faces 覆盖、逐面模板标志与定义自洽。
## 由 tests/runner.gd 自动发现；ctx.args[0] 为 08 数据包路径。

const JsonFile := preload("res://scripts/data/json_file.gd")


static func run(ctx: Dictionary) -> void:
	var expect: Callable = ctx.expect
	var compare: Callable = ctx.compare
	var args: Array = ctx.args
	if args.is_empty():
		expect.call(false, "opening_data 用例传入 08 数据包路径")
		return
	var read := JsonFile.read(args[0])
	expect.call(read.ok, "08 初设数据可读 · %s" % args[0])
	if not read.ok:
		return
	var bundle: Dictionary = read.value.document
	var catalog: Dictionary = bundle.view.get("catalog", {})
	var definitions: Dictionary = catalog.get("definitions", {})
	var counters: Dictionary = catalog.get("counters", {})
	var faces: Dictionary = catalog.get("faces", {})
	var opening: Dictionary = bundle.opening

	# 在盘单位、死人堆算子、开局 Alert 池引用到的全部 definition。飞机、标记与编队标题
	# 没有地面 counter 模板，覆盖断言只针对 land/hq/transport。
	var referenced: Dictionary = {}
	for unit: Dictionary in opening.units.values():
		referenced[unit.get("definition", "")] = true
	for piece: Dictionary in opening.pieces:
		referenced[piece.get("definition", "")] = true
	for alert: Dictionary in opening.pool:
		referenced[alert.get("definition", "")] = true
	referenced.erase("")
	var ground_kinds := ["land", "hq", "transport"]

	# 1. 上述地面 definition 必须同时进入 counters 与 faces。
	var missing_counters: Array = []
	var missing_faces: Array = []
	for id: String in referenced:
		var def_kind: Variant = definitions.get(id, {}).get("kind")
		if not ground_kinds.has(def_kind):
			continue
		if not counters.has(id):
			missing_counters.append(id)
		if not faces.has(id):
			missing_faces.append(id)
	expect.call(missing_counters.is_empty(), "在盘/死人堆/Alert 定义全部进入 counters · 缺 %s" % [missing_counters.slice(0, 3)])
	expect.call(missing_faces.is_empty(), "在盘/死人堆/Alert 定义全部进入 faces · 缺 %s" % [missing_faces.slice(0, 3)])

	# 2. 逐面模板标志：战斗面 moveMode 为 false（缺省即 false），移动面 moveMode 为 true。
	var bad_combat: Array = []
	var bad_move: Array = []
	for id: String in counters:
		var face: Dictionary = faces.get(id, {})
		var combat: Variant = face.get("combat")
		var move: Variant = face.get("move")
		if combat is Dictionary and combat.get("moveMode", false) != false:
			bad_combat.append(id)
		if move is Dictionary and move.get("moveMode") != true:
			bad_move.append(id)
	expect.call(bad_combat.is_empty(), "战斗面模板 moveMode 为 false · 异常 %s" % [bad_combat.slice(0, 3)])
	expect.call(bad_move.is_empty(), "移动面模板 moveMode 为 true · 异常 %s" % [bad_move.slice(0, 3)])

	# 3. 盘上缺口 land:id:3951 现在能在 counters 与 faces 查到。
	expect.call(counters.has("land:id:3951"), "盘上 land:id:3951 进入 counters")
	expect.call(faces.has("land:id:3951"), "盘上 land:id:3951 进入 faces")

	# 4. counters 模板与 faces.combat 是同一份战斗面投影。
	var counter_mismatch: Array = []
	for id: String in counters:
		if JSON.stringify(counters[id]) != JSON.stringify(faces.get(id, {}).get("combat")):
			counter_mismatch.append(id)
	expect.call(counter_mismatch.is_empty(), "counters 与 faces.combat 模板一致 · 异常 %s" % [counter_mismatch.slice(0, 3)])

	# 5. 抽查 ≥20 个定义：faces.combat 与 definitions 的 re/abilities/印刷 profile 自洽。
	var sample_ids: Array = counters.keys()
	sample_ids.sort()
	var checked := 0
	var mismatches: Array = []
	for id: String in sample_ids:
		if checked >= 20:
			break
		var def: Dictionary = definitions.get(id, {})
		var combat: Dictionary = faces[id].get("combat", {})
		checked += 1
		if int(combat.get("printedRe", -1)) != int(def.get("re", -1)):
			mismatches.append("%s RE" % id)
		if not (def.get("abilities", []) is Array):
			mismatches.append("%s abilities" % id)
		var profile: Variant = def.get("moveProfile")
		if profile is Dictionary:
			if int(profile.get("allowance", -1)) != int(combat.get("allowance", -1)):
				mismatches.append("%s allowance" % id)
			if str(profile.get("mobility")) != str(combat.get("mobility")):
				mismatches.append("%s mobility" % id)
		var strength: int = int(combat.get("strength", -1))
		if strength < 0 or strength > 30:
			mismatches.append("%s strength=%d" % [id, strength])
	expect.call(checked >= 20, "抽查定义不少于 20 个（%d）" % checked)
	expect.call(mismatches.is_empty(), "faces.combat 与定义自洽 · 异常 %s" % [mismatches.slice(0, 5)])

	# 6. 有移动面的定义，faces.move 与 definitions.moveFaceProfile 一致；无移动面者 move 为 null。
	var move_mismatch: Array = []
	var move_checked := 0
	for id: String in counters:
		var def: Dictionary = definitions.get(id, {})
		var move: Variant = faces[id].get("move")
		var printed: Variant = def.get("moveFaceProfile")
		if move == null:
			continue
		move_checked += 1
		if printed is Dictionary:
			if int(printed.get("allowance", -1)) != int(move.get("allowance", -1)):
				move_mismatch.append("%s move allowance" % id)
			if str(printed.get("mobility")) != str(move.get("mobility")):
				move_mismatch.append("%s move mobility" % id)
	expect.call(move_checked > 0, "存在可核对的移动面模板（%d）" % move_checked)
	expect.call(move_mismatch.is_empty(), "faces.move 与移动面 profile 自洽 · 异常 %s" % [move_mismatch.slice(0, 5)])
