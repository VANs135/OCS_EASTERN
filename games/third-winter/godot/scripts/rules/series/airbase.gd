extends RefCounted


## OCS v4.3 §14.2a — 各级机场的活跃飞机容量。
static func active_capacity(level: int) -> int:
	return 4 + level
