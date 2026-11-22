import { attritionLoss } from '@ocs-eastern/series/attrition'
import type { Die } from '@ocs-eastern/series/dice'
import { rollDie } from '@ocs-eastern/series/rng'
import type { CampaignSupplyPhaseBoard, CampaignSupplyPosition } from './campaign-supply-stock.ts'
import { hasCampaignSupplyTrace } from './campaign-supply-trace-step.ts'
import type { CampaignFeeding } from './campaign-supply-trace-step.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignAttrition {
  hex: string
  units: readonly string[]
  dice: readonly [Die, Die]
  before: number
  after: number
  losses: number
  assigned: boolean
}

export type AssignCampaignAttrition = { type: 'assign-campaign-attrition'; hex: string;
  allocation: readonly { unitId: string; steps: number }[] }

export function checkCampaignAttrition(state: Readonly<CampaignTurnState>, feeding: CampaignFeeding, position: CampaignSupplyPosition) {
  const counters = { ...state.counters }
  const stacks = new Map<string, string[]>()
  for (const [id, { counter, hex }] of position.units) {
    const outOfSupply = !hasCampaignSupplyTrace(feeding, id) && !feeding.fed.includes(id)
    counters[id] = { ...counter, outOfSupply }
    if (outOfSupply) {
      const units = stacks.get(hex) ?? []
      units.push(id)
      stacks.set(hex, units)
    }
  }
  let rng = state.rng
  const results = [...stacks.keys()].sort().map((hex): CampaignAttrition => {
    const units = stacks.get(hex)!
    const before = rng.drawCount
    const first = rollDie(rng)
    const second = rollDie(first.rng)
    rng = second.rng
    const dice = [first.value, second.value] as const
    const facts = units.map((id) => position.units.get(id)!)
    const rating = Math.max(...facts.map(({ counter, rules }) => counter.mode === 'strat' && !counter.disorganized ? 0 : rules.rating))
    const losses = attritionLoss(facts.reduce((sum, { rules }) => sum + rules.steps, 0), rating, dice)
    return { hex, units, dice, before, after: rng.drawCount, losses, assigned: losses === 0 }
  })
  return { ...state, counters, rng, supplyPhase: { feeding, attrition: results } }
}

export function assignCampaignAttrition(state: Readonly<CampaignTurnState>, results: readonly CampaignAttrition[],
  action: AssignCampaignAttrition, position: CampaignSupplyPosition, board: CampaignSupplyPhaseBoard) {
  const hex = position.resolveHex(action.hex)
  const stack = results.find((item) => item.hex === hex && !item.assigned)
  if (!stack || results.find((item) => !item.assigned) !== stack ||
    new Set(action.allocation.map(({ unitId }) => unitId)).size !== action.allocation.length ||
    action.allocation.reduce((sum, item) => sum + item.steps, 0) !== stack.losses) throw new Error('Assign the full current attrition result once')
  const counters = { ...state.counters }
  for (const { unitId, steps } of action.allocation) {
    const unit = position.units.get(unitId)
    if (!unit?.counter.outOfSupply || !stack.units.includes(unitId) || !Number.isSafeInteger(steps) || steps < 1 || steps > unit.rules.steps) {
      throw new Error('Only this stack’s surviving out-of-supply steps can take attrition')
    }
    const destroyed = steps === unit.rules.steps
    const currentRe = destroyed ? 0 : board.reAfterLoss(state, unitId, steps)
    if (currentRe === undefined || !Number.isFinite(currentRe) || !destroyed && (currentRe <= 0 || currentRe > unit.re)) {
      throw new Error('Remaining RE after attrition is unavailable')
    }
    // TTW 2.4d does not create remnants for attrition losses.
    counters[unitId] = { ...unit.counter, currentRe, stepsLost: (unit.counter.stepsLost ?? 0) + steps,
      ...(destroyed ? { location: { kind: 'dead-pile' }, outOfSupply: false } : {}) }
  }
  return { ...state, counters, supplyPhase: { feeding: state.supplyPhase!.feeding,
    attrition: results.map((item) => item === stack ? { ...item, assigned: true } : item) } }
}
