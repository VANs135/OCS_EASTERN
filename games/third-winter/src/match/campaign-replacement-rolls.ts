import { nextReinforcementSegment } from '@ocs-eastern/series/reinforcement'
import { campaignReinforcementStep } from './campaign-reinforcement-flow.ts'
import { drawCampaignReinforcementCheck } from './campaign-reinforcement-rolls.ts'
import type { CampaignReinforcementContext, CampaignReinforcementState, CampaignSpecialReplacement } from './campaign-reinforcement-state.ts'

const axisSpecialRows: readonly (readonly CampaignSpecialReplacement[])[] = [
  ['artillery', 'tiger'], ['flak', 'tiger'], ['hq'], ['hedgehog', 'alert'],
]
const sovietSpecialKinds = new Set<CampaignSpecialReplacement>(['artillery', 'assault', 'aa', 'hedgehog', 'hq', 'pontoon'])

/** TTW 1.7a–b. SR is its own check; the main replacement roll only decides whether to open it. */
export function rollCampaignReplacements(state: Readonly<CampaignReinforcementState>, context: CampaignReinforcementContext): CampaignReinforcementState {
  if (context.skipReplacementRolls || campaignReinforcementStep(state) !== 'roll-replacements') throw new Error('The replacement roll is not available')
  const { dice, rng, rolls } = drawCampaignReinforcementCheck(state, 'replacements')
  const row = context.replacementTable?.(state, dice.total)
  if (!row) throw new Error('The campaign Replacement Table is not configured for this result')
  if (![row.pax, row.air, row.ally].every((amount) => Number.isSafeInteger(amount) && amount >= 0) ||
    !Array.isArray(row.eq) || row.eq.some((rating) => !Number.isSafeInteger(rating) || rating < 0 || rating > 5) ||
    typeof row.special !== 'boolean' || (state.cursor.phasing === 'soviet' && row.ally !== 0)) {
    throw new Error('Invalid campaign replacement award')
  }
  const { pax, air, eq, ally, special } = row
  const replacementAward = { pax, air, eq: [...eq], ally, special }
  return { ...state, rng, rolls, replacementAward,
    segment: row.special ? state.segment : nextReinforcementSegment('variable-replacements')! }
}

export function rollCampaignSpecialReplacement(state: Readonly<CampaignReinforcementState>,
  context: CampaignReinforcementContext): CampaignReinforcementState {
  if (context.skipReplacementRolls || campaignReinforcementStep(state) !== 'roll-special-replacement' || !state.replacementAward?.special) {
    throw new Error('The special replacement roll is not available')
  }
  const { dice, rng, rolls } = drawCampaignReinforcementCheck(state, 'special-replacement')
  const results = context.specialReplacementTable?.(state, dice.total)
  if (!results) throw new Error('The campaign Special Replacement Table is not configured for this result')
  const valid = state.cursor.phasing === 'soviet' ? results.length === 1 && sovietSpecialKinds.has(results[0]!)
    : axisSpecialRows.some((row) => row.length === results.length && row.every((kind) => results.includes(kind)))
  if (!valid) throw new Error('Invalid campaign special replacement award')
  return { ...state, rng, rolls, specialReplacements: [...results], segment: nextReinforcementSegment('variable-replacements')! }
}
