/** OCS v4.3 2.3. Game-specific openings, exceptions and destinations belong to the game. */
export const reinforcementSteps = ['scheduled', 'supply', 'variable-replacements', 'rebuild-consolidate'] as const

export type ReinforcementStep = (typeof reinforcementSteps)[number]

export function nextReinforcementStep(step: ReinforcementStep): ReinforcementStep | undefined {
  return reinforcementSteps[reinforcementSteps.indexOf(step) + 1]
}
