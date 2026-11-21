import type { Side } from '@ocs-eastern/series/state-types'
import type { DeployedCounter } from '../import/scorpion-deployment.ts'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import { scorpionSupplyNetwork } from '../ttw/scorpion/supply-trace.ts'
import type { TracePosition } from '../ttw/scorpion/supply-trace.ts'
import { spendScorpionDump } from './scorpion-dumps.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { scorpionSupplyPosition } from './scorpion-supply-position.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

export type SupplyPayment = { dumpId: string; tokens: number }

export function carriedScorpionTokens(unit: DeployedCounter) {
  return unit.transportCargoTokens ?? (unit.organicTruck === 'full' ? 4 : 0)
}

export function usableDump(state: Readonly<ScorpionInPlay>, side: Side, id: string) {
  const prefix = `${side}:hex:`
  const dump = Object.hasOwn(state.dumps, id) ? state.dumps[id] : undefined
  if (dump?.side !== side || dump.location !== 'on-map' || !id.startsWith(prefix) || dump.tokens <= 0) {
    throw new Error('Choose a friendly on-map supply dump with tokens')
  }
  return { dump, hex: id.slice(prefix.length) }
}

export function scorpionSpPayment(state: Readonly<ScorpionInPlay>, side: Side, map: ScorpionMap, railroad?: SupplyRailBoard,
  position: TracePosition = scorpionSupplyPosition(state, map, side, railroad)) {
  const network = scorpionSupplyNetwork(map, position)
  const dumps = { ...state.dumps }
  const cargo = new Map<string, number>()
  function transport(id: string) {
    const unit = Object.hasOwn(state.units, id) ? state.units[id] : undefined
    return unit?.side === side && !unit.combat && !unit.extender && (unit.organicTruck || unit.transportCargoTokens !== undefined) ? unit : undefined
  }
  function source(id: string) {
    const truck = transport(id)
    return truck ? { hex: truck.hex, tokens: cargo.get(id) ?? carriedScorpionTokens(truck), truck }
      : { ...usableDump({ ...state, dumps }, side, id), tokens: dumps[id]!.tokens, truck: undefined }
  }
  const canUse = (unit: DeployedCounter, id: string, method?: { headquartersId?: string }) => {
    const { hex, truck } = source(id)
    if (truck?.organicTruck && (!unit.formation || truck.formation !== unit.formation)) return false
    if (!method) return network.canUseDump(unit.hex, hex, unit.traceDrawMobility)
    return method.headquartersId ? network.canUseDumpVia(method.headquartersId, unit.hex, hex)
      : network.canDrawDump(unit.hex, hex, unit.traceDrawMobility)
  }
  const available = (units: readonly DeployedCounter[], includeOrganic = true): SupplyPayment[] => {
    const prefix = `${side}:hex:`
    const onMap = Object.entries(dumps).filter(([id, dump]) => id.startsWith(prefix) && dump.side === side &&
      dump.location === 'on-map' && dump.tokens > 0).map(([id]) => id)
    const transports = Object.keys(state.units).filter((id) => {
      const truck = transport(id)
      return truck && (includeOrganic || !truck.organicTruck) && (cargo.get(id) ?? carriedScorpionTokens(truck)) > 0
    })
    return [...onMap, ...transports].filter((id) => units.every((unit) => canUse(unit, id)))
      .map((dumpId) => ({ dumpId, tokens: source(dumpId).tokens }))
  }
  function spend<Row extends SupplyPayment>(payments: readonly Row[], permitted: (row: Row) => boolean) {
    for (const row of payments) {
      const from = source(row.dumpId)
      if (!Number.isSafeInteger(row.tokens) || row.tokens < 1 || row.tokens > from.tokens || !permitted(row)) {
        throw new Error('Supply must come from a reachable friendly dump or transport with sufficient tokens')
      }
      if (from.truck) cargo.set(row.dumpId, from.tokens - row.tokens)
      else dumps[row.dumpId] = spendScorpionDump(state, row.dumpId, dumps[row.dumpId]!, row.tokens)
    }
  }
  function settle(units: ScorpionInPlay['units'] = state.units) {
    if (!cargo.size) return { units, dumps }
    const counters = { ...units }
    for (const [id, tokens] of cargo) counters[id] = { ...counters[id]!, transportCargoTokens: tokens }
    return { units: counters, dumps }
  }
  return { source, canUse, available, spend, settle, network, position }
}

export function totalTokens(payments: readonly SupplyPayment[]) {
  return payments.reduce((sum, { tokens }) => sum + tokens, 0)
}
