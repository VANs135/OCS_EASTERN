extends Node2D

## EASTERN 地图显示层。规则全部由 Node 引擎结算，Godot 只负责显示与转发输入。

var model: Dictionary = {}
var view: Dictionary = {}
var bridge: Node
var camera: Camera2D
var map_texture: Texture2D
var _textures: Dictionary = {}
var _ui_layer: CanvasLayer
var _headline: Label
var _context: Label
var _status: Label
var _list: VBoxContainer
var _panning := false
var _request_pending := false

const PANEL_WIDTH := 390.0


func _ready() -> void:
	bridge = get_node_or_null("../Bridge")
	if bridge != null:
		bridge.bootstrap_ready.connect(_on_bootstrap)
		bridge.view_ready.connect(_on_view)
		bridge.bridge_failed.connect(_on_bridge_failed)
		bridge.bridge_log.connect(_on_bridge_log)
	camera = Camera2D.new()
	camera.name = "Camera2D"
	add_child(camera)
	camera.make_current()
	_build_ui()


func _on_bootstrap(next_model: Dictionary, next_view: Dictionary) -> void:
	_request_pending = false
	model = next_model
	view = next_view
	_load_map()
	_fit_camera()
	_refresh_ui()
	queue_redraw()


func _on_view(next_view: Dictionary) -> void:
	_request_pending = false
	view = next_view
	_refresh_ui()
	queue_redraw()


func _on_bridge_failed(message: String) -> void:
	_request_pending = false
	if _status != null:
		_status.text = "桥接失败：%s" % message
	queue_redraw()


func _on_bridge_log(message: String) -> void:
	if _status != null:
		_status.tooltip_text = message


func _load_map() -> void:
	map_texture = null
	var path := str(model.get("map", ""))
	if path.is_empty():
		return
	var image := Image.load_from_file(path)
	if image == null:
		push_error("无法读取 EASTERN 地图：%s" % path)
		return
	image.generate_mipmaps()
	map_texture = ImageTexture.create_from_image(image)


func _fit_camera() -> void:
	var width := maxf(float(model.get("width", 1)), 1.0)
	var height := maxf(float(model.get("height", 1)), 1.0)
	var viewport := get_viewport_rect().size
	var usable_width := maxf(viewport.x - PANEL_WIDTH, 200.0)
	var zoom := minf(usable_width / width, viewport.y / height) * 0.94
	camera.zoom = Vector2(zoom, zoom)
	camera.position = Vector2(width * 0.5, height * 0.5)


func _draw() -> void:
	if not model.is_empty() and map_texture != null:
		draw_texture_rect(map_texture, Rect2(0, 0, float(model.width), float(model.height)), false)
	else:
		draw_rect(Rect2(0, 0, 1600, 900), Color(0.08, 0.09, 0.1))

	if view.is_empty():
		return
	var frame: Dictionary = view.get("frame", {})
	_draw_boxes(model.get("boxes", []))
	_draw_stacks(frame.get("mapStacks", []), frame.get("selectedUnits", []))
	_draw_markers(frame)


func _draw_boxes(boxes: Array) -> void:
	for box in boxes:
		if not (box is Dictionary):
			continue
		var rect := Rect2(float(box.get("x", 0)), float(box.get("y", 0)),
			float(box.get("w", 0)), float(box.get("h", 0)))
		draw_rect(rect, Color(1.0, 0.82, 0.28, 0.06), true)
		draw_rect(rect, Color(1.0, 0.82, 0.28, 0.35), false, 1.0)


func _draw_stacks(stacks: Array, selected: Array) -> void:
	for stack in stacks:
		if not (stack is Dictionary):
			continue
		var sx := float(stack.get("x", 0))
		var sy := float(stack.get("y", 0))
		var pages: Array = stack.get("pages", [])
		if pages.is_empty():
			continue
		var page: Array = pages[0]
		for counter in page:
			if not (counter is Dictionary):
				continue
			var texture := _counter_texture(str(counter.get("asset", "")))
			if texture == null:
				continue
			var size := float(counter.get("size", 42))
			var rect := Rect2(sx + float(counter.get("x", 0)) - size * 0.5,
				sy + float(counter.get("y", 0)) - size * 0.5, size, size)
			draw_texture_rect(texture, rect, false)
			if str(counter.get("id", "")) in selected:
				draw_rect(rect.grow(2.0), Color(1.0, 0.86, 0.2, 1.0), false, 2.0)


func _draw_markers(frame: Dictionary) -> void:
	var selected_hex = frame.get("selectedHex")
	if selected_hex is Dictionary:
		draw_circle(Vector2(float(selected_hex.get("x", 0)), float(selected_hex.get("y", 0))),
			24.0, Color(0.2, 0.9, 1.0, 0.25))
	for target in frame.get("targets", []):
		if target is Dictionary:
			draw_circle(Vector2(float(target.get("x", 0)), float(target.get("y", 0))),
				30.0, Color(0.25, 1.0, 0.4, 0.28))
	var route: Array = frame.get("route", [])
	if route.size() > 1:
		var points := PackedVector2Array()
		for point in route:
			if point is Dictionary:
				points.append(Vector2(float(point.get("x", 0)), float(point.get("y", 0))))
		draw_polyline(points, Color(1.0, 0.78, 0.15, 0.8), 3.0)


func _counter_texture(asset: String) -> Texture2D:
	if asset.is_empty():
		return null
	if _textures.has(asset):
		return _textures[asset]
	var path := str(model.get("imageDirectory", "")).path_join(asset)
	var image := Image.load_from_file(path)
	if image == null:
		_textures[asset] = null
		return null
	var texture := ImageTexture.create_from_image(image)
	_textures[asset] = texture
	return texture


func _build_ui() -> void:
	_ui_layer = CanvasLayer.new()
	add_child(_ui_layer)

	var background := ColorRect.new()
	background.color = Color(0.055, 0.065, 0.075, 0.94)
	background.anchor_left = 1.0
	background.anchor_right = 1.0
	background.anchor_top = 0.0
	background.anchor_bottom = 1.0
	background.offset_left = -PANEL_WIDTH
	background.offset_right = -8.0
	background.offset_top = 8.0
	background.offset_bottom = -8.0
	_ui_layer.add_child(background)

	var margin := MarginContainer.new()
	margin.anchor_left = 1.0
	margin.anchor_right = 1.0
	margin.anchor_top = 0.0
	margin.anchor_bottom = 1.0
	margin.offset_left = -PANEL_WIDTH + 12.0
	margin.offset_right = -20.0
	margin.offset_top = 18.0
	margin.offset_bottom = -18.0
	margin.add_theme_constant_override("margin_left", 10)
	margin.add_theme_constant_override("margin_right", 10)
	_ui_layer.add_child(margin)

	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 8)
	column.size_flags_vertical = Control.SIZE_EXPAND_FILL
	margin.add_child(column)

	_headline = Label.new()
	_headline.text = "EASTERN · 正在连接引擎"
	_headline.add_theme_font_size_override("font_size", 20)
	_headline.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	column.add_child(_headline)

	_context = Label.new()
	_context.text = "剧本 / 模式"
	_context.add_theme_font_size_override("font_size", 12)
	_context.add_theme_color_override("font_color", Color(0.84, 0.65, 0.28))
	_context.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	column.add_child(_context)

	var home := Button.new()
	home.text = "← 返回主页面"
	home.custom_minimum_size = Vector2(0, 30)
	home.pressed.connect(_return_to_menu)
	column.add_child(home)

	var reset := Button.new()
	reset.text = "重置视图"
	reset.custom_minimum_size = Vector2(0, 28)
	reset.pressed.connect(_fit_camera)
	column.add_child(reset)

	_status = Label.new()
	_status.text = "等待 D:\\OCS\\OCS_EASTERN 的 Node 规则进程…"
	_status.add_theme_font_size_override("font_size", 12)
	_status.add_theme_color_override("font_color", Color(0.72, 0.78, 0.84))
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status.custom_minimum_size = Vector2(0, 64)
	column.add_child(_status)

	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	column.add_child(scroll)

	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 4)
	scroll.add_child(_list)


func _refresh_ui() -> void:
	if _headline == null:
		return
	_headline.text = str(view.get("headline", "EASTERN"))
	var state := get_node_or_null("/root/AppState")
	if _context != null and state != null:
		_context.text = "%s  ·  %s" % [str(state.scenario_label), str(state.mode_label)]
	_status.text = "%s\n修订 %s · 阶段 %s\n左键格/算子，右键动作菜单，中键拖动，滚轮缩放" % [
		str(view.get("phase", "")), str(view.get("revision", 0)), str(view.get("phaseId", ""))]
	_clear_list()
	var actions: Array = view.get("actions", [])
	if not actions.is_empty():
		_add_section("可用操作")
		for action in actions:
			if action is Dictionary:
				_add_button(str(action.get("label", "")), str(action.get("key", "")), "action")
	var menu: Array = view.get("menu", [])
	if not menu.is_empty():
		_add_section("刚刚打开的动作菜单")
		for action in menu:
			if action is Dictionary:
				_add_button(str(action.get("label", "")), str(action.get("key", "")), "action")
	var stack: Array = view.get("stack", [])
	if not stack.is_empty():
		_add_section("当前堆叠")
		for unit in stack:
			if unit is Dictionary:
				_add_button(str(unit.get("label", unit.get("id", ""))), str(unit.get("id", "")), "unit")
	var roster: Array = view.get("roster", [])
	if not roster.is_empty():
		_add_section("可操作算子（前 24 枚）")
		var shown := 0
		for unit in roster:
			if shown >= 24:
				break
			if unit is Dictionary:
				_add_button(str(unit.get("label", unit.get("id", ""))), str(unit.get("id", "")), "unit")
				shown += 1


func _clear_list() -> void:
	for child in _list.get_children():
		_list.remove_child(child)
		child.queue_free()


func _add_section(text: String) -> void:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", 12)
	label.add_theme_color_override("font_color", Color(0.98, 0.78, 0.34))
	_list.add_child(label)


func _add_button(text: String, id: String, kind: String) -> void:
	var button := Button.new()
	button.text = text
	button.tooltip_text = id
	button.custom_minimum_size = Vector2(0, 32)
	button.alignment = HORIZONTAL_ALIGNMENT_LEFT
	button.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	if kind == "action":
		button.pressed.connect(_on_action_pressed.bind(id))
	else:
		button.pressed.connect(_on_unit_pressed.bind(id))
	_list.add_child(button)


func _send(request: Dictionary) -> void:
	if bridge == null or _request_pending:
		return
	_request_pending = true
	bridge.request(request)


func _on_action_pressed(key: String) -> void:
	if bridge == null:
		return
	_send({"kind": "apply", "key": key, "revision": int(view.get("revision", 0))})


func _on_unit_pressed(unit_id: String) -> void:
	if bridge == null:
		return
	_send({"kind": "select-unit", "unitId": unit_id})


func _counter_at(world: Vector2) -> String:
	var frame: Dictionary = view.get("frame", {})
	for stack in frame.get("mapStacks", []):
		if not (stack is Dictionary):
			continue
		var pages: Array = stack.get("pages", [])
		if pages.is_empty():
			continue
		## 只检查当前显示的第一页；翻页按钮后续再接。
		var sx := float(stack.get("x", 0))
		var sy := float(stack.get("y", 0))
		for counter in pages[0]:
			if not (counter is Dictionary):
				continue
			var size := float(counter.get("size", 42))
			var rect := Rect2(sx + float(counter.get("x", 0)) - size * 0.5,
				sy + float(counter.get("y", 0)) - size * 0.5, size, size)
			if rect.has_point(world):
				return str(counter.get("id", ""))
	return ""


func _screen_to_world(screen: Vector2) -> Vector2:
	var viewport := get_viewport_rect().size
	return camera.position + (screen - viewport * 0.5) / camera.zoom


func _input(event: InputEvent) -> void:
	if model.is_empty():
		return
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP and event.pressed:
			_zoom(1.12)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN and event.pressed:
			_zoom(1.0 / 1.12)
		elif event.button_index == MOUSE_BUTTON_MIDDLE:
			_panning = event.pressed
		elif event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
			var viewport := get_viewport_rect().size
			if event.position.x > viewport.x - PANEL_WIDTH:
				return
			var world := _screen_to_world(event.position)
			var unit_id := _counter_at(world)
			var request := {"kind": "board-left", "x": world.x, "y": world.y,
				"revision": int(view.get("revision", 0))}
			if not unit_id.is_empty():
				request["unitId"] = unit_id
			if event.double_click:
				request["confirm"] = true
			print("[Input] board-left ", request)
			_send(request)
		elif event.button_index == MOUSE_BUTTON_RIGHT and event.pressed:
			var viewport := get_viewport_rect().size
			if event.position.x > viewport.x - PANEL_WIDTH:
				return
			var world := _screen_to_world(event.position)
			var unit_id := _counter_at(world)
			var request := {"kind": "board-menu", "x": world.x, "y": world.y,
				"revision": int(view.get("revision", 0))}
			if not unit_id.is_empty():
				request["unitId"] = unit_id
			print("[Input] board-menu ", request)
			_send(request)
	elif event is InputEventMouseMotion and _panning:
		camera.position -= event.relative / camera.zoom


func _zoom(factor: float) -> void:
	var next := clampf(camera.zoom.x * factor, 0.12, 1.6)
	camera.zoom = Vector2(next, next)


func _return_to_menu() -> void:
	get_tree().change_scene_to_file("res://menu.tscn")
