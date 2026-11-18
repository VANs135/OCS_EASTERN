import { attritionLoss } from '@ocs-eastern/series/attrition'
import type { Die } from '@ocs-eastern/series/dice'
import { rollDie } from '@ocs-eastern/series/rng'
import { scorpionHexId } from '../import/hex-id.ts'
import { scorpionSuddenDeath } from '../ttw/scorpion/victory.ts'
import { remainingSteps, takeScorpionSteps } from './scorpion-losses.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { hasTrace, readyForSupplyAllocation } from './scorpion-supply-phase.ts'
import type { ScorpionSupplyWindow } from './scorpion-supply-phase.ts'

export interface ScorpionAttrition {
  hex: string
  units: readonly string[]
  dice: readonly [Die, Die]
  losses: number
  assigned: boolean
}

export type AssignAttrition = { type: 'assign-attrition'; hex: string;
  allocation: readonly { unitId: string; steps: number }[] }

/** OCS 12.8a–c. Mark only the phasing side, then roll once per hex containing unsupplied steps. */
export function checkScorpionAttrition(state: Readonly<ScorpionInPlay>, window: ScorpionSupplyWindow): ScorpionInPlay {
  readyForSupplyAllocation(window)
  const stacks = new Map<string, string[]>()
  const units = { ...state.units }
  for (const [id, unit] of Object.entries(state.units)) {
    if (!unit.combat || unit.side !== state.cursor.phasing) continue
    const outOfSupply = !hasTrace(window, id) && !window.fed.includes(id)
    units[id] = { ...unit, outOfSupply }
    if (!outOfSupply) continue
    const stack = stacks.get(unit.hex) ?? []
    stack.push(id)
    stacks.set(unit.hex, stack)
  }
  let rng = state.rng
  const attrition = [...stacks.keys()].sort().map((hex): ScorpionAttrition => {
    const ids = stacks.get(hex)!
    const first = rollDie(rng)
    const second = rollDie(first.rng)
    rng = second.rng
    const dice = [first.value, second.value] as const
    const size = ids.reduce((total, id) => total + remainingSteps(units[id]!), 0)
    const rating = Math.max(...ids.map((id) => units[id]!.actionRating))
    const losses = attritionLoss(size, rating, dice)
    return { hex, units: ids, dice, losses, assigned: losses === 0 }
  })
  return { ...state, units, rng, supply: { ...window, attrition } }
}

export function assignScorpionAttrition(state: Readonly<ScorpionInPlay>, window: ScorpionSupplyWindow,
  action: AssignAttrition, { catalog }: ScorpionSetupAssets): ScorpionInPlay {
  const hex = scorpionHexId(action.hex)
  const stack = window.attrition?.find((item) => item.hex === hex && !item.assigned)
  if (!stack || new Set(action.allocation.map(({ unitId }) => unitId)).size !== action.allocation.length ||
    action.allocation.reduce((total, item) => total + item.steps, 0) !== stack.losses) {
    throw new Error('Assign the full attrition result once to the selected stack')
  }
  for (const { unitId, steps } of action.allocation) {
    const unit = state.units[unitId]
    if (!stack.units.includes(unitId) || !unit?.outOfSupply || !Number.isSafeInteger(steps) || steps < 1 ||
      steps > remainingSteps(unit)) throw new Error('Only surviving out-of-supply steps in this hex can take attrition')
  }
  const settled = takeScorpionSteps(state, new Map(action.allocation.map(({ unitId, steps }) => [unitId, steps])), catalog)
  // Scorpion p.53. Every Axis step lost while OOS counts, including attrition.
  const sovietVp = state.arrival.sovietVp + (state.cursor.phasing === 'axis' ? stack.losses : 0)
  return { ...settled, arrival: { ...state.arrival, sovietVp },
    victory: scorpionSuddenDeath(state.cursor.turn, sovietVp), supply: { ...window,
      attrition: window.attrition!.map((item) => item === stack ? { ...item, assigned: true } : item) } }
}
