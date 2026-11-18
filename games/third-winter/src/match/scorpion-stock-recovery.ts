import { internalRecoveryPerLevel } from '@ocs-eastern/series/internal-stocks'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import type { DeployedCounter } from '../import/scorpion-deployment.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { scorpionSpPayment, totalTokens } from './scorpion-sp-payment.ts'
import type { SupplyPayment } from './scorpion-sp-payment.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

export type RecoverInternalStocks = { type: 'recover-internal-stocks'; unitId: string; payments: readonly SupplyPayment[] }

const recoveryCost = (unit: DeployedCounter) => internalRecoveryPerLevel(unit.printedRe - unit.stepsLost)

export function recoverScorpionStocks(state: Readonly<ScorpionInPlay>, action: RecoverInternalStocks,
  map: ScorpionMap, railroad?: SupplyRailBoard): ScorpionInPlay {
  const side = state.cursor.phasing
  const unit = Object.hasOwn(state.units, action.unitId) ? state.units[action.unitId] : undefined
  if (!state.supply || state.supply.fed.length || state.supply.attrition || unit?.side !== side || !unit.internalStocks) {
    throw new Error('Recover a friendly unit’s internal stocks before feeding units or checking attrition')
  }
  const base = recoveryCost(unit)
  const paid = totalTokens(action.payments)
  if (paid !== base && (unit.internalStocks !== 'exhausted' || paid !== base * 2)) {
    throw new Error('Allocate the exact token cost of one or two eligible recovery levels')
  }
  const ledger = scorpionSpPayment(state, side, map, railroad)
  ledger.spend(action.payments, (_, hex) => ledger.canUse(unit, hex))
  const internalStocks = unit.internalStocks === 'exhausted' && paid === base ? 'low' : undefined
  return { ...state, dumps: ledger.dumps, units: { ...state.units, [action.unitId]: { ...unit, internalStocks } } }
}

export function settleScorpionStockRecovery(state: Readonly<ScorpionInPlay>, map: ScorpionMap,
  railroad?: SupplyRailBoard): ScorpionInPlay {
  const side = state.cursor.phasing
  const needy = Object.values(state.units).filter((unit) => unit.side === side && unit.internalStocks)
  if (!needy.length) return state
  const ledger = scorpionSpPayment(state, side, map, railroad)
  const remainder = new Map<string, SupplyPayment>()
  for (const unit of needy) {
    const available = ledger.available([unit])
    if (totalTokens(available) >= recoveryCost(unit)) throw new Error('Recover affordable internal stocks before using supply elsewhere')
    for (const payment of available) remainder.set(payment.dumpId, payment)
  }
  ledger.spend([...remainder.values()], () => true)
  return { ...state, dumps: ledger.dumps }
}
