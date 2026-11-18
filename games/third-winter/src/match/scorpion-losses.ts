import type { DeployedCounter } from '../import/scorpion-deployment.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'

export const remainingSteps = (unit: DeployedCounter) => Math.max(1, unit.printedRe - unit.stepsLost)

/** Send eliminated combat counters to their normal destination under TTW 2.4b. */
export function takeScorpionSteps(state: Readonly<ScorpionInPlay>, allocation: ReadonlyMap<string, number>,
  catalog: ScorpionSetupAssets['catalog']): ScorpionInPlay {
  const units = { ...state.units }
  const pieces = [...state.pieces]
  const availableAlerts = [...state.availableAlerts]
  for (const [id, steps] of allocation) {
    const unit = Object.hasOwn(units, id) ? units[id] : undefined
    if (!unit?.combat || !Number.isSafeInteger(steps) || steps < 1 || steps > remainingSteps(unit)) {
      throw new Error('Choose surviving combat steps for losses')
    }
    if (steps < remainingSteps(unit)) {
      units[id] = { ...unit, stepsLost: unit.stepsLost + steps }
      continue
    }
    delete units[id]
    const definition = catalog.definitions.get(unit.definition)
    if (definition?.source.abilities?.includes('alert_battalion')) {
      availableAlerts.push({ id, definition: unit.definition })
    } else {
      pieces.push({ id, kind: 'ground', side: unit.side, definition: unit.definition, location: { kind: 'dead-pile' } })
    }
  }
  return { ...state, units, pieces, availableAlerts }
}
