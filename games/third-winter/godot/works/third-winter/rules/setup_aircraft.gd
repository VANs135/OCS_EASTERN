extends RefCounted

const Airbase := preload("res://scripts/rules/series/airbase.gd")
const Result := preload("res://scripts/core/result.gd")


# pieces 属于命令事务的候选盘面。
static func place(pieces: Array, actor: String, id: Variant, base: Dictionary, bases: Array) -> Dictionary:
	var aircraft: Dictionary = {}
	for piece: Dictionary in pieces:
		if piece.id == id:
			aircraft = piece
			break
	if aircraft.is_empty() or aircraft.side != actor or aircraft.kind != "aircraft" or aircraft.location.kind == "dead-pile":
		return Result.failure("invalid_aircraft", "请选择本方可部署的飞机")
	if base.kind == "off-map-air":
		aircraft.location = {"kind": "off-map-air"}
		return Result.success({})
	for airbase: Dictionary in bases:
		if airbase.side != actor or airbase.hex != base.hex:
			continue
		# OCS v4.3 初设说明 E、§14.2a — 开局飞机活跃，受机场容量约束。
		var occupied := 0
		for piece: Dictionary in pieces:
			if piece.id != aircraft.id and piece.location.kind == "hex" and piece.location.hex == base.hex:
				occupied += 1
		if occupied >= Airbase.active_capacity(airbase.level):
			return Result.failure("airbase_overstack", "机场活跃飞机已达容量上限")
		aircraft.location = {"kind": "hex", "hex": base.hex}
		return Result.success({})
	return Result.failure("invalid_airbase", "请选择本方机场")
