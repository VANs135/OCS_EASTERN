import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionModeFace } from '../import/scorpion-mode-face.ts'
import type { DeployedCounter } from '../import/scorpion-deployment.ts'
import { scorpionHexDistance, scorpionHexId } from '../import/hex-id.ts'
import { scorpionSupplySources } from '../ttw/scorpion/initial-map.ts'
import { scorpionStepCost } from '../ttw/scorpion/terrain-cost.ts'
import { applyScorpionCombatLosses } from './scorpion-combat-losses.ts'
import { resolveScorpionEntry } from './scorpion-capture.ts'
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
  remnantHexes?: Readonly<Record<number, string>>
}

type RetreatRoute = RetreatPlan & { origin: string }
type RetreatRouteSuffix = Pick<RetreatPlan, 'path' | 'zocLosses' | 'remnantHexes'>

export interface ScorpionCombatRetreat {
  side: Side
  distance: number
  routes: readonly RetreatRoute[]
  nextRoute: number
  nextStep: number
}

export type ContinueCombatRetreat = { type: 'continue-combat-retreat'; routes?: readonly RetreatRouteSuffix[] }

export function retreatScorpionCombat(state: Readonly<ScorpionInPlay>, side: Side, involved: readonly string[],
  distance: number, plans: readonly RetreatPlan[], combat: ScorpionCombat, assets: ScorpionSetupAssets,
  rail?: SupplyRailBoard) {
  if (distance === 0 && !plans.length) return { state, pending: null }
  const expected = involved.filter((id) => Object.hasOwn(state.units, id))
  const all = plans.flatMap((plan) => plan.units)
  if (!distance || all.length === 0 || new Set(all).size !== all.length || expected.some((id) => !all.includes(id))) {
    throw new Error('Give a retreat route for every surviving participant')
  }
  const routes = plans.map((plan) => {
    const origin = state.units[plan.units[0] ?? '']?.hex
    if (!origin || !plan.units.some((id) => involved.includes(id))) throw new Error('Each retreat stack must include a surviving participant')
    const route = { ...plan, origin, path: plan.path.map(scorpionHexId) }
    validateRoute(route, side, distance, combat, assets.map)
    for (const id of route.units) retreatMode(state.units[id], side, origin, assets.catalog)
    return route
  })
  return followRetreat(state, { side, distance, routes, nextRoute: 0, nextStep: 0 }, combat, assets, rail)
}

export function resumeScorpionCombatRetreat(state: Readonly<ScorpionInPlay>, progress: ScorpionCombatRetreat,
  changes: ContinueCombatRetreat['routes'], combat: ScorpionCombat, assets: ScorpionSetupAssets, rail?: SupplyRailBoard) {
  if (state.capture) throw new Error('Resolve the pending special capture before continuing the retreat')
  if (!changes) return followRetreat(state, progress, combat, assets, rail)
  const { routes, nextRoute, nextStep, side, distance } = progress
  if (changes.length !== routes.length - nextRoute) throw new Error('Provide a new route suffix for every unfinished retreat stack')
  const updated = routes.map((route, index) => {
    const change = changes[index - nextRoute]
    if (!change) return route
    const prefix = index === nextRoute ? nextStep : 0
    const updatedRoute = { ...route, path: [...route.path.slice(0, prefix), ...change.path.map(scorpionHexId)],
      zocLosses: replaceRetreatChoices(route.zocLosses, change.zocLosses, prefix, change.path.length),
      remnantHexes: replaceRetreatChoices(route.remnantHexes, change.remnantHexes, prefix, change.path.length) }
    validateRoute(updatedRoute, side, distance, combat, assets.map)
    return updatedRoute
  })
  return followRetreat(state, { ...progress, routes: updated }, combat, assets, rail)
}

function replaceRetreatChoices(previous: RetreatPlan['zocLosses'], proposed: RetreatPlan['zocLosses'], prefix: number, length: number) {
  const kept = Object.entries(previous ?? {}).filter(([step]) => Number(step) < prefix)
  const replacement = Object.entries(proposed ?? {}).map(([step, choice]) => {
    const offset = Number(step)
    if (!/^(0|[1-9]\d*)$/.test(step) || offset >= length) throw new Error('Choose a loss on the remaining retreat path')
    return [prefix + offset, choice] as const
  })
  return Object.fromEntries([...kept, ...replacement])
}

function validateRoute(route: RetreatRoute, side: Side, distance: number, combat: ScorpionCombat, map: ScorpionSetupAssets['map']) {
  const endpoint = route.path.at(-1)
  if (!endpoint || scorpionHexDistance(route.origin, endpoint) !== distance) {
    throw new Error('Retreat must end the full option distance from its origin')
  }
  const enemy = opposing(side)
  const seen = new Set([route.origin])
  let from = route.origin
  for (const hex of route.path) {
    if (seen.has(hex) || !map.neighbors(from).includes(hex) || combat.heldAtStart[enemy].includes(hex) ||
      scorpionSupplySources[enemy].some((id) => id === hex)) {
      throw new Error('Retreat crosses an illegal hex or a hex occupied by the enemy at combat start')
    }
    seen.add(hex)
    from = hex
  }
  if (Object.keys(route.zocLosses ?? {}).some((step) => !/^(0|[1-9]\d*)$/.test(step) || Number(step) >= route.path.length)) {
    throw new Error('Choose a loss on the retreat path')
  }
  if (Object.keys(route.remnantHexes ?? {}).some((step) => !Object.hasOwn(route.zocLosses ?? {}, step))) {
    throw new Error('A retreating remnant requires a loss at that step')
  }
}

function prepareRoute(state: Readonly<ScorpionInPlay>, side: Side, route: RetreatRoute, { catalog }: ScorpionSetupAssets) {
  const setup = { ...state.units }
  for (const id of route.units) setup[id] = retreatMode(setup[id], side, route.origin, catalog)
  return { ...state, units: setup }
}

function retreatMode(unit: DeployedCounter | undefined, side: Side, origin: string, catalog: ScorpionSetupAssets['catalog']) {
  if (!unit || unit.side !== side || unit.hex !== origin || (!unit.combat && unit.organicTruck === undefined)) {
    throw new Error('A retreat stack must start together and contain only eligible friendly counters')
  }
  if (unit.moveMode || (!unit.headquarters && unit.allowance > 0)) return unit
  const alternate = scorpionModeFace(unit, catalog.definitions.get(unit.definition), 'move')
  if (!alternate.allowance) throw new Error('This counter cannot retreat in its Move Mode')
  return alternate
}

function followRetreat(state: Readonly<ScorpionInPlay>, progress: ScorpionCombatRetreat, combat: ScorpionCombat,
  assets: ScorpionSetupAssets, rail?: SupplyRailBoard): { state: ScorpionInPlay; pending: ScorpionCombatRetreat | null } {
  const { side, routes, nextRoute, nextStep } = progress
  const rawZoc = scorpionEnemyZoc(state, assets.map, side)
  let settled = state
  for (let i = nextRoute; i < routes.length; i++) {
    const route = routes[i]!
    const firstStep = i === nextRoute ? nextStep : 0
    if (firstStep === 0) settled = prepareRoute(settled, side, route, assets)
    for (let step = firstStep; step < route.path.length; step++) {
      settled = retreatStep(settled, side, route, step, rawZoc, assets, rail)
      if (settled.victory) return { state: settled, pending: null }
      if (settled.capture) return { state: settled, pending: { ...progress, nextRoute: i, nextStep: step + 1 } }
    }
  }
  for (const hex of new Set(routes.flatMap(({ units }) => units.map((id) => settled.units[id]?.hex)))) {
    if (hex) assertScorpionStacking(settled, hex)
  }
  return { state: settled, pending: null }
}

function retreatStep(state: Readonly<ScorpionInPlay>, side: Side, route: RetreatRoute, index: number,
  rawZoc: ReadonlySet<string>, assets: ScorpionSetupAssets, rail?: SupplyRailBoard): ScorpionInPlay {
  const to = route.path[index]!
  const from = index === 0 ? route.origin : route.path[index - 1]!
  const moving = route.units.filter((id) => Object.hasOwn(state.units, id))
  const loss = route.zocLosses?.[index]
  if (!moving.length) {
    if (loss !== undefined) throw new Error('Retreat includes an unnecessary ZOC loss')
    return state
  }
  const weather = state.turn.weather.ground === 'freeze' ? 'freeze' : 'dry'
  if (moving.some((id) => scorpionStepCost(assets.map, from, to, state.units[id]!.mobility, weather) === null) ||
    Object.values(state.units).some((unit) => unit.hex === to && unit.side !== side && unit.combat)) {
    throw new Error('Retreat crosses an illegal hex or an enemy combat unit')
  }
  const units = { ...state.units }
  const enteredZoc = rawZoc.has(to) && moving.some((id) => units[id]!.combat)
  const dg = enteredZoc ? moving.filter((id) => units[id]!.combat && units[id]!.disorganized) : []
  if (dg.length && (!loss || !dg.includes(loss))) throw new Error('Choose a DG retreating unit to lose one step in enemy ZOC')
  if (loss !== undefined && !dg.length) throw new Error('Retreat includes an unnecessary ZOC loss')
  for (const id of moving) units[id] = { ...units[id]!, hex: to,
    disorganized: units[id]!.combat && (units[id]!.disorganized || enteredZoc || index >= 1) }
  if (enteredZoc) for (const [id, unit] of Object.entries(units)) {
    if (unit.hex === to && unit.side === side && unit.combat) units[id] = { ...unit, disorganized: true }
  }
  // OCS 9.12f. The 9.14 entry uses movement timing, even though the retreat follows combat.
  const captured = resolveScorpionEntry({ ...state, units }, side, to, moving, assets, false, rail)
  const remnantHex = route.remnantHexes?.[index]
  return loss ? applyScorpionCombatLosses(captured, new Map([[loss, 1]]), assets, rail,
    remnantHex === undefined ? [] : [{ divisionId: loss, hex: remnantHex }]) : captured
}

export function assertScorpionStacking(state: Readonly<ScorpionInPlay>, hex: string) {
  if (Object.values(state.units).filter((unit) => unit.combat && unit.hex === hex)
    .reduce((re, unit) => re + unit.printedRe - unit.stepsLost, 0) > 10) throw new Error('Position exceeds stacking limit')
}

const opposing = (side: Side): Side => side === 'axis' ? 'soviet' : 'axis'
