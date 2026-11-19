import type { Side } from '@ocs-eastern/series/state-types'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import { enterScorpionReinforcement } from './scorpion-reinforcement-state.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { openScorpionSupply } from './scorpion-supply-phase.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

/** OCS 2.4 and TTW Weather Table. Share each logistical phase before moving to the next. */
export function advanceScorpionThaw(state: ScorpionInPlay, actor: Side, map: ScorpionMap,
  rail?: SupplyRailBoard): ScorpionInPlay {
  const { cursor } = state
  const first = cursor.first
  const next = actor === first ? (first === 'axis' ? 'soviet' : 'axis') : first
  if (cursor.phase === 'aircraft-refit' || cursor.phase === 'reinforcement') {
    const queued = { ...state, window: null, cursor: { ...cursor, phasing: next } }
    if (cursor.phase === 'aircraft-refit' && actor === first) return { ...queued, refittedAirbases: [] }
    if (cursor.phase === 'reinforcement' && actor !== first) return { ...queued, cursor: { ...queued.cursor, phase: 'movement' } }
    return { ...queued, ...enterScorpionReinforcement({ ...queued, cursor: { ...queued.cursor, phase: 'aircraft-refit' } }, next),
      refittedAirbases: [] }
  }
  if (cursor.phase === 'movement') {
    const queued = { ...state, cursor: { ...cursor, phasing: next } }
    if (actor === first) return queued
    // Trace for both sides from the same position, before either side changes its OOS markers and ZOC.
    const firstSupply = openScorpionSupply(queued, next, map, rail)
    const secondSupply = openScorpionSupply(state, actor, map, rail).supply
    return { ...firstSupply, thawSupply: secondSupply }
  }
  if (cursor.phase === 'supply') {
    if (actor !== first) return { ...state, supply: null, cursor: { ...cursor, phasing: next, phase: 'cleanup' } }
    const { thawSupply, ...settled } = state
    if (!thawSupply) throw new Error('Missing the second Simulcast trace snapshot')
    return { ...settled, supply: thawSupply, cursor: { ...cursor, phasing: next } }
  }
  throw new Error('Unexpected phase for the Scorpion Thaw procedure')
}
