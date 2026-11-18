import type { Side } from '@ocs-eastern/series/state-types'
import type { UnitArrival } from '../import/scorpion-arrivals.ts'
import type { ScorpionArrivalState } from '../ttw/scorpion/arrival.ts'
import { scorpionFixedSupply } from '../ttw/scorpion/fixed-supply.ts'
import { rollScorpionVariableReinforcements } from '../ttw/scorpion/reinforcement-supply.ts'
import type { ScorpionSupplyRoll } from '../ttw/scorpion/reinforcement-supply.ts'
import type { Victory } from '../ttw/scorpion/victory.ts'
import { advanceScorpionPhase } from './scorpion-player-turn.ts'
import type { PlayerTurn } from './scorpion-player-turn.ts'

export interface SupplyDump {
  side: Side
  tokens: number
  location: 'on-map' | 'off-map'
  unloaded?: Pick<PlayerTurn, 'turn' | 'phasing' | 'phase'> & { tokens: number }
}

export interface ArrivalPlacement {
  arrival: UnitArrival
  hex: string
}

export interface ReinforcementWindow {
  dice: readonly [number, number] | null
  variableTokens: number
  fixedTokens: number
  fixedDestinations: readonly string[]
  pendingAlert: AlertCounter | null
  stage: 'scheduled' | 'variable'
}

export interface ReinforcementState {
  cursor: PlayerTurn
  window: ReinforcementWindow | null
  arrival: ScorpionArrivalState
  arrivalsOnMap: readonly ArrivalPlacement[]
  dumps: Readonly<Record<string, SupplyDump>>
  pax: Readonly<Record<Side, number>>
  availableAlerts: readonly AlertCounter[]
  placedAlerts: readonly { counter: AlertCounter; hex: string }[]
  victory: Victory | null
}

export interface AlertCounter {
  id: string
  definition: string
}

export interface ReinforcementBoard {
  catalog: readonly UnitArrival[]
  supplySources: Readonly<Record<Side, ReadonlySet<string>>>
  controlOf: (hex: string) => Side | null
  /** Return OCS 13.6 eligible hexes for the scheduled arrival, including legal substitutes. */
  arrivalDestinations: (arrival: UnitArrival) => readonly string[]
  /** TTW 1.7a and 2.4b eligible HQ locations for the selected Alert. */
  alertDestinations: (counter: AlertCounter) => readonly string[]
}

/** Call after the aircraft refit phase has completed. State and the recorded dice must persist together. */
export function enterScorpionReinforcement(
  state: Readonly<ReinforcementState>, actor: Side,
): ReinforcementState {
  if (state.cursor.phase !== 'aircraft-refit' || state.window || state.victory) {
    throw new Error('Cannot open a new reinforcement phase')
  }
  const cursor = advanceScorpionPhase(state.cursor, actor)
  if (!cursor || cursor.phase !== 'reinforcement') throw new Error('Invalid reinforcement transition')
  const fixed = scorpionFixedSupply.find(({ side, turn }) => side === actor && turn === cursor.turn)
  return {
    ...state,
    cursor,
    window: {
      dice: null,
      variableTokens: 0,
      fixedTokens: (fixed?.sp ?? 0) * 4,
      fixedDestinations: fixed?.destinations ?? [],
      pendingAlert: null,
      stage: 'scheduled',
    },
  }
}

export type SupplyTarget = { kind: 'hex'; id: string } | { kind: 'air-box' }

/** OCS 2.3. Finish scheduled arrivals before rolling the variable award. */
export function awardScorpionVariableSupply(
  state: Readonly<ReinforcementState>,
  window: Readonly<ReinforcementWindow>,
  actor: Side,
  roll: ScorpionSupplyRoll,
  pickIndex: (size: number) => number,
): ReinforcementState {
  if (window.stage !== 'scheduled' || window.fixedTokens) {
    throw new Error('Finish the scheduled supply delivery before rolling')
  }
  const award = rollScorpionVariableReinforcements(state.cursor.turn, actor, roll)
  let pendingAlert: AlertCounter | null = null
  if (award.alert && state.availableAlerts.length) {
    const picked = state.availableAlerts[pickIndex(state.availableAlerts.length)]
    if (!picked) throw new Error('Invalid Alert pool draw')
    pendingAlert = picked
  }
  return {
    ...state,
    pax: { ...state.pax, [actor]: state.pax[actor] + award.pax },
    window: {
      ...window,
      stage: 'variable',
      dice: award.dice,
      variableTokens: award.sp * 4,
      pendingAlert,
    },
  }
}
