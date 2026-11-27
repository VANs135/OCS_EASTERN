extends RefCounted

## TTW S08 pp.54–56（剧本册初设与 Alert 抽取）。
## TypeScript 迁移对照见 src/match/scorpion-setup.ts。
## The data adapter supplies printed deployment facts and the ordered Alert pool.

const CommandLog := preload("res://scripts/core/command_log.gd")
const OpeningAlerts := preload("res://works/third-winter/rules/opening_alerts.gd")
const Result := preload("res://scripts/core/result.gd")
const Rng := preload("res://scripts/core/rng.gd")


static func create_record(facts: Dictionary, seed: float) -> Dictionary:
	var outcome := OpeningAlerts.draw(Rng.create_rng_state(seed), facts.pool, 2)
	if not outcome.ok:
		return outcome
	var drawn: Array = []
	for draw: Dictionary in outcome.value.draws:
		drawn.append(draw.item)
	var opening := {
		"seat": "axis",
		"rng": outcome.value.rng,
		"units": facts.units,
		"pieces": facts.pieces,
		"lossChoices": facts.lossChoices,
		"drawnAlerts": drawn,
		"availableAlerts": outcome.value.remaining,
		"dumps": facts.dumps,
	}
	return Result.success(CommandLog.create_record({"kind": "setup", "opening": opening}))
