import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionGroundProfile } from '../import/ground-profile.ts'
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

type TransportDenomination = TransportType & { points: number }
export type TransportCounterLimit = TransportDenomination & { copies: number }
type TransportStock = TransportDenomination & { inUse: number; limit: number | null }

const stockKey = ({ side, mobility, allowance, points }: TransportDenomination) => `${side}:${mobility}:${allowance}:${points}`

function printedDenomination(definition: Definition<BackupUnit>): TransportDenomination | undefined {
  if (definition.kind !== 'transport' || definition.source.abilities?.includes('organic_truck')) return
  const profile = scorpionGroundProfile(definition, 'combat')
  const points = transportPoints(definition)
  if (!profile || !points || profile.mobility === 'track') return
  const { side, mobility, allowance } = profile
  return { side, mobility, allowance, points }
}

export function scorpionTransportStock(units: ScorpionInPlay['units'], side: Side,
  { catalog, transportCounterLimits = [] }: ScorpionSetupAssets): TransportStock[] {
  const limits = new Map<string, number>()
  for (const row of transportCounterLimits) {
    const key = stockKey(row)
    if (limits.has(key) || !Number.isSafeInteger(row.copies) || row.copies < 0) {
      throw new Error(`Invalid transport counter limit: ${key}`)
    }
    limits.set(key, row.copies)
  }
  const rows = new Map<string, TransportStock>()
  for (const definition of catalog.definitions.values()) {
    const denomination = printedDenomination(definition)
    if (denomination?.side !== side) continue
    const key = stockKey(denomination)
    rows.set(key, { ...denomination, inUse: 0, limit: limits.get(key) ?? null })
  }
  for (const key of limits.keys()) {
    if (key.startsWith(`${side}:`) && !rows.has(key)) throw new Error(`Unknown transport counter denomination: ${key}`)
  }
  for (const unit of Object.values(units)) {
    if (unit.side !== side || unit.combat || unit.organicTruck) continue
    const definition = catalog.definitions.get(unit.definition)
    const denomination = definition && printedDenomination(definition)
    const row = denomination && rows.get(stockKey(denomination))
    if (row) row.inUse++
  }
  return [...rows.values()].sort((a, b) => a.mobility.localeCompare(b.mobility) || a.allowance - b.allowance || a.points - b.points)
}

/** Check only increases so an older position above a now configured limit can still reduce that count. */
function assertTransportStock(before: ScorpionInPlay['units'], after: ScorpionInPlay['units'], side: Side, assets: ScorpionSetupAssets) {
  if (!assets.transportCounterLimits?.length) return
  const used = new Map(scorpionTransportStock(before, side, assets).map((row) => [stockKey(row), row.inUse]))
  for (const row of scorpionTransportStock(after, side, assets)) {
    const key = stockKey(row)
    if (row.limit !== null && row.inUse > row.limit && row.inUse > (used.get(key) ?? 0)) {
      throw new Error(`Transport counter stock exceeded: ${key} (${row.inUse}/${row.limit})`)
    }
  }
}

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
  const key = stockKey({ ...unit, points })
  for (const item of catalog.definitions.values()) {
    const denomination = printedDenomination(item)
    if (denomination && stockKey(denomination) === key) return item
  }
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
  replacements: readonly DeployedCounter[], spentMp: number, move: { ended: boolean; continuation?: number },
  assets?: ScorpionSetupAssets) {
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
  if (assets && replacements[0]) assertTransportStock(state.units, units, replacements[0].side, assets)
  const enteredHex = activity.transport?.enteredHex ?? false
  return { ...state, units, nextTransportSerial: serial,
    moved: [...state.moved.filter((id) => !ids.includes(id)), ...(move.ended || open ? newIds : [])],
    groundActivity: { ...activity, spent, transport: open ? { unitId: open, enteredHex } : undefined },
    overrunMarch: null, groundCaptureMove: null }
}

/** OCS 13.2c and 6.1f. Cargo stays on the boxes the player chooses. */
export function repackScorpionTransport(state: Readonly<ScorpionInPlay>, side: Side, action: RepackTransport,
  assets: ScorpionSetupAssets): ScorpionInPlay {
  const { catalog } = assets
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
  return replaceScorpionTransport(state, action.unitIds, replacements, spent, { ended: hasStarted, continuation }, assets)
}
