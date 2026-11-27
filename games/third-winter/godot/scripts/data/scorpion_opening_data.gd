extends RefCounted

const JsonFile := preload("res://scripts/data/json_file.gd")
const Result := preload("res://scripts/core/result.gd")


static func read(path: String) -> Dictionary:
	var result := JsonFile.read(path)
	if not result.ok:
		return result
	var document: Variant = result.value.document
	if not document is Dictionary or document.get("version") != 1 or document.get("workId") != "third-winter" \
			or document.get("scenarioId") != "08-korsun-pocket" or document.get("rulesVersion") != "4.3":
		return Result.failure("opening_data_version", "08 初设数据的剧本或版本不符")
	var fingerprint: Variant = document.get("fingerprint")
	var hex_ids: Variant = document.get("hexIds")
	var opening: Variant = document.get("opening")
	if not fingerprint is String or fingerprint.length() != 64 or not fingerprint.is_valid_hex_number(false) \
			or not hex_ids is Array or hex_ids.is_empty() or not opening is Dictionary:
		return Result.failure("opening_data_shape", "08 初设数据缺少有效指纹、格网或初设")
	var hexes: Dictionary = {}
	for hex: Variant in hex_ids:
		if not hex is String or hex.is_empty() or hexes.has(hex):
			return Result.failure("opening_data_hex", "08 初设格网含有空值或重复格号")
		hexes[hex] = true
	for key: String in ["units", "dumps"]:
		if not opening.get(key) is Dictionary:
			return Result.failure("opening_data_shape", "08 初设缺少 %s" % key)
	for key: String in ["pieces", "lossChoices", "pool"]:
		if not opening.get(key) is Array:
			return Result.failure("opening_data_shape", "08 初设缺少 %s" % key)
	for unit: Variant in opening.units.values():
		if not unit is Dictionary or not hexes.has(unit.get("hex")):
			return Result.failure("opening_data_unit_hex", "08 初设地面算子引用了无效格号")
	if document.has("deployment") and not _valid_deployment(document.deployment, opening, hexes):
		return Result.failure("opening_deployment_shape", "08 部署数据的机场、Alert 档案或控制点引用无效")
	return Result.success(document)


static func _valid_deployment(data: Variant, opening: Dictionary, hexes: Dictionary) -> bool:
	if not data is Dictionary or not data.get("airBases") is Array or not data.get("alertProfiles") is Dictionary \
			or not data.get("controlSites") is Array or not data.get("frontControl") is Dictionary:
		return false
	var bases: Dictionary = {}
	for base: Variant in data.airBases:
		if not base is Dictionary or not hexes.has(base.get("hex")) or bases.has(base.hex) \
				or base.get("side") not in ["axis", "soviet"] or not base.get("level") is int or base.level not in [1, 2, 3]:
			return false
		bases[base.hex] = true
	for alert: Variant in opening.pool:
		if not alert is Dictionary or not alert.get("definition") is String:
			return false
		var profile: Variant = data.alertProfiles.get(alert.definition)
		if not profile is Dictionary or profile.get("definition") != alert.definition or profile.get("side") != "axis" \
				or not (profile.get("printedRe") is int or profile.get("printedRe") is float) or profile.get("stepsLost") != 0:
			return false
	for hex: Variant in data.controlSites:
		if not hex is String or not hexes.has(hex):
			return false
	for hex: String in data.frontControl:
		if not hexes.has(hex) or data.frontControl[hex] not in ["axis", "soviet"]:
			return false
	return true
