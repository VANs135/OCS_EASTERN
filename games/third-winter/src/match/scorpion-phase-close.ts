import type { Side } from '@ocs-eastern/series/state-types'
import { absorbScorpionBreakdown, scorpionBreakdownAbsorptions } from './scorpion-breakdown-absorption.ts'
import type { AbsorbScorpionBreakdown } from './scorpion-breakdown-absorption.ts'
import type { ScorpionBreakdownRules } from './scorpion-breakdowns.ts'
import type { ScorpionPlayAction } from './scorpion-reroll.ts'
import type { ScorpionInPlay, ScorpionSession } from './scorpion-session.ts'

type OrdinaryAction = Exclude<ScorpionPlayAction, AbsorbScorpionBreakdown>
type Completion = Extract<OrdinaryAction, { type: `complete-${string}` }>

export interface ScorpionPhaseClose {
  completion: Completion
  initiator: Side
  actor: Side
  options: readonly Omit<AbsorbScorpionBreakdown, 'type'>[]
}

/** OCS 20.0d. Suspend a valid phase completion while either owner has a required absorption. */
export function withScorpionPhaseClose(state: Readonly<ScorpionInPlay>, side: Side, action: ScorpionPlayAction,
  rules: ScorpionBreakdownRules | undefined,
  execute: (state: Readonly<ScorpionInPlay>, side: Side, action: OrdinaryAction) => ScorpionSession): ScorpionSession {
  const pending = state.phaseClose
  if (action.type === 'absorb-breakdown') {
    if (!pending || side !== pending.actor || !pending.options.some(({ parentId, breakdownId }) =>
      parentId === action.parentId && breakdownId === action.breakdownId)) {
      throw new Error('Choose an eligible breakdown absorption at the end of the phase with the owning side')
    }
    const settled = absorbScorpionBreakdown(state, action)
    const decision = phaseCloseDecision(settled, rules, pending.initiator, pending.completion)
    if (decision) return { ...settled, phaseClose: decision }
    return execute({ ...settled, phaseClose: undefined }, pending.initiator, pending.completion)
  }
  if (pending) throw new Error('Resolve the mandatory breakdown absorption before ending the phase')

  const next = execute(state, side, action)
  if (!rules || !isCompletion(action) || next.kind !== 'playing') return next
  // A Simulcast handoff can stay in the same phase. Resolve absorption at its actual end.
  if (next.cursor.phase === state.cursor.phase && next.cursor.turn === state.cursor.turn && !next.victory) return next
  const decision = phaseCloseDecision(state, rules, side, action)
  return decision ? { ...state, phaseClose: decision } : next
}

function isCompletion(action: OrdinaryAction): action is Completion {
  return action.type.startsWith('complete-')
}

function phaseCloseDecision(state: Readonly<ScorpionInPlay>, rules: ScorpionBreakdownRules | undefined,
  initiator: Side, completion: Completion): ScorpionPhaseClose | undefined {
  const pairs = scorpionBreakdownAbsorptions(state, rules)
  const actor = pairs[initiator].length ? initiator : initiator === 'axis' ? 'soviet' : 'axis'
  return pairs[actor].length ? { completion, initiator, actor, options: pairs[actor] } : undefined
}
