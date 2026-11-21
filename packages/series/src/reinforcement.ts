/** OCS v4.3 2.3. Game-specific openings, exceptions and destinations belong to the game. */
export const reinforcementSegments = ['scheduled', 'supply', 'variable-replacements', 'rebuild-consolidate'] as const

export type ReinforcementSegment = (typeof reinforcementSegments)[number]

export function nextReinforcementSegment(segment: ReinforcementSegment): ReinforcementSegment | undefined {
  return reinforcementSegments[reinforcementSegments.indexOf(segment) + 1]
}
