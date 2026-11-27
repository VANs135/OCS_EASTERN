extends Node

## 原生 GDScript 桥：与 engine_bridge.gd 同信号契约，不启 Node 进程。
## bootstrap 的 model 取 08 数据包的 view.model（地图与计数图绝对路径），view 取原生会话投影。
## 目前已覆盖 08 开局；飞机整备及之后的阶段仍由 Node 桥负责。

signal bootstrap_ready(model: Dictionary, view: Dictionary)
signal view_ready(view: Dictionary)
signal bridge_failed(message: String)
signal bridge_log(message: String)

const SESSION_SCRIPT := preload("res://scripts/session/local_session.gd")
const DEFAULT_DATA := "../../../dist/godot/08-opening-data.json"

var config: Dictionary = {}
var session: RefCounted
var model: Dictionary = {}
var _queue: Array[Dictionary] = []
var _next_id := 1
var _failed := false


func _ready() -> void:
	var raw := FileAccess.get_file_as_string("res://bridge.config.json")
	var parsed = JSON.parse_string(raw)
	config = parsed if parsed is Dictionary else {}
	var data_path := OS.get_environment("OCS_NATIVE_DATA")
	if data_path.is_empty() or data_path == "1":
		data_path = _resolve_path(str(config.get("native_data", DEFAULT_DATA)))
	call_deferred("_boot", data_path)


func request(command: Dictionary) -> int:
	var id := _next_id
	_next_id += 1
	command["id"] = id
	_queue.append(command)
	call_deferred("_pump")
	return id


## Synchronous boot so tests can drive it without frames; the real scene defers the call.
func _boot(data_path: String) -> void:
	if not FileAccess.file_exists(data_path):
		_fail("找不到原生开局数据：%s" % data_path)
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(data_path))
	if not (parsed is Dictionary) or parsed.is_empty():
		_fail("原生开局数据无法解析：%s" % data_path)
		return
	var seed_value := float(config.get("seed", 20261127))
	var opened := SESSION_SCRIPT.open(parsed, seed_value)
	if not opened.ok:
		_fail("原生开局失败：%s" % str(opened.get("errorMessage", "unknown")))
		return
	session = opened.value
	model = _native_model(parsed.view.model)
	print("[Native] 08 开局已载入：%dx%d · %d 个盒区 · 修订 %d" % [
		int(model.get("width", 0)), int(model.get("height", 0)),
		model.get("boxes", []).size(), int(session.revision())])
	bootstrap_ready.emit(model, session.view())
	var capture_path := _capture_path()
	if not capture_path.is_empty():
		await get_tree().create_timer(1.2).timeout
		var image := get_viewport().get_texture().get_image()
		var error := image.save_png(capture_path)
		print("[Native] capture: %s err=%d" % [capture_path, error])
		get_tree().quit()


func _pump() -> void:
	while not _queue.is_empty():
		var command: Dictionary = _queue.pop_front()
		var outcome: Dictionary = session.dispatch(command)
		if not outcome.ok:
			_fail(str(outcome.get("errorMessage", "unknown")))
			continue
		var view: Dictionary = outcome.value
		if view.is_empty():
			_fail("原生会话已超出 08 开局阶段，请改用 Node 桥或等待该阶段迁移")
			continue
		view_ready.emit(view)


func _resolve_path(value: String) -> String:
	if value.begins_with("res://") or value.begins_with("user://"):
		return ProjectSettings.globalize_path(value).replace("\\", "/")
	if value.begins_with("/") or value.contains(":/"):
		return value.replace("\\", "/")
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	return (base + "/" + value).simplify_path().replace("\\", "/")


## 地图在 TS 模型里是相对素材名，Godot 侧直接读绝对路径；计数图仍按 imageDirectory 拼接。
func _native_model(raw_model: Dictionary) -> Dictionary:
	var next: Dictionary = raw_model.duplicate(true)
	var directory := str(next.get("imageDirectory", "")).replace("\\", "/")
	next.imageDirectory = directory
	var map := str(next.get("map", ""))
	if not map.is_empty():
		next.map = directory.path_join(map)
	return next


func _capture_path() -> String:
	for arg: String in OS.get_cmdline_user_args():
		if arg.begins_with("--capture="):
			return arg.trim_prefix("--capture=")
	return ""


func _fail(message: String) -> void:
	if _failed:
		return
	_failed = true
	print("[Native] 失败：", message)
	bridge_failed.emit(message)
