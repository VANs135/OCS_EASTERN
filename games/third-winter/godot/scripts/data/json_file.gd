extends RefCounted

const Result := preload("res://scripts/core/result.gd")
const MAX_SAFE_INTEGER := 9007199254740991


static func read(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return Result.failure("data_file_unavailable", "无法读取 %s" % path)
	var json := JSON.new()
	if json.parse(file.get_as_text()) != OK:
		return Result.failure("invalid_json", "%s 第 %d 行：%s" % [path, json.get_error_line(), json.get_error_message()])
	return Result.success({"document": _normalize_numbers(json.data)})


static func _normalize_numbers(value: Variant) -> Variant:
	if value is Dictionary:
		for key: String in value:
			value[key] = _normalize_numbers(value[key])
	elif value is Array:
		for index in value.size():
			value[index] = _normalize_numbers(value[index])
	elif value is float and absf(value) <= MAX_SAFE_INTEGER and value == floorf(value):
		return int(value)
	return value
