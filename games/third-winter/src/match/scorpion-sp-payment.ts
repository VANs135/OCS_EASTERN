import type { Side } from '@ocs-eastern/series/state-types'
import type { DeployedCounter } from '../import/scorpion-deployment.ts'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import { scorpionSupplyNetwork } from '../ttw/scorpion/supply-trace.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { scorpionSupplyPosition } from './scorpion-supply-position.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

export type SupplyPayment = { dumpId: string; tokens: number }

export function usableDump(state: Readonly<ScorpionInPlay>, side: Side, id: string) {
  const prefix = `${side}:hex:`
  const dump = Object.hasOwn(state.dumps, id) ? state.dumps[id] : undefined
  if (dump?.side !== side || dump.location !== 'on-map' || !id.startsWith(prefix) || dump.tokens <= 0) {
    throw new Error('Choose a friendly on-map supply dump with tokens')
  }
  return { dump, hex: id.slice(prefix.length) }
}

export function scorpionSpPayment(state: Readonly<ScorpionInPlay>, side: Side, map: ScorpionMap, railroad?: SupplyRailBoard) {
  const position = scorpionSupplyPosition(state, map, side, railroad)
  const network = scorpionSupplyNetwork(map, position)
  const dumps = { ...state.dumps }
  const canUse = (unit: DeployedCounter, hex: string) => network.canUseDump(unit.hex, hex, unit.traceDrawMobility)
  const available = (units: readonly DeployedCounter[]): SupplyPayment[] => {
    const prefix = `${side}:hex:`
    return Object.entries(dumps).filter(([id, dump]) => id.startsWith(prefix) && dump.side === side &&
      dump.location === 'on-map' && dump.tokens > 0 && units.every((unit) => canUse(unit, id.slice(prefix.length))))
      .map(([dumpId, dump]) => ({ dumpId, tokens: dump.tokens }))
  }
  function spend<Row extends SupplyPayment>(payments: readonly Row[], permitted: (row: Row, hex: string) => boolean) {
    for (const row of payments) {
      const { dump, hex } = usableDump({ ...state, dumps }, side, row.dumpId)
      if (!Number.isSafeInteger(row.tokens) || row.tokens < 1 || row.tokens > dump.tokens || !permitted(row, hex)) {
        throw new Error('Supply must come from a reachable friendly dump with sufficient tokens')
      }
      dumps[row.dumpId] = { ...dump, tokens: dump.tokens - row.tokens }
    }
  }
  return { dumps, canUse, available, spend, network, position }
}

export function totalTokens(payments: readonly SupplyPayment[]) {
  return payments.reduce((sum, { tokens }) => sum + tokens, 0)
}
