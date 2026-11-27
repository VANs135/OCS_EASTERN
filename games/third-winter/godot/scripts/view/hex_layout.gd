extends RefCounted

## GDScript counterpart of src/view/scorpion-grid-layout.ts and src/view/hex-counter-layout.ts.
## Printed artwork pixels, counter pages and hex hit-testing only; rules never read this module.

const COLUMN_PITCH := 92.886
const ROW_PITCH := 107.282
const NORTH := 42.04
const SOUTH := 1832.5
const WEST := 463.0
const EAST := 2536.0
const X_ORIGIN := 429.14
const COLUMN_LIMIT := 22
const ROW_LIMIT := 17
const PAGE_SIZE := 4
const PAGE_POSITIONS := [
	[],
	[[0.0, 0.0]],
	[[-23.0, 0.0], [23.0, 0.0]],
	[[-19.0, -19.0], [19.0, -19.0], [0.0, 19.0]],
	[[-19.0, -19.0], [19.0, -19.0], [-19.0, 19.0], [19.0, 19.0]],
]


## Returns {column, row} or an empty dictionary when the printed id is malformed or off the artwork.
static func parse(hex: String) -> Dictionary:
	var parts := hex.to_lower().split(".")
	if parts.size() != 2 or not parts[0].begins_with("s"):
		return {}
	var column := parts[0].substr(1)
	var row := parts[1]
	if column.is_empty() or not column.is_valid_int() or row.is_empty() or not row.is_valid_int():
		return {}
	var values := {"column": int(column), "row": int(row)}
	if values.column < 1 or values.column > COLUMN_LIMIT or values.row < 1 or values.row > ROW_LIMIT:
		return {}
	return values


static func center(column: int, row: int) -> Dictionary:
	return {
		"x": X_ORIGIN + column * COLUMN_PITCH,
		"y": NORTH + (ROW_LIMIT - row + float(column % 2) / 2.0) * ROW_PITCH,
	}


## Printed stacking anchor: the outer rows are cropped, so the stack follows the visible slice.
static func layout(hex: String) -> Dictionary:
	var values := parse(hex)
	if values.is_empty():
		return {}
	var point := center(values.column, values.row)
	var top: float = maxf(NORTH, point.y - ROW_PITCH / 2.0)
	var bottom: float = minf(SOUTH, point.y + ROW_PITCH / 2.0)
	var visible: float = bottom - top
	return {"x": point.x, "y": (top + bottom) / 2.0,
		"scale": 1.0 if visible >= ROW_PITCH - 0.01 else visible / ROW_PITCH}


## Hit-test the printed polygon; the original center is used even on the clipped rows.
static func hex_at(x: float, y: float) -> String:
	if x < WEST or x > EAST or y < NORTH or y > SOUTH:
		return ""
	var radius := COLUMN_PITCH * 2.0 / 3.0
	var half_height := ROW_PITCH / 2.0
	for column in range(1, COLUMN_LIMIT + 1):
		for row in range(1, ROW_LIMIT + 1):
			var point := center(column, row)
			var dx := absf(x - point.x)
			var dy := absf(y - point.y)
			if dy <= half_height and dx <= radius * (1.0 - dy / ROW_PITCH):
				return "s%d.%02d" % [column, row]
	return ""


## Splits a hex stack into printed counter pages of at most four counters.
static func pages(counters: Array, scale: float = 1.0) -> Array:
	var result: Array = []
	var first := 0
	while first < counters.size():
		var page: Array = counters.slice(first, first + PAGE_SIZE)
		var size := 68.0 if page.size() == 1 else 42.0 if page.size() == 2 else 34.0
		var positions: Array = PAGE_POSITIONS[page.size()]
		var placed: Array = []
		for index in page.size():
			var counter: Dictionary = page[index]
			var position: Array = positions[index]
			var placed_counter: Dictionary = counter.duplicate()
			placed_counter.x = position[0] * scale
			placed_counter.y = position[1] * scale
			placed_counter.size = size * scale
			placed.append(placed_counter)
		result.append(placed)
		first += PAGE_SIZE
	return result
