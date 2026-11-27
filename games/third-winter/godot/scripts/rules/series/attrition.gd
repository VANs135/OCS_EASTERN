extends RefCounted

## OCS v4.3 Charts p.2 — attrition losses by stack steps and AR (0–5). Rows list the upper bounds
## for 0, 1, 2 and 4 losses.
const THRESHOLDS := [[1, 3, 5, 7], [2, 4, 6, 8], [3, 5, 7, 9], [5, 7, 9, 11], [7, 9, 10, 11],
	[8, 10, 11, 12]]
const LOSSES := [0, 1, 2, 4]


static func loss(steps: int, rating: int, dice: Array) -> int:
	if steps < 1 or rating < 0 or rating >= THRESHOLDS.size():
		return -1
	var row: Array = THRESHOLDS[rating]
	var total: int = int(dice[0]) + int(dice[1]) + (3 if steps >= 5 else 0)
	var result := -1
	for index in row.size():
		if total <= int(row[index]):
			result = index
			break
	if result < 0:
		return steps
	return min(steps, int(LOSSES[result]))
