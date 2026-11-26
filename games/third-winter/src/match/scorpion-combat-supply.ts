import { defensiveCombatSupplyCost } from '@ocs-eastern/series/combat'
import { spendInternalStocks } from '@ocs-eastern/series/internal-stocks'
import type { DeployedCounter } from '../import/scorpion-deployment.ts'
import { remainingSteps } from './scorpion-losses.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { totalTokens } from './scorpion-sp-payment.ts'
import type { scorpionSpPayment, SupplyPayment } from './scorpion-sp-payment.ts'

type PaymentLedger = ReturnType<typeof scorpionSpPayment>
export type AttackSupplyPayment = SupplyPayment & { unitId: string }

export function attackWithSupply(state: Readonly<ScorpionInPlay>, ledger: PaymentLedger, attackers: readonly string[],
  payments: readonly AttackSupplyPayment[], internal: readonly string[]) {
  requireParticipants(attackers, internal)
  const totals = new Map<string, number>()
  ledger.spend(payments, (payment) => {
    if (!attackers.includes(payment.unitId) || internal.includes(payment.unitId) ||
      !ledger.canUse(state.units[payment.unitId]!, payment.dumpId)) return false
    totals.set(payment.unitId, (totals.get(payment.unitId) ?? 0) + payment.tokens)
    return true
  })
  const units = { ...state.units }
  const waste = new Map<string, SupplyPayment>()
  for (const id of attackers) {
    const unit = units[id]!
    const cost = remainingSteps(unit)
    if (internal.includes(id)) units[id] = drawInternal(unit, cost, ledger, waste)
    else if (totals.get(id) !== cost) throw new Error('Each attacker requires one token per surviving step or its own internal stocks')
  }
  ledger.spend([...waste.values()], () => true)
  return units
}

export function defendWithSupply(state: Readonly<ScorpionInPlay>, ledger: PaymentLedger, defenders: readonly string[],
  payments: readonly SupplyPayment[], internal: readonly string[]) {
  requireParticipants(defenders, internal)
  const stack = defenders.map((id) => state.units[id]!)
  const cost = defensiveSupplyCost(stack)
  if (payments.length) {
    if (totalTokens(payments) !== cost || internal.length) throw new Error('Pay the full defending stack cost in on-map supply')
    payDefendingStack(ledger, stack, payments)
    return { units: state.units, supplied: true }
  }
  const units = { ...state.units }
  const waste = new Map<string, SupplyPayment>()
  for (const id of internal) units[id] = drawInternal(units[id]!, cost, ledger, waste)
  ledger.spend([...waste.values()], () => true)
  return { units, supplied: false }
}

/** OCS 12.3/12.4 and 13.2g. Pay the stack price once. Each defender must be able to receive supply. */
function payDefendingStack(ledger: PaymentLedger, stack: readonly DeployedCounter[], payments: readonly SupplyPayment[]) {
  const coverage = new Map<DeployedCounter, number>()
  ledger.spend(payments, ({ dumpId, tokens }) => {
    const reached = stack.filter((unit) => ledger.canUse(unit, dumpId))
    for (const unit of reached) coverage.set(unit, (coverage.get(unit) ?? 0) + tokens)
    return reached.length > 0
  })
  if (stack.some((unit) => (coverage.get(unit) ?? 0) < defensiveSupplyCost([unit]))) {
    throw new Error('Each defender must be able to receive its needed on-map combat supply')
  }
}

function defensiveSupplyCost(units: readonly DeployedCounter[]) {
  return defensiveCombatSupplyCost(units.reduce((total, unit) => total + unit.printedRe - unit.stepsLost, 0))
}

function requireParticipants(participants: readonly string[], internal: readonly string[]) {
  if (new Set(internal).size !== internal.length || internal.some((id) => !participants.includes(id))) {
    throw new Error('Internal stocks belong only to their individual participants')
  }
}

function drawInternal(unit: DeployedCounter, cost: number, ledger: PaymentLedger,
  waste: Map<string, SupplyPayment>): DeployedCounter {
  const available = ledger.available([unit], false)
  if (totalTokens(available) >= cost) throw new Error('This unit can obtain its required on-map combat supply')
  const internalStocks = spendInternalStocks(unit.internalStocks)
  if (unit.printedRe > 1) for (const payment of available) waste.set(payment.dumpId, payment)
  return { ...unit, internalStocks }
}
