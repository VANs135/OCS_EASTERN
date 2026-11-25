import type { Side } from '@ocs-eastern/series/state-types'
import { deployScorpionGroundCounter } from '../import/scorpion-deployment.ts'
import { scorpionHexDistance, scorpionHexId } from '../import/hex-id.ts'
import { scorpionSupplyNetwork } from '../ttw/scorpion/supply-trace.ts'
import { scorpionGroundActivity } from './scorpion-ground-activity.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { scorpionSupplyPosition } from './scorpion-supply-position.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'
import { assertScorpionTransportWindow, collectTransportPoints, regularTransportDefinition, replaceScorpionTransport } from './scorpion-transport-points.ts'

export type ScorpionExtenderCommand = { type: 'form-extender'; unitIds: readonly string[] }
  | { type: 'dismantle-extender'; unitId: string; divisions?: readonly number[] }
  | { type: 'collapse-extender'; unitId: string; destination: string }

export type ExtenderDisplacement = { id: string; destinations: readonly string[]; displacedTo?: string }

/** OCS 12.7d–f and TTW 3.6. Use only the ordinary backs supplied in this counter mix. */
export function changeScorpionExtender(state: Readonly<ScorpionInPlay>, side: Side, action: ScorpionExtenderCommand,
  assets: ScorpionSetupAssets, railroad?: SupplyRailBoard): ScorpionInPlay {
  const { map, catalog } = assets
  assertScorpionTransportWindow(state, side)
  const activity = scorpionGroundActivity(state)
  if (action.type === 'form-extender') {
    const selected = collectTransportPoints(state, side, action.unitIds, catalog)
    const { unit } = selected[0]!
    if (side === 'soviet' && unit.mobility === 'truck') throw new Error('TTW 3.6 prohibits ordinary Soviet truck extenders')
    const definition = regularTransportDefinition(catalog, unit, 5)
    const truck = unit.mobility === 'truck'
    const face = truck ? 'Supply Extender - Truck 20MP' : 'Supply Extender - Leg 10MP'
    const asset = side === 'axis' ? catalog.aliases.get(face)?.[0]?.source.faces.combat?.asset : undefined
    if (!definition || !asset) throw new Error('This counter mix has no matching five-point Extender face')
    if (selected.reduce((sum, { points }) => sum + points, 0) !== 5 || selected.some(({ tokens }) => tokens > 0)) {
      throw new Error('Choose exactly five unloaded transport points')
    }
    if (selected.some(({ id }) => (activity.spent[id] ?? 0) > unit.allowance / 2 ||
      (state.moved.includes(id) && !Object.hasOwn(activity.spent, id)))) throw new Error('Each transport must retain half of its printed MA')
    const range = truck ? 20 : 10
    const network = scorpionSupplyNetwork(map, scorpionSupplyPosition(state, map, side, railroad))
    if (!network.canConnectExtender({ hex: unit.hex, range, mobility: unit.mobility })) {
      throw new Error('An Extender must connect to trace supply when formed')
    }
    const spent = Math.max(...selected.map(({ id }) => activity.spent[id] ?? 0)) + unit.allowance / 2
    const extender = { ...deployScorpionGroundCounter(definition, unit.hex, 0), extender: { range, asset } }
    return replaceScorpionTransport(state, action.unitIds, [extender], spent, { ended: true }, assets)
  }
  const unit = Object.hasOwn(state.units, action.unitId) ? state.units[action.unitId] : undefined
  if (!unit?.extender || unit.side !== side || state.moved.includes(action.unitId)) {
    throw new Error('Choose an existing friendly Extender that has not acted this phase')
  }
  if (action.type === 'collapse-extender') {
    const destination = scorpionHexId(action.destination)
    const [collapse] = scorpionExtenderDisplacements(state, side, [action.unitId], map, railroad)
    if (!collapse?.destinations.includes(destination)) throw new Error('Choose a supplied collapse destination within the special draw range')
    return flipScorpionExtender(state, action.unitId, destination, true)
  }
  const divisions = action.divisions ?? [5]
  if (divisions.reduce((sum, points) => sum + points, 0) !== 5) throw new Error('Allocate all five transport points')
  const points = divisions.map((count) => {
    const definition = regularTransportDefinition(catalog, unit, count)
    if (!definition) throw new Error('Use denominations available in the counter mix')
    return { ...deployScorpionGroundCounter(definition, unit.hex, 0), transportCargoTokens: 0 }
  })
  return replaceScorpionTransport(state, [action.unitId], points, unit.allowance / 2, { ended: false }, assets)
}

/** OCS 9.14d. The displacement itself ignores intervening terrain and enemy forces. */
export function scorpionExtenderDisplacements(state: Readonly<ScorpionInPlay>, side: Side, ids: readonly string[],
  map: ScorpionSetupAssets['map'], railroad?: SupplyRailBoard): ExtenderDisplacement[] {
  if (!ids.length) return []
  const units = { ...state.units }
  for (const id of ids) delete units[id]
  const network = scorpionSupplyNetwork(map, scorpionSupplyPosition({ ...state, units }, map, side, railroad))
  const supplied = new Map<string, boolean>()
  return ids.map((id) => {
    const { hex: from, extender } = state.units[id]!
    const destinations = [...map.hexes.keys()].filter((hex) => {
      if (hex === from || scorpionHexDistance(from, hex) > extender!.range) return false
      if (!supplied.has(hex)) supplied.set(hex, network.hasTrace(hex))
      return supplied.get(hex)
    })
    return { id, destinations }
  })
}

export function flipScorpionExtender(state: Readonly<ScorpionInPlay>, unitId: string, hex: string,
  spent: boolean): ScorpionInPlay {
  const unit = state.units[unitId]!
  return { ...state, units: { ...state.units, [unitId]: { ...unit, hex, extender: undefined, transportCargoTokens: 0 } },
    moved: spent ? [...new Set([...state.moved, unitId])] : state.moved }
}
