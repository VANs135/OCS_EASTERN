import { rollDice } from '@ocs-eastern/series/rng'
import type { CampaignReinforcementCheck, CampaignReinforcementRoll, CampaignReinforcementState } from './campaign-reinforcement-state.ts'

const checks = {
  supply: { step: 'roll-supply', count: 2 },
  replacements: { step: 'roll-replacements', count: 2 },
  'special-replacement': { step: 'roll-special-replacement', count: 1 },
} as const satisfies Record<CampaignReinforcementCheck, { step: CampaignReinforcementRoll['step']; count: number }>

export function drawCampaignReinforcementCheck(state: Readonly<CampaignReinforcementState>, check: CampaignReinforcementCheck) {
  if (state.rolls.some((result) => result.check === check)) throw new Error(`Campaign check ${check} has already been rolled`)
  const { step, count } = checks[check]
  const { value: dice, rng } = rollDice(state.rng, count)
  const { phase, turn, phasing: side } = state.cursor
  const roll = { check, side, turn, phase, segment: state.segment, step, dice, before: state.rng.drawCount, after: rng.drawCount }
  return { dice, rng, rolls: [...state.rolls, roll] }
}
