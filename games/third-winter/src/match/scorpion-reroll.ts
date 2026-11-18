import type { Die } from '@ocs-eastern/series/dice'
import { rollDice } from '@ocs-eastern/series/rng'
import type { RngDraw } from '@ocs-eastern/series/rng'
import type { DiceRoll, RngState, Side } from '@ocs-eastern/series/state-types'
import type { ScorpionAction, ScorpionInPlay, ScorpionSession } from './scorpion-session.ts'

export interface ScorpionRollSite {
  kind: 'supply' | 'flak' | 'flak-loss' | 'air-combat' | 'air-combat-loss' | 'barrage' | 'barrage-half-loss' |
    'airfield-barrage' | 'airfield-loss' | 'trainbusting' | 'surprise' | 'surprise-shift' | 'combat'
  hex?: string
  unitId?: string
  side?: Side
}

export type ScorpionRoll = (rng: RngState, site: ScorpionRollSite, count: 1 | 2) => RngDraw<DiceRoll>
export type ResolveScorpionReroll = { type: 'resolve-reroll'; decision: 'keep' | 'reroll' }
export type ScorpionPlayAction = Exclude<ScorpionAction, ResolveScorpionReroll>

interface RecordedRoll {
  site: ScorpionRollSite
  before: number
  draw: RngDraw<DiceRoll>
}

export interface ScorpionRerollWindow {
  actor: Side
  action: ScorpionPlayAction
  accepted: readonly RecordedRoll[]
  current: RecordedRoll
}

export interface ScorpionRerollUse {
  side: Side
  site: ScorpionRollSite
  previous: readonly number[]
  replacement: readonly number[]
}

class OfferRoll {
  readonly current: RecordedRoll

  constructor(current: RecordedRoll) {
    this.current = current
  }
}

/** TTW Common Event 41–42. Resume the original command with only approved rolls supplied to it. */
export function applyScorpionReroll(state: ScorpionInPlay, side: Side, action: ScorpionAction,
  execute: (state: ScorpionInPlay, side: Side, action: ScorpionPlayAction, roll?: ScorpionRoll) => ScorpionSession): ScorpionSession {
  const pending = state.reroll
  if (action.type !== 'resolve-reroll') {
    if (pending) throw new Error('The reroll holder must answer the pending roll first')
    if (!state.rerollHolder) return execute(state, side, action)
    return run(state, side, action, [], execute)
  }
  if (!pending || side !== state.rerollHolder) throw new Error('Only the reroll holder may answer a pending roll')
  const { current } = pending
  if (action.decision === 'reroll') {
    const draw = rollDice(current.draw.rng, current.draw.value.count)
    return { ...state, rerollHolder: side === 'axis' ? 'soviet' : 'axis', reroll: { ...pending, current: { ...current, draw } },
      rerollHistory: [...(state.rerollHistory ?? []), { side, site: current.site,
        previous: current.draw.value.faces, replacement: draw.value.faces }] }
  }
  if (action.decision !== 'keep') throw new Error('Choose whether to keep or reroll these dice')
  const { reroll: _, ...base } = state
  return run(base, pending.actor, pending.action, [...pending.accepted, current], execute)
}

function run(state: ScorpionInPlay, actor: Side, action: ScorpionPlayAction, accepted: readonly RecordedRoll[],
  execute: (state: ScorpionInPlay, side: Side, action: ScorpionPlayAction, roll: ScorpionRoll) => ScorpionSession): ScorpionSession {
  let consumed = 0
  const roll: ScorpionRoll = (rng, site, count) => {
    const previous = accepted[consumed++]
    if (!previous) throw new OfferRoll({ site, before: rng.drawCount, draw: rollDice(rng, count) })
    if (previous.before !== rng.drawCount || previous.draw.rng.seed !== rng.seed || previous.draw.value.count !== count ||
      previous.site.kind !== site.kind ||
      previous.site.hex !== site.hex || previous.site.unitId !== site.unitId || previous.site.side !== site.side) {
      throw new Error('The saved reroll does not match the command’s dice sequence')
    }
    return previous.draw
  }
  try {
    const next = execute(state, actor, action, roll)
    if (consumed !== accepted.length) throw new Error('The command did not reach all saved rolls')
    return next
  } catch (error) {
    if (!(error instanceof OfferRoll)) throw error
    return { ...state, reroll: { actor, action, accepted, current: error.current } }
  }
}

/** Adapt grouped dice to the existing shared tables while threading the command’s RNG. */
export function scorpionRolls(rng: RngState, offer?: ScorpionRoll) {
  const draw = (site: ScorpionRollSite, count: 1 | 2) => {
    const result = offer ? offer(rng, site, count) : rollDice(rng, count)
    rng = result.rng
    return result.value.faces
  }
  return {
    one: (site: ScorpionRollSite): Die => draw(site, 1)[0] as Die,
    two: (site: ScorpionRollSite): readonly [Die, Die] => {
      const [first, second] = draw(site, 2)
      return [first as Die, second as Die]
    },
    get rng() { return rng },
  }
}
