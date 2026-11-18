import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionModeFace } from '../import/scorpion-mode-face.ts'
import { scorpionHexDistance, scorpionHexId } from '../import/hex-id.ts'
import { scorpionSupplySources } from '../ttw/scorpion/initial-map.ts'
import { scorpionStepCost } from '../ttw/scorpion/terrain-cost.ts'
import { applyScorpionCombatLosses } from './scorpion-combat-losses.ts'
import { recordScorpionGroundControl } from './scorpion-hex-control.ts'
import type { ScorpionCombat } from './scorpion-combat.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { scorpionEnemyZoc } from './scorpion-supply-position.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

export interface RetreatPlan {
  units: readonly string[]
  path: readonly string[]
  /** Unit selected for any loss required on entry to a particular step (zero based). */
  zocLosses?: Readonly<Record<number, string>>
}

export function retreatScorpionCombat(state: Readonly<ScorpionInPlay>, side: Side, involved: readonly string[],
  distance: number, plans: readonly RetreatPlan[], combat: ScorpionCombat, assets: ScorpionSetupAssets,
  rail?: SupplyRailBoard): ScorpionInPlay {
  if (distance === 0 && !plans.length) return state
  const expected = involved.filter((id) => Object.hasOwn(state.units, id))
  const all = plans.flatMap((plan) => plan.units)
  if (!distance || all.length === 0 || new Set(all).size !== all.length || expected.some((id) => !all.includes(id))) {
    throw new Error('Give a retreat route for every surviving participant')
  }
  let settled = state
  for (const plan of plans) settled = takeRoute(settled, side, involved, plan, distance, combat, assets, rail)
  for (const hex of new Set(all.map((id) => settled.units[id]?.hex))) {
    if (hex) assertScorpionStacking(settled, hex)
  }
  return settled
}

function takeRoute(state: Readonly<ScorpionInPlay>, side: Side, involved: readonly string[], plan: RetreatPlan,
  distance: number, combat: ScorpionCombat, assets: ScorpionSetupAssets, rail?: SupplyRailBoard): ScorpionInPlay {
  const { map, catalog } = assets
  const origin = state.units[plan.units[0] ?? '']?.hex
  const endpoint = plan.path.at(-1)
  if (!origin || !endpoint || scorpionHexDistance(origin, endpoint) !== distance ||
    !plan.units.some((id) => involved.includes(id))) throw new Error('Retreat must end the full option distance from its origin')
  const setup = { ...state.units }
  for (const id of plan.units) {
    const unit = setup[id]
    if (!unit || unit.side !== side || unit.hex !== origin || (!unit.combat && unit.organicTruck === undefined)) {
      throw new Error('A retreat stack must start together and contain only eligible friendly counters')
    }
    if (unit.moveMode || (!unit.headquarters && unit.allowance > 0)) continue
    const alternate = scorpionModeFace(unit, catalog.definitions.get(unit.definition), 'move')
    if (!alternate.allowance) throw new Error('This counter cannot retreat in its Move Mode')
    setup[id] = alternate
  }
  let settled: ScorpionInPlay = { ...state, units: setup }
  const enemy = side === 'axis' ? 'soviet' : 'axis'
  const rawZoc = scorpionEnemyZoc(state, map, side)
  const seen = new Set([origin])
  let from = origin
  const weather = state.turn.weather.ground === 'freeze' ? 'freeze' : 'dry'
  const usedLosses = new Set<number>()
  for (const [index, at] of plan.path.entries()) {
    const to = scorpionHexId(at)
    const moving = plan.units.filter((id) => Object.hasOwn(settled.units, id))
    if (!moving.length) break
    if (seen.has(to) || combat.heldAtStart[enemy].includes(to) || scorpionSupplySources[enemy].some((id) => id === to) ||
      moving.some((id) => scorpionStepCost(map, from, to, settled.units[id]!.mobility, weather) === null)) {
      throw new Error('Retreat crosses an illegal hex or a hex occupied by the enemy at combat start')
    }
    assertNoScorpionSpecialCapture(settled, side, to)
    const dg = moving.filter((id) => settled.units[id]!.combat && settled.units[id]!.disorganized)
    const units = { ...settled.units }
    const enteredZoc = rawZoc.has(to) && moving.some((id) => units[id]!.combat)
    for (const id of moving) units[id] = { ...units[id]!, hex: to,
      disorganized: units[id]!.combat && (units[id]!.disorganized || enteredZoc || index >= 1) }
    if (enteredZoc) {
      for (const [id, unit] of Object.entries(units)) if (unit.hex === to && unit.side === side && unit.combat) {
        units[id] = { ...unit, disorganized: true }
      }
    }
    settled = recordScorpionGroundControl({ ...settled, units }, side, [to])
    if (enteredZoc && dg.length) {
      const loss = plan.zocLosses?.[index]
      if (!loss || !dg.includes(loss)) throw new Error('Choose a DG retreating unit to lose one step in enemy ZOC')
      usedLosses.add(index)
      settled = applyScorpionCombatLosses(settled, new Map([[loss, 1]]), assets, rail)
    }
    from = to
    seen.add(to)
  }
  if (Object.keys(plan.zocLosses ?? {}).length !== usedLosses.size) throw new Error('Retreat includes an unnecessary ZOC loss')
  return settled
}

export function assertScorpionStacking(state: Readonly<ScorpionInPlay>, hex: string) {
  if (Object.values(state.units).filter((unit) => unit.combat && unit.hex === hex)
    .reduce((re, unit) => re + unit.printedRe - unit.stepsLost, 0) > 10) throw new Error('Position exceeds stacking limit')
}

export function assertNoScorpionSpecialCapture(state: Readonly<ScorpionInPlay>, side: Side, hex: string) {
  const enemy = side === 'axis' ? 'soviet' : 'axis'
  if (Object.values(state.units).some((unit) => unit.side === enemy && unit.hex === hex) ||
    state.pieces.some((piece) => piece.side === enemy && piece.location.kind === 'hex' && piece.location.hex === hex) ||
    state.airBases?.some((base) => base.side === enemy && base.hex === hex) || state.dumps[`${enemy}:hex:${hex}`]?.tokens) {
    throw new Error('This entry requires the specialized OCS 9.14 capture procedure')
  }
}
