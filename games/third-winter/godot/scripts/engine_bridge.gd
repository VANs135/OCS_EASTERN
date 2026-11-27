extends Node

## EASTERN → Godot 桥接客户端。
## Node 端：res://bridge/eastern_bridge.mjs（仓库内相对路径）
## 协议：首行 bootstrap（model + view），之后每条请求/响应逐行 JSON。

signal bootstrap_ready(model: Dictionary, view: Dictionary)
signal view_ready(view: Dictionary)
signal bridge_failed(message: String)
signal bridge_log(message: String)

var config: Dictionary = {}
var stdio: FileAccess
var proc_pid := -1
var _thread: Thread
var _mutex := Mutex.new()
var _queue: Array[Dictionary] = []
var _next_id := 1
var _running := false
var _bootstrap_done := false


func _resolve_path(value: String) -> String:
	if value.begins_with("res://") or value.begins_with("user://"):
		return ProjectSettings.globalize_path(value).replace("\\", "/")
	if value.begins_with("/") or value.contains(":/"):
		return value.replace("\\", "/")
	var base := ProjectSettings.globalize_path("res://").trim_suffix("/")
	return (base + "/" + value).simplify_path().replace("\\", "/")


func _ready() -> void:
	var raw := FileAccess.get_file_as_string("res://bridge.config.json")
	var parsed = JSON.parse_string(raw)
	if not (parsed is Dictionary) or parsed.is_empty():
		bridge_failed.emit("bridge.config.json 读取失败")
		return
	config = parsed
	_thread = Thread.new()
	_thread.start(_worker)


func _exit_tree() -> void:
	_mutex.lock()
	_running = false
	_mutex.unlock()
	if stdio != null:
		stdio.store_line(JSON.stringify({"kind": "close"}))
		stdio.flush()
	if _thread != null and _thread.is_started():
		_thread.wait_to_finish()


func request(command: Dictionary) -> int:
	_mutex.lock()
	var id := _next_id
	_next_id += 1
	command["id"] = id
	_queue.append(command)
	_mutex.unlock()
	return id


func _worker() -> void:
	var node_path := OS.get_environment("OCS_NODE")
	if node_path.is_empty():
		node_path = _resolve_path(str(config.get("node_path", "")))
	var engine_dir := _resolve_path(str(config.get("engine_dir", ".")))
	var bridge_script := _resolve_path(str(config.get("bridge_script", "")))
	var data_root := OS.get_environment("OCS_DATA_ROOT")
	if data_root.is_empty():
		data_root = _resolve_path(str(config.get("data_root", "")))
	var tables := OS.get_environment("OCS_TABLES")
	if tables.is_empty():
		tables = _resolve_path(str(config.get("tables", "")))
	var save_path := OS.get_environment("OCS_SAVE")
	if save_path.is_empty():
		save_path = _resolve_path(str(config.get("save_path", "user://eastern-godot-save.json")))
	var args := PackedStringArray([
		"--experimental-strip-types",
		bridge_script,
		"--engine-dir=" + engine_dir,
		"--data-root=" + data_root,
		"--tables=" + tables,
		"--save=" + save_path,
		"--seed=" + str(config.get("seed", 20261127)),
	])
	var result := OS.execute_with_pipe(node_path, args, true)
	if result.is_empty() or int(result.get("pid", -1)) <= 0:
		call_deferred("_emit_failure", "无法启动 Node：%s" % node_path)
		return
	var stdio_raw = result.get("stdio", null)
	if not (stdio_raw is FileAccess):
		call_deferred("_emit_failure", "管道创建失败")
		return
	stdio = stdio_raw
	proc_pid = int(result["pid"])
	call_deferred("_emit_log", "EASTERN Node 已启动 pid=%d" % proc_pid)

	var first := _read_json()
	if not bool(first.get("bootstrap", false)):
		call_deferred("_emit_failure", " EASTERN 首行不是 bootstrap：%s" % JSON.stringify(first).left(200))
		return
	if not bool(first.get("ok", false)):
		call_deferred("_emit_failure", " EASTERN 初始化失败：%s" % str(first.get("error", "unknown")))
		return
	_bootstrap_done = true
	var model: Dictionary = first.get("model", {})
	var view: Dictionary = first.get("view", {})
	call_deferred("_emit_bootstrap", model, view)

	_running = true
	while _running:
		var command := _pop_command()
		if command.is_empty():
			OS.delay_msec(20)
			continue
		stdio.store_line(JSON.stringify(command))
		stdio.flush()
		var response := _read_json()
		var guard := 0
		while int(response.get("id", -1)) != int(command.get("id", -1)) and guard < 8:
			if response.is_empty():
				break
			response = _read_json()
			guard += 1
		if response.is_empty():
			call_deferred("_emit_failure", "EASTERN 返回空响应")
			break
		call_deferred("_dispatch", response)


func _pop_command() -> Dictionary:
	_mutex.lock()
	var command: Dictionary = {}
	if not _queue.is_empty():
		command = _queue.pop_front()
	_mutex.unlock()
	return command


func _read_json() -> Dictionary:
	if stdio == null:
		return {}
	var line := stdio.get_line()
	if line == null or line.strip_edges() == "":
		return {}
	var parsed = JSON.parse_string(line)
	if parsed == null or not (parsed is Dictionary):
		return {}
	return parsed


func _dispatch(response: Dictionary) -> void:
	if not bool(response.get("ok", false)):
		bridge_failed.emit("EASTERN 报错：%s" % str(response.get("error", "unknown")))
		return
	var view: Dictionary = response.get("view", {})
	if not view.is_empty():
		view_ready.emit(view)


func _emit_bootstrap(model: Dictionary, view: Dictionary) -> void:
	print("[Bridge] EASTERN bootstrap：%dx%d" % [int(model.get("width", 0)), int(model.get("height", 0))])
	bootstrap_ready.emit(model, view)


func _emit_log(message: String) -> void:
	print("[Bridge] ", message)
	bridge_log.emit(message)


func _emit_failure(message: String) -> void:
	print("[Bridge] 失败：", message)
	bridge_failed.emit(message)
