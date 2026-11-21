import type { Side } from '@ocs-eastern/series/state-types'
import { zocAffectsAction } from '@ocs-eastern/series/zoc'
import { scorpionModeFace } from '../import/scorpion-mode-face.ts'
import type { DeployedCounter } from '../import/scorpion-deployment.ts'
import { scorpionHexDistance, scorpionHexId } from '../import/hex-id.ts'
import { scorpionSupplySources } from '../ttw/scorpion/initial-map.ts'
import { scorpionStepCost } from '../ttw/scorpion/terrain-cost.ts'
import { detachScorpionBreakdowns, scorpionBreakdownChoices } from './scorpion-breakdowns.ts'
import type { ScorpionBreakdownOrder } from './scorpion-breakdowns.ts'
import { applyScorpionCombatLosses } from './scorpion-combat-losses.ts'
import { disorganizeScorpionHex } from './scorpion-disorganization.ts'
import { ScorpionRemnantChoice } from './scorpion-remnants.ts'
import { resolveScorpionEntry } from './scorpion-capture.ts'
import type { ScorpionCapturePolicy } from './scorpion-capture.ts'
import type { ScorpionCombat } from './scorpion-combat.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { scorpionEnemyZoc } from './scorpion-supply-position.ts'
import { assertScorpionStacking } from './scorpion-stacking.ts'

export interface RetreatPlan {
  /**
   * Stable id for this retreat stack. Optional so existing callers that give one plan per origin
   * keep working; when present it lets several stacks leave the same origin hex.
   */
  group?: string
  units: readonly string[]
  path: readonly string[]
  breakdowns?: readonly ScorpionBreakdownOrder[]
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

export class ScorpionRetreatLossChoice extends Error {
  readonly origin: string
  readonly group?: string
  readonly hex: string
  readonly step: number
  readonly candidates: readonly string[]

  constructor(origin: string, hex: string, step: number, candidates: readonly string[], group?: string) {
    super('Choose a DG retreating unit to lose one step in enemy ZOC')
    this.origin = origin
    this.group = group
    this.hex = hex
    this.step = step
    this.candidates = candidates
  }
}

export class ScorpionRetreatRemnantChoice extends ScorpionRemnantChoice {
  readonly origin: string
  readonly group?: string
  readonly step: number

  constructor(origin: string, step: number, choice: ScorpionRemnantChoice, group?: string) {
    super(choice.division, choice.candidates)
    this.origin = origin
    this.group = group
    this.step = step
  }
}

function scorpionRetreatNeighbors(origin: string, path: readonly string[], side: Side,
  combat: ScorpionCombat, map: ScorpionSetupAssets['map']) {
  const enemy = opposing(side)
  return map.neighbors(path.at(-1) ?? origin).filter((hex) => hex !== origin && !path.includes(hex) &&
    !combat.heldAtStart[enemy].includes(hex) && !scorpionSupplySources[enemy].some((id) => id === hex))
}

export function scorpionRetreatPathOptions(state: Readonly<ScorpionInPlay>, side: Side, route: RetreatRoute,
  combat: ScorpionCombat, assets: ScorpionSetupAssets): readonly string[] {
  const { origin, path, units } = route
  let counters
  try { counters = units.map((id) => retreatMode(state.units[id], side, origin, assets.catalog)) } catch { return [] }
  return scorpionRetreatNeighbors(origin, path, side, combat, assets.map).filter((hex) =>
    passableRetreatStep(state, side, path.at(-1) ?? origin, hex, counters, assets.map))
}

export function canScorpionRetreat(unit: DeployedCounter, side: Side, origin: string, catalog: ScorpionSetupAssets['catalog']) {
  try {
    retreatMode(unit, side, origin, catalog)
    return true
  } catch {
    return false
  }
}

/** Draft options use the same starting faces as the retreat reducer. */
export function* scorpionRetreatBreakdownChoices(state: Readonly<ScorpionInPlay>, side: Side, route: RetreatRoute,
  assets: ScorpionSetupAssets) {
  if (!assets.breakdowns) return
  let ready
  try { ready = prepareRoute(state, side, { ...route, breakdowns: undefined }, assets).state } catch { return }
  yield* scorpionBreakdownChoices(ready, side, route.units, assets)
}

export function retreatScorpionCombat(state: Readonly<ScorpionInPlay>, side: Side, involved: readonly string[],
  distance: number, plans: readonly RetreatPlan[], combat: ScorpionCombat, assets: ScorpionSetupAssets,
  policy: ScorpionCapturePolicy) {
  if (distance === 0 && !plans.length) return { state, pending: null }
  const expected = involved.filter((id) => Object.hasOwn(state.units, id))
  const all = plans.flatMap((plan) => plan.units)
  if (!distance || all.length === 0 || new Set(all).size !== all.length || expected.some((id) => !all.includes(id))) {
    throw new Error('Give a retreat route for every surviving participant')
  }
  const routes = plans.map((plan, index) => {
    const origin = state.units[plan.units[0] ?? '']?.hex
    if (!origin || !plan.units.some((id) => involved.includes(id))) throw new Error('Each retreat stack must include a surviving participant')
    const route = { ...plan, group: retreatGroupKey(plan.group, index), origin, path: plan.path.map(scorpionHexId) }
    validateRoute(route, side, distance, combat, assets.map)
    for (const id of route.units) retreatMode(state.units[id], side, origin, assets.catalog)
    validateRetreatTrucks(route, state)
    return route
  })
  const groups = new Set(routes.map(({ group }) => group))
  if (groups.size !== routes.length) throw new Error('Give each retreat stack its own group id')
  // A capture can suspend the first stack. Validate the entire allocation before any route is committed.
  let checked = state
  for (const route of routes) if (route.breakdowns?.length) checked = prepareRoute(checked, side, route, assets).state
  return followRetreat(state, { side, distance, routes, nextRoute: 0, nextStep: 0 }, combat, assets, policy)
}

export function resumeScorpionCombatRetreat(state: Readonly<ScorpionInPlay>, progress: ScorpionCombatRetreat,
  changes: ContinueCombatRetreat['routes'], combat: ScorpionCombat, assets: ScorpionSetupAssets, policy: ScorpionCapturePolicy) {
  if (state.capture) throw new Error('Resolve the pending special capture before continuing the retreat')
  if (!changes) return followRetreat(state, progress, combat, assets, policy)
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
  return followRetreat(state, { ...progress, routes: updated }, combat, assets, policy)
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

/** Stable per-stack key; a plan that names no group falls back to its index, so old callers stay valid. */
function retreatGroupKey(group: string | undefined, index: number) {
  if (group === undefined) return `group:${index}`
  if (!group) throw new Error('A retreat group id cannot be empty')
  return group
}

/** OCS 9.12d and 13.2g(E). An organic truck can accompany retreating combat units. */
function validateRetreatTrucks(route: RetreatRoute, state: Readonly<ScorpionInPlay>) {
  if (route.units.some((id) => state.units[id]?.organicTruck !== undefined) &&
      !route.units.some((id) => state.units[id]?.combat)) {
    throw new Error('An organic truck cannot retreat without a combat unit')
  }
}

function validateRoute(route: RetreatRoute, side: Side, distance: number, combat: ScorpionCombat, map: ScorpionSetupAssets['map']) {
  const endpoint = route.path.at(-1)
  if (!endpoint || scorpionHexDistance(route.origin, endpoint) !== distance) {
    throw new Error('Retreat must end the full option distance from its origin')
  }
  for (const [index, hex] of route.path.entries()) {
    if (!scorpionRetreatNeighbors(route.origin, route.path.slice(0, index), side, combat, map).includes(hex)) {
      throw new Error('Retreat crosses an illegal hex or a hex occupied by the enemy at combat start')
    }
  }
  if (Object.keys(route.zocLosses ?? {}).some((step) => !/^(0|[1-9]\d*)$/.test(step) || Number(step) >= route.path.length)) {
    throw new Error('Choose a loss on the retreat path')
  }
  if (Object.keys(route.remnantHexes ?? {}).some((step) => !Object.hasOwn(route.zocLosses ?? {}, step))) {
    throw new Error('A retreating remnant requires a loss at that step')
  }
}

function prepareRoute(state: Readonly<ScorpionInPlay>, side: Side, route: RetreatRoute, assets: ScorpionSetupAssets) {
  const setup = { ...state.units }
  for (const id of route.units) setup[id] = retreatMode(setup[id], side, route.origin, assets.catalog)
  const split = detachScorpionBreakdowns({ ...state, units: setup }, side, route.breakdowns ?? [], route.units, assets)
  return { state: split.state, route: { ...route, breakdowns: undefined, units: [...route.units, ...split.detachedIds] } }
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
  assets: ScorpionSetupAssets, policy: ScorpionCapturePolicy): { state: ScorpionInPlay; pending: ScorpionCombatRetreat | null } {
  const { side, nextRoute, nextStep } = progress
  const routes = [...progress.routes]
  const rawZoc = scorpionEnemyZoc(state, assets.map, side)
  let settled = state
  for (let i = nextRoute; i < routes.length; i++) {
    let route = routes[i]!
    const firstStep = i === nextRoute ? nextStep : 0
    if (firstStep === 0) {
      const prepared = prepareRoute(settled, side, route, assets)
      settled = prepared.state
      routes[i] = route = prepared.route
    }
    for (let step = firstStep; step < route.path.length; step++) {
      settled = retreatStep(settled, side, route, step, rawZoc, assets, policy)
      if (settled.victory) return { state: settled, pending: null }
      if (settled.capture) return { state: settled, pending: { ...progress, routes, nextRoute: i, nextStep: step + 1 } }
    }
  }
  for (const hex of new Set(routes.flatMap(({ units }) => units.map((id) => settled.units[id]?.hex)))) {
    if (hex) assertScorpionStacking(settled, hex)
  }
  return { state: settled, pending: null }
}

function retreatStep(state: Readonly<ScorpionInPlay>, side: Side, route: RetreatRoute, index: number,
  rawZoc: ReadonlySet<string>, assets: ScorpionSetupAssets, policy: ScorpionCapturePolicy): ScorpionInPlay {
  const to = route.path[index]!
  const from = index === 0 ? route.origin : route.path[index - 1]!
  const moving = route.units.filter((id) => Object.hasOwn(state.units, id))
  const loss = route.zocLosses?.[index]
  if (!moving.length) {
    if (loss !== undefined) throw new Error('Retreat includes an unnecessary ZOC loss')
    return state
  }
  if (!passableRetreatStep(state, side, from, to, moving.map((id) => state.units[id]!), assets.map)) {
    throw new Error('Retreat crosses an illegal hex or an enemy combat unit')
  }
  const units = { ...state.units }
  const enteredZoc = zocAffectsAction('retreat', rawZoc.has(to), false) && moving.some((id) => units[id]!.combat)
  const dg = enteredZoc ? moving.filter((id) => units[id]!.combat && units[id]!.disorganized) : []
  if (dg.length && (!loss || !dg.includes(loss))) throw new ScorpionRetreatLossChoice(route.origin, to, index, dg, route.group)
  if (loss !== undefined && !dg.length) throw new Error('Retreat includes an unnecessary ZOC loss')
  for (const id of moving) units[id] = { ...units[id]!, hex: to }
  if (enteredZoc || (index === 1 && moving.some((id) => units[id]!.combat))) disorganizeScorpionHex(units, to, side)
  // OCS 9.12f. The 9.14 entry uses movement timing, even though the retreat follows combat.
  const captured = resolveScorpionEntry({ ...state, units }, side, to, moving, assets, false, policy, route.path.slice(index + 1))
  if (!loss) return captured
  const remnantHex = route.remnantHexes?.[index]
  try {
    return applyScorpionCombatLosses(captured, new Map([[loss, 1]]), assets, policy.supplyRail,
      remnantHex === undefined ? [] : [{ divisionId: loss, hex: remnantHex }])
  } catch (error) {
    if (error instanceof ScorpionRemnantChoice) throw new ScorpionRetreatRemnantChoice(route.origin, index, error, route.group)
    throw error
  }
}

function passableRetreatStep(state: Readonly<ScorpionInPlay>, side: Side, from: string, to: string,
  counters: readonly DeployedCounter[], map: ScorpionSetupAssets['map']) {
  const weather = state.turn.weather.ground === 'freeze' ? 'freeze' : 'dry'
  return counters.every((unit) => scorpionStepCost(map, from, to, unit.mobility, weather) !== null) &&
    !Object.values(state.units).some((unit) => unit.hex === to && unit.side !== side && unit.combat)
}

const opposing = (side: Side): Side => side === 'axis' ? 'soviet' : 'axis'
