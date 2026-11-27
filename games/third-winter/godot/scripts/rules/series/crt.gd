extends RefCounted

## CRT 取表（OCS 9.9）。
## 移植自 packages/series/src/tables/crt.ts 与 packages/series/src/tables/lookup.ts。
## 表默认读 dist/ocs-v43-crt.json，可用环境变量 OCS_V43_CRT 覆盖（同 TS loadLocalScorpion 口径）。
## 取表失败返回 Result.failure 风格字典，不抛崩溃。

const Result := preload("res://scripts/core/result.gd")

const DEFAULT_TABLE_REL := "../../../dist/ocs-v43-crt.json"


## 默认表路径：环境变量优先，否则按工程目录上溯到 dist/ocs-v43-crt.json。
static func default_table_path() -> String:
	var env: String = OS.get_environment("OCS_V43_CRT")
	if not env.is_empty() and FileAccess.file_exists(env):
		return env
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	return (base + "/" + DEFAULT_TABLE_REL).simplify_path()


## 读取并解析 CRT 表；返回 Result.success(表字典) 或 Result.failure。
static func load_table(path: String = "") -> Dictionary:
	var resolved: String = path if not path.is_empty() else default_table_path()
	if not FileAccess.file_exists(resolved):
		return Result.failure("crt", "找不到 CRT 表：%s" % resolved)
	var raw: String = FileAccess.get_file_as_string(resolved)
	var parsed: Variant = JSON.parse_string(raw)
	if not parsed is Dictionary:
		return Result.failure("invalid_json", "CRT 表无法解析：%s" % resolved)
	return Result.success(parsed)


## CRT 取表：给最终掷骰值、地形类与 odds 标签，返回结果代码与行列定位。
## source 可传入表字典；缺省时读默认表。成功字典 { code, rowIndex, columnIndex, columnLabel, rowLabel }。
static func crt_lookup(roll: int, terrain: String, odds: String, source: Variant = null) -> Dictionary:
	var table: Variant = source
	if table == null or not (table is Dictionary):
		var loaded: Dictionary = load_table("")
		if not loaded.get("ok", false):
			return loaded
		table = loaded.value
	var columns: Variant = table.get("terrainColumns", {}).get(terrain)
	if not columns is Array:
		return Result.failure("crt", "无效地形类「%s」" % terrain)

	var column_index: int = columns.find(odds)
	if column_index == -1:
		var clamped: Dictionary = _clamp_odds_index(columns, odds)
		if not clamped.get("ok", false):
			return clamped
		column_index = int(clamped.value)

	var rows: Variant = table.get("diceRows", [])
	var row_match: Dictionary = match_row_index(rows, roll, "crt")
	if not row_match.get("ok", false):
		return row_match
	var row_index: int = int(row_match.value)

	var matrix: Variant = table.get("matrix", [])
	if not matrix is Array or row_index < 0 or row_index >= matrix.size():
		return Result.failure("crt", "行越界（rowIndex %d，共 %d 行）" % [row_index, matrix.size() if matrix is Array else 0])
	var row: Variant = matrix[row_index]
	if not row is Array:
		return Result.failure("crt", "行越界（rowIndex %d，共 %d 行）" % [row_index, matrix.size()])
	if column_index < 0 or column_index >= row.size():
		return Result.failure("crt", "列越界（columnIndex %d）" % column_index)

	var code: String = str(row[column_index])
	var column_label: String = str(columns[column_index]) if column_index < columns.size() else odds
	var row_label: String = str(rows[row_index]) if row_index < rows.size() else str(roll)
	return {"code": code, "rowIndex": row_index, "columnIndex": column_index,
		"columnLabel": column_label, "rowLabel": row_label}


## 按数值匹配行标，返回行索引；无匹配返回 Result.failure。
## 支持单值（'2'）、区间（'3-4'）、「N or more」「N or less」边界行。
static func match_row_index(rows: Variant, value: int, table: String = "crt") -> Dictionary:
	if not rows is Array:
		return Result.failure(table, "行标为空")
	for index in rows.size():
		var range: Dictionary = _to_numeric_range(str(rows[index]))
		if range.is_empty():
			continue
		if value >= float(range.get("min", 0)) and value <= float(range.get("max", 0)):
			return Result.success(index)
	return Result.failure(table, "未找到匹配行（值 %d，行标 %s）" % [value, " | ".join(rows)])


## 解析行/列标签为数值闭区间；非数值标签返回空字典。Infinity 表示无界。
static func _to_numeric_range(label: String) -> Dictionary:
	var number_re := RegEx.create_from_string(r"^(\d+)$")
	var range_re := RegEx.create_from_string(r"^(\d+)-(\d+)$")
	var more_re := RegEx.create_from_string(r"^(\d+)(?:\+\s*|\s+or\s+more)$")
	var less_re := RegEx.create_from_string(r"^(\d+)\s+or\s+less$")
	var regex_match: Variant = number_re.search(label)
	if regex_match:
		var number_value: float = float(regex_match.get_string(1))
		return {"min": number_value, "max": number_value}
	regex_match = range_re.search(label)
	if regex_match:
		return {"min": float(regex_match.get_string(1)), "max": float(regex_match.get_string(2))}
	regex_match = more_re.search(label)
	if regex_match:
		return {"min": float(regex_match.get_string(1)), "max": INF}
	regex_match = less_re.search(label)
	if regex_match:
		return {"min": -INF, "max": float(regex_match.get_string(1))}
	return {}


## 解析 odds 标签为数值（'4:1' → 4；'1:2' → 0.5）；非法返回 null。
static func _parse_odds(label: String) -> Variant:
	var odds_re := RegEx.create_from_string(r"^(\d+):(\d+)$")
	var regex_match: Variant = odds_re.search(label)
	if not regex_match:
		return null
	var numerator: float = float(regex_match.get_string(1))
	var denominator: float = float(regex_match.get_string(2))
	if denominator == 0:
		return null
	return numerator / denominator


## odds 越界时夹取到最近列位；并列时取先出现的列（与 TS forEach 严格小于口径一致）。
static func _clamp_odds_index(columns: Array, odds: String) -> Dictionary:
	var target: Variant = _parse_odds(odds)
	if target == null:
		return Result.failure("crt", "列位中无「%s」且无法解析为攻防比值（%s）" % [odds, " | ".join(columns)])
	var best_index := 0
	var best_distance := INF
	for index in columns.size():
		var value: Variant = _parse_odds(str(columns[index]))
		if value == null:
			continue
		var distance: float = absf(float(value) - float(target))
		if distance < best_distance:
			best_distance = distance
			best_index = index
	return Result.success(best_index)
