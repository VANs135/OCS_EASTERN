import type { Side } from '@ocs-eastern/series/state-types'
import { deployScorpionGroundCounter } from '../import/scorpion-deployment.ts'
import type { DeployedCounter } from '../import/scorpion-deployment.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { Definition } from '../import/unit-catalog.ts'
import { scorpionRegularBarrageTargets } from './scorpion-barrage-timing.ts'
import { scorpionGroundActivity } from './scorpion-ground-activity.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { carriedScorpionTokens } from './scorpion-sp-payment.ts'

type Catalog = ScorpionSetupAssets['catalog']
type TransportType = Pick<DeployedCounter, 'side' | 'mobility' | 'allowance'>

export type RepackTransport = { type: 'repack-transport'; unitIds: readonly string[];
  divisions: readonly { points: number; tokens: number }[]; continueWith?: number }

export function assertScorpionTransportWindow(state: Readonly<ScorpionInPlay>, side: Side) {
  if (state.turn.step.kind !== 'player-turn' || state.cursor.phasing !== side || state.cursor.phase !== 'movement' ||
    state.turn.weather.ground === 'thaw' || state.combat || scorpionRegularBarrageTargets(state).size) {
    throw new Error('Reorganize transport points in the friendly Movement Phase')
  }
}

export function transportPoints(definition: Definition<BackupUnit> | undefined) {
  const points = definition?.source.faces.combat?.stats.transport
  return typeof points === 'number' && Number.isSafeInteger(points) && points > 0 ? points : undefined
}

export function regularTransportDefinition(catalog: Catalog, unit: TransportType, points: number) {
  return [...catalog.definitions.values()].find((item) => {
    if (item.kind !== 'transport' || item.source.side !== unit.side || item.source.abilities?.includes('organic_truck')) return false
    const face = item.source.faces.combat
    return transportPoints(item) === points && face?.stats.move === unit.allowance &&
      face.maColor === (unit.mobility === 'truck' ? 'black' : 'white')
  })
}

export function collectTransportPoints(state: Readonly<ScorpionInPlay>, side: Side, ids: readonly string[], catalog: Catalog) {
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Choose distinct ordinary transport counters')
  const first = state.units[ids[0]!]
  return ids.map((id) => {
    const unit = Object.hasOwn(state.units, id) ? state.units[id] : undefined
    const definition = unit && catalog.definitions.get(unit.definition)
    const points = definition?.kind === 'transport' ? transportPoints(definition) : undefined
    if (!unit || unit.combat || unit.side !== side || unit.organicTruck || unit.extender || definition?.kind !== 'transport' ||
      !points || unit.hex !== first?.hex || unit.allowance !== first.allowance || unit.mobility !== first.mobility) {
      throw new Error('Choose ordinary transport counters of the same type in one hex')
    }
    return { id, unit, points, tokens: carriedScorpionTokens(unit) }
  })
}

export function replaceScorpionTransport(state: Readonly<ScorpionInPlay>, ids: readonly string[],
  replacements: readonly DeployedCounter[], spentMp: number, move: { ended: boolean; continuation?: number }) {
  const activity = scorpionGroundActivity(state)
  const units = { ...state.units }
  const spent = { ...activity.spent }
  for (const id of ids) { delete units[id]; delete spent[id] }
  let serial = state.nextTransportSerial ?? 1
  const newIds = replacements.map((unit, index) => {
    let id = ids[index]
    if (id === undefined) {
      do { id = `transport:${unit.side}:${serial++}` } while (Object.hasOwn(units, id))
    }
    units[id] = unit
    spent[id] = spentMp
    return id
  })
  const open = move.continuation === undefined ? undefined : newIds[move.continuation]
  const enteredHex = activity.transport?.enteredHex ?? false
  return { ...state, units, nextTransportSerial: serial,
    moved: [...state.moved.filter((id) => !ids.includes(id)), ...(move.ended || open ? newIds : [])],
    groundActivity: { ...activity, spent, transport: open ? { unitId: open, enteredHex } : undefined },
    overrunMarch: null, groundCaptureMove: null }
}

/** OCS 13.2c and 6.1f. Cargo stays on the boxes the player chooses. */
export function repackScorpionTransport(state: Readonly<ScorpionInPlay>, side: Side, action: RepackTransport,
  { catalog }: ScorpionSetupAssets): ScorpionInPlay {
  assertScorpionTransportWindow(state, side)
  const selected = collectTransportPoints(state, side, action.unitIds, catalog)
  const base = selected[0]!.unit
  const points = selected.reduce((sum, row) => sum + row.points, 0)
  const tokens = selected.reduce((sum, row) => sum + row.tokens, 0)
  if (!action.divisions.length || action.divisions.reduce((sum, row) => sum + row.points, 0) !== points ||
    action.divisions.reduce((sum, row) => sum + row.tokens, 0) !== tokens) throw new Error('Keep all transport points and cargo')
  const replacements = action.divisions.map(({ points, tokens }) => {
    const definition = regularTransportDefinition(catalog, base, points)
    if (!definition || !Number.isSafeInteger(tokens) || tokens < 0 || tokens > points * 4) {
      throw new Error('Choose printed transport denominations and cargo within their capacities')
    }
    return { ...deployScorpionGroundCounter(definition, base.hex, 0), transportCargoTokens: tokens }
  })
  const activity = scorpionGroundActivity(state)
  const active = activity.transport?.unitId
  const ended = action.unitIds.some((id) => state.moved.includes(id) && id !== active)
  const hasStarted = action.unitIds.some((id) => state.moved.includes(id))
  const continuation = action.continueWith
  if (continuation !== undefined && (ended || !action.unitIds.includes(active ?? '') || !Number.isSafeInteger(continuation) ||
    continuation < 0 || continuation >= replacements.length)) throw new Error('Only the active transport may retain movement after repacking')
  const spent = Math.max(...action.unitIds.map((id) => activity.spent[id] ?? 0))
  return replaceScorpionTransport(state, action.unitIds, replacements, spent, { ended: hasStarted, continuation })
}
