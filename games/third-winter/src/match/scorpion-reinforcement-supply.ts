import type { Side } from '@ocs-eastern/series/state-types'
import { placeScorpionSupply } from '../ttw/scorpion/supply-placement.ts'
import type { ReinforcementBoard, ReinforcementState, ReinforcementWindow, SupplyTarget } from './scorpion-reinforcement-state.ts'

/** Supply awards become ordinary dumps in the same transaction as the debit. */
export function deliverScorpionSupply(
  state: Readonly<ReinforcementState>,
  window: Readonly<ReinforcementWindow>,
  side: Side,
  target: SupplyTarget,
  tokens: number,
  board: ReinforcementBoard,
): ReinforcementState {
  const fixed = window.stage === 'scheduled'
  if (fixed && (target.kind !== 'hex' || !window.fixedDestinations.includes(target.id))) {
    throw new Error('Choose a printed fixed delivery hex')
  }

  const pool = { side, tokensLeft: fixed ? window.fixedTokens : window.variableTokens }
  const destination = target.kind === 'air-box'
    ? { kind: 'air-box' as const, side }
    : { ...target, controlledBy: board.controlOf(target.id) }
  const candidates = fixed ? new Set(window.fixedDestinations) : board.supplySources[side]
  const balance = placeScorpionSupply(pool, destination, tokens, candidates).tokensLeft
  const id = target.kind === 'hex' ? `${side}:hex:${target.id}` : `${side}:air-box`
  return {
    ...state,
    window: fixed ? { ...window, fixedTokens: balance } : { ...window, variableTokens: balance },
    dumps: {
      ...state.dumps,
      [id]: {
        side,
        location: target.kind === 'hex' ? 'on-map' : 'off-map',
        tokens: (state.dumps[id]?.tokens ?? 0) + tokens,
      },
    },
  }
}
