import { breakoutRejection, hasBreakoutPath, resolveBreakout } from '@ocs-eastern/series/breakout'
import type { BreakoutPathBoard, BreakoutUnitFacts } from '@ocs-eastern/series/breakout'
import type { Mobility } from '@ocs-eastern/series/ground-map'
import { rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignBreakoutAction = { type: 'attempt-campaign-breakout'; counterId: string } | { type: 'complete-campaign-breakout' }
export type CampaignBreakoutRoll = ReturnType<typeof resolveBreakout> & {
  counterId: string; side: Side; turn: number; before: number; after: number
}

export interface CampaignBreakoutPosition extends BreakoutPathBoard {
  /** The supply module supplies live trace and whether this is the first qualifying break in trace. */
  unitFacts(counterId: string): (BreakoutUnitFacts & { mobility: Mobility }) | undefined
  resolveHex?(printed: string): string | undefined
  distance(from: string, to: string): number
}

export type CampaignBreakoutBoard = (state: Readonly<CampaignTurnState>, side: Side) => CampaignBreakoutPosition | undefined

function inspectBreakout(state: Readonly<CampaignTurnState>, actor: Side, board: CampaignBreakoutPosition) {
  const own = new Map(Object.entries(state.counters).flatMap(([id, unit]) => {
    if (unit.side !== actor || unit.location.kind !== 'map' || unit.kind === 'aircraft') return []
    const facts = board.unitFacts(id)
    const hex = board.resolveHex ? board.resolveHex(unit.location.hex) : unit.location.hex
    if (!facts || !hex) return []
    const singleTransportPoint = unit.kind === 'transport' && facts.singleTransportPoint
    return [[id, { hex, facts: { ...facts, singleTransportPoint } }] as const]
  }))
  const traced = [...own.values()].filter(({ facts }) => facts.hasTrace)
  const tracedHexes = new Set(traced.map(({ hex }) => hex))
  const tracedCombatHexes = new Set(traced.filter(({ facts }) => facts.combat).map(({ hex }) => hex))
  const verdict = (candidate: (typeof traced)[number]) => breakoutRejection(candidate.facts, () => {
    let distance = Infinity
    for (const hex of tracedCombatHexes) distance = Math.min(distance, board.distance(candidate.hex, hex))
    return { pathToTracedFriend: () => hasBreakoutPath(candidate.hex, candidate.facts.mobility, tracedHexes, board),
      nearestTracedCombatDistance: Number.isFinite(distance) ? distance : null }
  })
  return { own, verdict }
}

function breakoutOpen(state: Readonly<CampaignTurnState>, actor: Side) {
  return state.cursor.phase === 'movement' && state.cursor.phasing === actor && state.movementSegment === 'breakout'
}

export function campaignBreakoutOptions(state: Readonly<CampaignTurnState>, actor: Side, board?: CampaignBreakoutBoard) {
  if (!breakoutOpen(state, actor)) return null
  const position = board?.(state, actor)
  if (!position) return { configured: false, eligibleIds: [] }
  const { own, verdict } = inspectBreakout(state, actor, position)
  const eligibleIds = [...own].flatMap(([id, candidate]) => verdict(candidate) === null ? [id] : [])
  return { configured: true, eligibleIds }
}

export function applyCampaignBreakout(state: Readonly<CampaignTurnState>, actor: Side,
  action: CampaignBreakoutAction, board?: CampaignBreakoutBoard): CampaignTurnState {
  if (!breakoutOpen(state, actor)) throw new Error('Campaign breakout window is not open for this side')
  if (action.type === 'complete-campaign-breakout') return { ...state, movementSegment: 'movement', groundMovement: { moved: [], zocLocks: [] } }
  const position = board?.(state, actor)
  if (!position) throw new Error('Campaign breakout board facts are not configured')
  const { own, verdict } = inspectBreakout(state, actor, position)
  const candidate = own.get(action.counterId)
  if (!candidate) throw new Error('Choose a friendly on-map counter with known breakout facts')
  const refusal = verdict(candidate)
  if (refusal) throw new Error(`Campaign breakout: ${refusal}`)

  let rng = state.rng
  const outcome = resolveBreakout(state.turn, candidate.facts.firstTurnWithoutTrace, () => {
    const draw = rollDie(rng)
    rng = draw.rng
    return draw.value
  })
  const unit = state.counters[action.counterId]!
  const location = outcome.result === 'return' ? { kind: 'breakout-return' as const, turn: outcome.returnTurn }
    : { kind: 'dead-pile' as const }
  const roll = { ...outcome, counterId: action.counterId, side: actor, turn: state.turn,
    before: state.rng.drawCount, after: rng.drawCount }
  return { ...state, counters: { ...state.counters, [action.counterId]: { ...unit, location } }, rng,
    breakoutRolls: [...state.breakoutRolls, roll] }
}
