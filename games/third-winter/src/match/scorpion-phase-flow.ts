import { rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import { answerRetention, chooseFirstPlayer, rollInitiative } from '../ttw/scorpion/initiative-step.ts'
import { advanceScorpionPhase, startScorpionPlayerTurns } from './scorpion-player-turn.ts'
import { completeScorpionCleanup } from './scorpion-round.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { usableDump } from './scorpion-sp-payment.ts'

export type ScorpionPhaseAction = { type: 'complete-reaction' | 'complete-combat' | 'complete-exploitation' | 'complete-cleanup' }
  | { type: 'retain-initiative'; dumpId: string }
  | { type: 'roll-initiative' }
  | { type: 'choose-first'; first: Side }

export function applyScorpionPhaseFlow(state: Readonly<ScorpionInPlay>, actor: Side,
  action: ScorpionPhaseAction, map: ScorpionMap): ScorpionInPlay {
  if (state.victory || state.turn.step.kind === 'ended') throw new Error('The Scorpion match has ended')
  let rng = state.rng
  const roll = () => {
    const draw = rollDie(rng)
    rng = draw.rng
    return draw.value
  }
  if (action.type === 'retain-initiative') {
    const { dump } = usableDump(state, actor, action.dumpId)
    const paid = answerRetention(state.turn, actor, 'pay', dump)
    return { ...state, turn: paid.turn,
      dumps: { ...state.dumps, [action.dumpId]: { ...dump, tokens: paid.dump!.tokens } } }
  }
  if (action.type === 'roll-initiative') {
    const pending = state.turn.step.kind === 'retention' ? answerRetention(state.turn, actor, 'roll').turn : state.turn
    const turn = rollInitiative(pending, roll)
    return { ...state, turn, rng }
  }
  if (action.type === 'choose-first') {
    const turn = chooseFirstPlayer(state.turn, actor, action.first)
    return { ...state, turn, cursor: startScorpionPlayerTurns(turn) }
  }

  if (state.turn.step.kind !== 'player-turn' || action.type !== `complete-${state.cursor.phase}` || state.combat) {
    throw new Error('Complete the active phase and any pending combat before advancing')
  }
  const units = Object.fromEntries(Object.entries(state.units).map(([id, unit]) => {
    if (unit.side !== actor) return [id, unit]
    const cleaned = action.type === 'complete-cleanup'
      ? { ...unit, disorganized: false, exploit: false } : unit
    return [id, { ...cleaned, fueled: false, released: false }]
  }))
  if (action.type !== 'complete-cleanup') {
    const cursor = advanceScorpionPhase(state.cursor, actor)
    if (!cursor) throw new Error('Invalid player phase transition')
    return { ...state, cursor, units, moved: [], combatTargets: [], combatAttackers: [], overrunMarch: null, groundCaptureMove: null }
  }

  // Scenario Book p.53. The calibrated Scorpion major-river edges are the Dnepr reach.
  // The eastern endpoint is a map-edge hex, where the crop has no outward-facing hexside.
  const onDnepr = (hex: string) => hex === 's22.08' ||
    map.neighbors(hex).some((near) => map.edge(hex, near)?.river === 'major')
  const riverSteps = Object.values(units).filter((unit) => unit.side === 'axis' && unit.combat && onDnepr(unit.hex))
    .reduce((sum, unit) => sum + Math.max(1, unit.printedRe - unit.stepsLost), 0)
  const next = completeScorpionCleanup(state.turn, state, actor, riverSteps, state.rerollHolder, roll)
  return { ...state, turn: next.turn, cursor: next.cursor ?? state.cursor, rng, units, moved: [], overrunMarch: null, groundCaptureMove: null,
    combatTargets: [], combatAttackers: [], arrival: { ...state.arrival, sovietVp: next.turn.vp },
    victory: next.turn.step.kind === 'ended' ? next.turn.step.result : null }
}
