extends Control

## 正式客户端入口：主页面 → 模式 → 剧本选择。规则与盘面仍由 Node 引擎提供。
## 本页只负责入口、模式/剧本元数据和桥接状态，不复制任何规则判定。

const ACCENT := Color(0.84, 0.65, 0.28)
const ACCENT_SOFT := Color(0.84, 0.65, 0.28, 0.16)
const BG := Color(0.030, 0.045, 0.055)
const PANEL := Color(0.055, 0.085, 0.105, 0.94)
const PANEL_RAISED := Color(0.070, 0.105, 0.125, 0.96)
const TEXT := Color(0.900, 0.875, 0.790)
const MUTED := Color(0.520, 0.610, 0.660)
const DIM := Color(0.360, 0.440, 0.490)
const GOOD := Color(0.500, 0.780, 0.500)
const WARN := Color(0.900, 0.680, 0.330)

const MODES := [
	{
		"id": "solo",
		"title": "单机 SOLO",
		"subtitle": "本地热座 / 单人推演",
		"desc": "在一台机器上控制双方，适合规则检查、初设核对、地图与算子验收。",
		"badge": "本地可用",
		"available": true,
	},
	{
		"id": "pvp",
		"title": "联机 PVP",
		"subtitle": "1v1 远程对局",
		"desc": "两名玩家各控一方，通过房间席位与裁判端交换动作；当前网络协议尚未接入。",
		"badge": "协议待接",
		"available": false,
	},
	{
		"id": "pvp-multi",
		"title": "联机多人 PVP",
		"subtitle": "多席位 / 团队对抗",
		"desc": "按方面军、集团军群或阵营拆分席位，支持多人同局；当前服务端席位尚未接入。",
		"badge": "协议待接",
		"available": false,
	},
	{
		"id": "pve",
		"title": "单机 PVE",
		"subtitle": "单人 vs AI",
		"desc": "玩家控制一方，由 AI 接管另一方；当前 AI 入口尚未接入，仅保留模式位置。",
		"badge": "AI 待接",
		"available": false,
	},
	{
		"id": "pve-online",
		"title": "联机 PVE",
		"subtitle": "多人协作 vs AI",
		"desc": "多名玩家共享同一方，由 AI 控制对手；网络席位与 AI 入口均待接入。",
		"badge": "协议 / AI 待接",
		"available": false,
	},
]

const SCENARIOS := [
	{
		"id": "01-dnepr-battles", "no": "01", "zh": "第聂伯河战役", "en": "The Dnepr Battles",
		"date": "1943-09-26", "turns": "63", "maps": "A–D 全图", "kind": "战役",
		"bridge": "fixture", "note": "774 条固定初设、104 架飞机与 914 枚计数器已落盘；Godot 地图桥接待接。",
	},
	{
		"id": "02-gotterdammerung", "no": "02", "zh": "诸神黄昏", "en": "Die Götterdämmerung",
		"date": "1944-01-26", "turns": "27", "maps": "A–D 全图", "kind": "战役",
		"bridge": "data", "note": "初设数据与专规入口已载入；地图桥接待接。",
	},
	{
		"id": "03-red-thunder", "no": "03", "zh": "红色雷霆", "en": "Red Thunder",
		"date": "1944-04-08", "turns": "6", "maps": "A、C", "kind": "战役",
		"bridge": "data", "note": "苏军 front HQ 池已可生成初设选择；地图桥接待接。",
	},
	{
		"id": "04-mansteins-fire-brigade", "no": "04", "zh": "曼施坦因的救火队", "en": "Manstein's Fire Brigades",
		"date": "1943-12-26", "turns": "9", "maps": "A 图", "kind": "战役",
		"bridge": "data", "note": "剧本资料已载入；入口桥接待接。",
	},
	{
		"id": "05-ii-ss-pz-corps-strike", "no": "05", "zh": "第 II SS 装甲军反击", "en": "II SS Pz Corps Strikes Back",
		"date": "1944-04-08", "turns": "6", "maps": "A 图", "kind": "战役",
		"bridge": "data", "note": "剧本资料已载入；入口桥接待接。",
	},
	{
		"id": "06-rumanian-finish", "no": "06", "zh": "罗马尼亚终局", "en": "Rumanian Finish",
		"date": "1944-04-08", "turns": "6", "maps": "C 图", "kind": "战役",
		"bridge": "data", "note": "剧本资料已载入；入口桥接待接。",
	},
	{
		"id": "07-hubes-pocket", "no": "07", "zh": "胡贝口袋", "en": "Hube's Pocket",
		"date": "1944-03-22", "turns": "8", "maps": "A 图", "kind": "战役",
		"bridge": "data", "note": "剧本资料已载入；入口桥接待接。",
	},
	{
		"id": "08-korsun-pocket", "no": "08", "zh": "科尔孙口袋：瓶中之蝎", "en": "Korsun Pocket: Scorpions in a Bottle",
		"date": "1944-01-26", "turns": "8", "maps": "迷你地图", "kind": "战役",
		"bridge": "interactive", "note": "当前 Godot 桥接可直接进入；使用瓶中蝎桌面控制器与迷你地图。",
	},
	{
		"id": "09-kirovograd-armor-defense", "no": "09", "zh": "装甲防御：1944 年早期装甲防御行动", "en": "Kirovograd Armor Defense",
		"date": "1944-01-05", "turns": "5", "maps": "D 图 1.23–31.35", "kind": "战役",
		"bridge": "fixture", "note": "D 图裁切、初设夹具与规则入口已存在；Godot 地图桥接待接。",
	},
]

class Backdrop:
	extends Control

	func _ready() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	func _notification(what: int) -> void:
		if what == NOTIFICATION_RESIZED:
			queue_redraw()

	func _draw() -> void:
		var w := size.x
		var h := size.y
		draw_rect(Rect2(Vector2.ZERO, size), Color(0.028, 0.042, 0.052))
		# 战术地图底纹：稀疏网格 + 等高线弧，不抢正文。
		for x in range(0, int(w) + 80, 80):
			draw_line(Vector2(x, 0), Vector2(x, h), Color(0.46, 0.58, 0.62, 0.035), 1.0)
		for y in range(0, int(h) + 80, 80):
			draw_line(Vector2(0, y), Vector2(w, y), Color(0.46, 0.58, 0.62, 0.035), 1.0)
		for radius in [210.0, 360.0, 530.0]:
			draw_arc(Vector2(w * 0.24, h * 0.58), radius, 0.0, TAU, 96, Color(0.84, 0.65, 0.28, 0.05), 1.0)
		draw_rect(Rect2(0, 0, w, 4), Color(0.84, 0.65, 0.28, 0.45))
		draw_rect(Rect2(0, h - 2, w, 2), Color(0.84, 0.65, 0.28, 0.12))


var _page_root: Control
var _selected_mode := 0
var _selected_scenario := 0
var _current_page := "home"
var _mode_rows: Array[PanelContainer] = []
var _scenario_rows: Array[PanelContainer] = []
var _home_detail: VBoxContainer
var _scenario_detail: VBoxContainer


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	theme = _make_theme()
	var backdrop := Backdrop.new()
	add_child(backdrop)
	_page_root = Control.new()
	_page_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(_page_root)
	var state := get_node_or_null("/root/AppState")
	if state != null:
		_selected_mode = _mode_index(str(state.mode_id))
		_selected_scenario = _scenario_index(str(state.scenario_id))
	# 仅用于截图/检查：godot --path ... -- --scenarios --capture=E:/...
	var start_scenarios := false
	var capture_path := ""
	for arg in OS.get_cmdline_user_args():
		if arg == "--scenarios":
			start_scenarios = true
		elif arg.begins_with("--capture="):
			capture_path = arg.trim_prefix("--capture=")
	if start_scenarios:
		_show_scenarios()
	else:
		_show_home()
	if capture_path != "":
		await get_tree().process_frame
		await get_tree().create_timer(0.5).timeout
		var image := get_viewport().get_texture().get_image()
		var error := image.save_png(capture_path)
		print("menu capture: ", capture_path, " err=", error)
		get_tree().quit()


func _make_theme() -> Theme:
	var font := SystemFont.new()
	font.font_names = PackedStringArray(["Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Arial"])
	var next := Theme.new()
	next.default_font = font
	next.default_font_size = 16
	return next


func _mode_index(id: String) -> int:
	for index in MODES.size():
		if str(MODES[index].id) == id:
			return index
	return 0


func _scenario_index(id: String) -> int:
	for index in SCENARIOS.size():
		if str(SCENARIOS[index].id) == id:
			return index
	return 7


func _clear_page() -> void:
	for child in _page_root.get_children():
		child.queue_free()


func _show_home() -> void:
	_current_page = "home"
	_clear_page()
	var page := MarginContainer.new()
	page.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	page.add_theme_constant_override("margin_left", 48)
	page.add_theme_constant_override("margin_right", 48)
	page.add_theme_constant_override("margin_top", 36)
	page.add_theme_constant_override("margin_bottom", 32)
	_page_root.add_child(page)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 22)
	page.add_child(column)

	column.add_child(_topbar("EASTERN OCS", "THIRD WINTER · 作战入口", "主页面", false))
	var body := HBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 26)
	column.add_child(body)

	var left := VBoxContainer.new()
	left.custom_minimum_size = Vector2(680, 0)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.add_theme_constant_override("separation", 8)
	body.add_child(left)
	var hit := _label("GAME MODE / 游戏模式", 11, ACCENT)
	left.add_child(hit)
	var title := _label("选择作战入口", 30, TEXT)
	left.add_child(title)
	var intro := _label("先选模式，再进入剧本选择。未接入的入口保留位置与状态，不伪造可用性。", 14, MUTED, true)
	left.add_child(intro)
	left.add_child(_spacer(10))
	for index in MODES.size():
		_add_mode_card(left, index)

	var right := PanelContainer.new()
	right.custom_minimum_size = Vector2(520, 0)
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_theme_stylebox_override("panel", _box(PANEL, Color(0.84, 0.65, 0.28, 0.28), 1, 8))
	body.add_child(right)
	var right_margin := _margin(24, 24, 22, 22)
	right.add_child(right_margin)
	_home_detail = VBoxContainer.new()
	_home_detail.add_theme_constant_override("separation", 14)
	right_margin.add_child(_home_detail)
	_render_home_detail()

	var footer := HBoxContainer.new()
	footer.add_theme_constant_override("separation", 12)
	column.add_child(footer)
	var hint := _label("当前可进入的桥接剧本：08 · 科尔孙口袋。其它剧本保留菜单与状态。", 12, DIM, true)
	hint.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	footer.add_child(hint)
	var reset := _button("重置选择", false)
	reset.pressed.connect(_reset_selection)
	footer.add_child(reset)


func _render_home_detail() -> void:
	for child in _home_detail.get_children():
		child.queue_free()
	var mode: Dictionary = MODES[_selected_mode]
	var kicker := _label("MODE BRIEF / 模式说明", 11, ACCENT)
	_home_detail.add_child(kicker)
	var title := _label(str(mode.title), 28, TEXT)
	_home_detail.add_child(title)
	var subtitle := _label(str(mode.subtitle), 13, MUTED)
	_home_detail.add_child(subtitle)
	_home_detail.add_child(_rule())
	var desc := _label(str(mode.desc), 15, Color(0.82, 0.83, 0.80), true)
	desc.custom_minimum_size = Vector2(0, 92)
	_home_detail.add_child(desc)

	_home_detail.add_child(_stat_line("入口状态", str(mode.badge), GOOD if bool(mode.available) else WARN))
	_home_detail.add_child(_stat_line("本地存档", "user://eastern-godot-save.json", MUTED))
	_home_detail.add_child(_stat_line("规则内核", "Node / TypeScript v4.3", MUTED))
	_home_detail.add_child(_spacer(8))
	var next := _button("进入剧本选择  →", true)
	next.custom_minimum_size = Vector2(0, 48)
	next.pressed.connect(_show_scenarios)
	_home_detail.add_child(next)
	var note := _label("剧本选择页可查看 01–09 的日期、回合、地图与桥接状态。", 12, DIM, true)
	_home_detail.add_child(note)
	_home_detail.add_child(_spacer(6))
	var stretch := Control.new()
	stretch.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_home_detail.add_child(stretch)
	_home_detail.add_child(_bridge_summary())


func _bridge_summary() -> PanelContainer:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _box(
		Color(0.075, 0.110, 0.130, 0.72), Color(0.40, 0.52, 0.56, 0.22), 1, 6))
	var margin := _margin(16, 16, 12, 12)
	panel.add_child(margin)
	var inner := VBoxContainer.new()
	inner.add_theme_constant_override("separation", 5)
	margin.add_child(inner)
	inner.add_child(_label("ACTIVE BRIDGE / 本机唯一接通", 10, ACCENT))
	inner.add_child(_label("08  ·  科尔孙口袋：瓶中之蝎", 14, TEXT, true))
	inner.add_child(_label("迷你地图 · 8 回合 · 本地热座", 11, MUTED))
	inner.add_child(_label("从剧本页进入后启动 Node / TypeScript 引擎，首次连接约数秒。", 11, DIM, true))
	return panel


func _show_scenarios() -> void:
	_current_page = "scenarios"
	_clear_page()
	var mode: Dictionary = MODES[_selected_mode]
	var page := MarginContainer.new()
	page.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	page.add_theme_constant_override("margin_left", 48)
	page.add_theme_constant_override("margin_right", 48)
	page.add_theme_constant_override("margin_top", 36)
	page.add_theme_constant_override("margin_bottom", 32)
	_page_root.add_child(page)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 18)
	page.add_child(column)

	column.add_child(_topbar("SCENARIO SELECT", "挑选一张战役盘面", "剧本选择", true))
	var mode_strip := HBoxContainer.new()
	mode_strip.add_theme_constant_override("separation", 10)
	column.add_child(mode_strip)
	var current := _label("当前模式  ·  %s  /  %s" % [str(mode.title), str(mode.badge)], 12, MUTED)
	current.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mode_strip.add_child(current)

	var body := HBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 24)
	column.add_child(body)
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(720, 0)
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	body.add_child(scroll)
	var list := VBoxContainer.new()
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list.add_theme_constant_override("separation", 8)
	scroll.add_child(list)
	_scenario_rows.clear()
	for index in SCENARIOS.size():
		_add_scenario_card(list, index)

	var right := PanelContainer.new()
	right.custom_minimum_size = Vector2(500, 0)
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_theme_stylebox_override("panel", _box(PANEL, Color(0.84, 0.65, 0.28, 0.28), 1, 8))
	body.add_child(right)
	var right_margin := _margin(22, 22, 20, 20)
	right.add_child(right_margin)
	_scenario_detail = VBoxContainer.new()
	_scenario_detail.add_theme_constant_override("separation", 10)
	right_margin.add_child(_scenario_detail)
	_render_scenario_detail()


func _render_scenario_detail() -> void:
	for child in _scenario_detail.get_children():
		child.queue_free()
	var scenario: Dictionary = SCENARIOS[_selected_scenario]
	var mode: Dictionary = MODES[_selected_mode]
	var kicker := _label("SCENARIO BRIEF / 剧本简报", 11, ACCENT)
	_scenario_detail.add_child(kicker)
	var no := _label(str(scenario.no), 42, ACCENT)
	_scenario_detail.add_child(no)
	var title := _label(str(scenario.zh), 22, TEXT, true)
	_scenario_detail.add_child(title)
	var english := _label(str(scenario.en), 13, MUTED, true)
	_scenario_detail.add_child(english)
	_scenario_detail.add_child(_rule())
	_scenario_detail.add_child(_stat_line("开局日期", str(scenario.date), Color(0.84, 0.83, 0.78)))
	_scenario_detail.add_child(_stat_line("回合数", str(scenario.turns), Color(0.84, 0.83, 0.78)))
	_scenario_detail.add_child(_stat_line("地图范围", str(scenario.maps), Color(0.84, 0.83, 0.78)))
	_scenario_detail.add_child(_stat_line("模式", str(mode.title), Color(0.84, 0.83, 0.78)))
	_scenario_detail.add_child(_spacer(4))
	var bridge := _bridge_line(str(scenario.bridge))
	_scenario_detail.add_child(bridge)
	var note := _label(str(scenario.note), 13, MUTED, true)
	note.custom_minimum_size = Vector2(0, 78)
	_scenario_detail.add_child(note)
	var can_enter := _can_enter()
	var enter_text := "进入检查  →"
	if not bool(mode.available):
		enter_text = "该模式入口待接入"
	elif str(scenario.bridge) != "interactive":
		enter_text = "地图桥接待接"
	var enter := _button(enter_text, can_enter)
	enter.custom_minimum_size = Vector2(0, 48)
	enter.disabled = not can_enter
	enter.pressed.connect(_enter_scenario)
	_scenario_detail.add_child(enter)
	var hint := _label("08 是当前唯一接通 Godot 地图的剧本；01/09 已有本机夹具。", 12, DIM, true)
	_scenario_detail.add_child(hint)


func _can_enter() -> bool:
	var mode: Dictionary = MODES[_selected_mode]
	var scenario: Dictionary = SCENARIOS[_selected_scenario]
	return bool(mode.available) and str(scenario.bridge) == "interactive"


func _enter_scenario() -> void:
	if not _can_enter():
		return
	var mode: Dictionary = MODES[_selected_mode]
	var scenario: Dictionary = SCENARIOS[_selected_scenario]
	var state := get_node_or_null("/root/AppState")
	if state != null:
		state.mode_id = str(mode.id)
		state.mode_label = str(mode.title)
		state.scenario_id = str(scenario.id)
		state.scenario_label = "%s · %s" % [str(scenario.no), str(scenario.zh)]
	get_tree().change_scene_to_file("res://main.tscn")


func _reset_selection() -> void:
	_selected_mode = 0
	_selected_scenario = 7
	_show_home()


func _select_mode(index: int) -> void:
	_selected_mode = index
	_show_home()


func _select_scenario(index: int) -> void:
	_selected_scenario = index
	_show_scenarios()


func _add_mode_card(parent: VBoxContainer, index: int) -> void:
	var mode: Dictionary = MODES[index]
	var selected := index == _selected_mode
	var card := PanelContainer.new()
	card.custom_minimum_size = Vector2(0, 74)
	card.add_theme_stylebox_override("panel", _box(
		Color(0.105, 0.155, 0.175, 0.96) if selected else PANEL_RAISED,
		ACCENT if selected else Color(0.40, 0.52, 0.56, 0.22), 2 if selected else 1, 6))
	parent.add_child(card)
	_mode_rows.append(card)
	var margin := _margin(18, 16, 11, 11)
	card.add_child(margin)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	margin.add_child(row)
	var number := _label(str(index + 1).pad_zeros(2), 12, ACCENT if selected else DIM)
	number.custom_minimum_size = Vector2(30, 0)
	number.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	row.add_child(number)
	var text := VBoxContainer.new()
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text.add_theme_constant_override("separation", 1)
	row.add_child(text)
	var title := _label(str(mode.title), 17, TEXT)
	text.add_child(title)
	var sub := _label(str(mode.subtitle), 12, MUTED)
	text.add_child(sub)
	var badge := _label(str(mode.badge), 11, GOOD if bool(mode.available) else WARN)
	badge.custom_minimum_size = Vector2(88, 0)
	badge.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	badge.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	row.add_child(badge)
	var overlay := Button.new()
	overlay.flat = true
	overlay.text = ""
	overlay.focus_mode = Control.FOCUS_NONE
	overlay.mouse_filter = Control.MOUSE_FILTER_STOP
	overlay.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	overlay.size_flags_vertical = Control.SIZE_EXPAND_FILL
	overlay.tooltip_text = str(mode.desc)
	overlay.pressed.connect(_select_mode.bind(index))
	card.add_child(overlay)


func _add_scenario_card(parent: VBoxContainer, index: int) -> void:
	var scenario: Dictionary = SCENARIOS[index]
	var selected := index == _selected_scenario
	var card := PanelContainer.new()
	card.custom_minimum_size = Vector2(0, 72)
	card.add_theme_stylebox_override("panel", _box(
		Color(0.085, 0.125, 0.145, 0.96) if selected else PANEL_RAISED,
		ACCENT if selected else Color(0.40, 0.52, 0.56, 0.18), 2 if selected else 1, 6))
	parent.add_child(card)
	_scenario_rows.append(card)
	var margin := _margin(16, 14, 10, 10)
	card.add_child(margin)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	margin.add_child(row)
	var no := _label(str(scenario.no), 20, ACCENT if selected else MUTED)
	no.custom_minimum_size = Vector2(40, 0)
	no.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	row.add_child(no)
	var text := VBoxContainer.new()
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text.add_theme_constant_override("separation", 1)
	row.add_child(text)
	text.add_child(_label(str(scenario.zh), 15, TEXT, true))
	text.add_child(_label("%s  ·  %s 回合  ·  %s" % [str(scenario.date), str(scenario.turns), str(scenario.maps)], 11, MUTED))
	var badge := _label(_bridge_short(str(scenario.bridge)), 11,
		GOOD if str(scenario.bridge) == "interactive" else (WARN if str(scenario.bridge) == "fixture" else DIM))
	badge.custom_minimum_size = Vector2(92, 0)
	badge.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	badge.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	row.add_child(badge)
	var overlay := Button.new()
	overlay.flat = true
	overlay.text = ""
	overlay.focus_mode = Control.FOCUS_NONE
	overlay.mouse_filter = Control.MOUSE_FILTER_STOP
	overlay.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	overlay.size_flags_vertical = Control.SIZE_EXPAND_FILL
	overlay.tooltip_text = str(scenario.note)
	overlay.pressed.connect(_select_scenario.bind(index))
	card.add_child(overlay)


func _bridge_short(bridge: String) -> String:
	if bridge == "interactive":
		return "可进入"
	if bridge == "fixture":
		return "夹具就绪"
	return "桥接待接"


func _bridge_line(bridge: String) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var dot := _label("●", 14, GOOD if bridge == "interactive" else (WARN if bridge == "fixture" else DIM))
	row.add_child(dot)
	var text := "引擎桥接：可进入地图" if bridge == "interactive" else (
		"引擎桥接：本机夹具已就绪，Godot 地图待接" if bridge == "fixture" else "引擎桥接：资料已载入，入口待接")
	var label := _label(text, 12, MUTED, true)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(label)
	return row


func _topbar(eyebrow: String, subtitle: String, page_name: String, show_back: bool) -> HBoxContainer:
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 16)
	var left := VBoxContainer.new()
	left.add_theme_constant_override("separation", 0)
	left.add_child(_label(eyebrow, 19, TEXT))
	left.add_child(_label(subtitle, 10, MUTED))
	bar.add_child(left)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.add_child(spacer)
	if show_back:
		var back := _button("← 主页面", false)
		back.pressed.connect(_show_home)
		bar.add_child(back)
	var page := _label(page_name, 12, ACCENT)
	page.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	bar.add_child(page)
	return bar


func _stat_line(key: String, value: String, color: Color) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var key_label := _label(key, 12, DIM)
	key_label.custom_minimum_size = Vector2(96, 0)
	row.add_child(key_label)
	var value_label := _label(value, 12, color, true)
	value_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(value_label)
	return row


func _rule() -> HSeparator:
	var line := HSeparator.new()
	line.add_theme_constant_override("separation", 8)
	return line


func _spacer(height: int) -> Control:
	var spacer := Control.new()
	spacer.custom_minimum_size = Vector2(0, height)
	return spacer


func _margin(left: int, right: int, top: int, bottom: int) -> MarginContainer:
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", left)
	margin.add_theme_constant_override("margin_right", right)
	margin.add_theme_constant_override("margin_top", top)
	margin.add_theme_constant_override("margin_bottom", bottom)
	return margin


func _label(text: String, font_size: int, color: Color, wrap := false) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if wrap:
		label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return label


func _button(text: String, primary: bool) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_ALL
	button.custom_minimum_size = Vector2(0, 34)
	button.add_theme_font_size_override("font_size", 13)
	button.add_theme_color_override("font_color", Color(0.035, 0.045, 0.050) if primary else TEXT)
	button.add_theme_color_override("font_hover_color", Color(0.020, 0.030, 0.035) if primary else Color(1.0, 0.92, 0.70))
	button.add_theme_color_override("font_pressed_color", Color(0.020, 0.030, 0.035) if primary else ACCENT)
	button.add_theme_color_override("font_disabled_color", DIM)
	button.add_theme_stylebox_override("normal", _box(
		ACCENT if primary else Color(0.075, 0.105, 0.120, 0.88),
		ACCENT if primary else Color(0.50, 0.60, 0.64, 0.35), 1, 5))
	button.add_theme_stylebox_override("hover", _box(
		Color(0.95, 0.76, 0.38) if primary else Color(0.105, 0.145, 0.165, 0.96),
		ACCENT, 1, 5))
	button.add_theme_stylebox_override("pressed", _box(
		Color(0.68, 0.50, 0.20) if primary else Color(0.060, 0.090, 0.105, 0.96),
		ACCENT, 1, 5))
	button.add_theme_stylebox_override("disabled", _box(Color(0.060, 0.075, 0.085, 0.72), Color(0.25, 0.32, 0.35, 0.30), 1, 5))
	return button


func _box(color: Color, border: Color, width: int, radius: int) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.border_color = border
	style.border_width_left = width
	style.border_width_right = width
	style.border_width_top = width
	style.border_width_bottom = width
	style.corner_radius_top_left = radius
	style.corner_radius_top_right = radius
	style.corner_radius_bottom_left = radius
	style.corner_radius_bottom_right = radius
	return style


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		if _current_page == "scenarios":
			_show_home()
		else:
			get_tree().quit()
