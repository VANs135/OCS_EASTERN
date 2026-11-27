extends RefCounted

## Deterministic counterpart of packages/series/src/rng.ts.

const Result := preload("res://scripts/core/result.gd")
const ALGORITHM := "mulberry32"
const UINT32_RANGE := 0x100000000
const UINT32_MASK := 0xffffffff
const STATE_INCREMENT := 0x6d2b79f5
const MAX_DRAW_COUNT := 9007199254740991
const DIE_FACES := 6


static func create_rng_state(seed: float) -> Dictionary:
	var normalized := 0
	if is_finite(seed):
		var integral := floorf(absf(seed)) * signf(seed)
		normalized = int(fposmod(integral, float(UINT32_RANGE)))
	return _state(normalized, normalized, 0)


static func next_uint32(rng: Dictionary) -> Dictionary:
	if not _is_counter(rng.get("drawCount")) or rng.drawCount == MAX_DRAW_COUNT:
		return Result.failure("rng_draw_count", "随机抽取次数超出有效范围")
	var next := (int(rng.state) + STATE_INCREMENT) & UINT32_MASK
	var t := _multiply_uint32(next ^ (next >> 15), 1 | next)
	t = ((t + _multiply_uint32(t ^ (t >> 7), 61 | t)) ^ t) & UINT32_MASK
	return _draw(_state(rng.seed, next, rng.drawCount + 1), t ^ (t >> 14))


static func next_float(rng: Dictionary) -> Dictionary:
	var draw := next_uint32(rng)
	if not draw.ok:
		return draw
	return _draw(draw.value.rng, float(draw.value.value) / float(UINT32_RANGE))


static func roll_die(rng: Dictionary) -> Dictionary:
	var draw := pick_index(rng, DIE_FACES)
	if not draw.ok:
		return draw
	return _draw(draw.value.rng, draw.value.value + 1)


static func roll_dice(rng: Dictionary, count: int) -> Dictionary:
	if count < 1 or count > MAX_DRAW_COUNT:
		return Result.failure("rng_dice_count", "掷骰数量须为 ≥1 的整数，收到 %d" % count)
	var current := rng
	var faces: Array[int] = []
	var total := 0
	for index in count:
		var draw := roll_die(current)
		if not draw.ok:
			return draw
		var face: int = draw.value.value
		current = draw.value.rng
		faces.append(face)
		total += face
	return _draw(current, {"count": count, "faces": faces, "total": total})


static func roll_1d6(rng: Dictionary) -> Dictionary:
	return roll_dice(rng, 1)


static func roll_2d6(rng: Dictionary) -> Dictionary:
	return roll_dice(rng, 2)


static func pick_index(rng: Dictionary, size: int) -> Dictionary:
	if size < 1 or size > UINT32_RANGE:
		return Result.failure("rng_pick_size", "候选个数须为 1 至 2^32 的整数，收到 %d" % size)
	if size == 1:
		return _draw(rng, 0)
	var limit := UINT32_RANGE - UINT32_RANGE % size
	var draw := next_uint32(rng)
	while draw.ok and draw.value.value >= limit:
		draw = next_uint32(draw.value.rng)
	if not draw.ok:
		return draw
	return _draw(draw.value.rng, int(draw.value.value) % size)


static func advance(rng: Dictionary, steps: int) -> Dictionary:
	if not _is_counter(rng.get("drawCount")) or steps < 0 or steps > MAX_DRAW_COUNT - rng.drawCount:
		return Result.failure("rng_advance_count", "随机抽取次数或推进步数超出有效范围，收到 %d" % steps)
	var next := (int(rng.state) + _multiply_uint32(steps & UINT32_MASK, STATE_INCREMENT)) & UINT32_MASK
	return Result.success(_state(rng.seed, next, rng.drawCount + steps))


static func replay_from(seed: float, draw_count: int) -> Dictionary:
	if not _is_counter(draw_count):
		return Result.failure("rng_replay_count", "抽取次数须为 ≥0 的整数，收到 %d" % draw_count)
	return advance(create_rng_state(seed), draw_count)


static func verify_rng_state(rng: Dictionary) -> bool:
	if not _is_uint32(rng.get("seed")) or not _is_uint32(rng.get("state")) or not _is_counter(rng.get("drawCount")):
		return false
	var replay := replay_from(float(rng.seed), rng.drawCount)
	return replay.value.state == rng.state


static func _is_uint32(value: Variant) -> bool:
	return value is int and value >= 0 and value < UINT32_RANGE


static func _is_counter(value: Variant) -> bool:
	return value is int and value >= 0 and value <= MAX_DRAW_COUNT


static func _state(seed: int, state: int, draw_count: int) -> Dictionary:
	return {"seed": seed, "state": state, "drawCount": draw_count}


static func _draw(rng: Dictionary, value: Variant) -> Dictionary:
	return Result.success({"rng": rng, "value": value})


static func _multiply_uint32(left: int, right: int) -> int:
	# Only the low product and low half of the cross products fit in 32 bits.
	var left_low := left & 0xffff
	var right_low := right & 0xffff
	var cross := ((left >> 16) * right_low) + (left_low * (right >> 16))
	return (left_low * right_low + ((cross & 0xffff) << 16)) & UINT32_MASK
