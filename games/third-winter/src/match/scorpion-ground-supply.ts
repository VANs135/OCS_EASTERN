import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import type { Side } from '@ocs-eastern/series/state-types'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import { scorpionSupplyNetwork } from '../ttw/scorpion/supply-trace.ts'
import type { TraceOption, TracePosition } from '../ttw/scorpion/supply-trace.ts'
import { advanceScorpionPhase } from './scorpion-player-turn.ts'
import type { PlayerTurn } from './scorpion-player-turn.ts'
import type { GroundMoveState } from './scorpion-movement.ts'

export interface GroundSupplyState extends GroundMoveState {
  trace: Readonly<Record<string, readonly TraceOption[]>> | null
}

/** Movement completion enters Supply and records eligibility for each friendly combat unit. */
export function submitScorpionTraceCheck<State extends GroundSupplyState>(
  record: Readonly<MatchRecord<State, { type: 'complete-movement' }, Side>>,
  actor: Side,
  command: Readonly<Command<{ type: 'complete-movement' }>>,
  map: ScorpionMap,
  position: (state: Readonly<State>, side: Side) => TracePosition,
) {
  return acceptCommand(record, actor, command, (state, side) => {
    if (state.cursor.phase !== 'movement' || side !== state.cursor.phasing) {
      throw new Error('This side cannot complete movement')
    }
    const cursor: PlayerTurn | null = advanceScorpionPhase(state.cursor, side)
    if (!cursor || cursor.phase !== 'supply') throw new Error('Invalid supply transition')
    const facts = position(state, side)
    if (facts.side !== side) throw new Error('Trace board must belong to the phasing side')
    const network = scorpionSupplyNetwork(map, facts)
    const trace = Object.fromEntries(Object.entries(state.units)
      .filter(([, unit]) => unit.side === side && unit.combat)
      .map(([id, unit]) => [id, network.trace(unit.hex, unit.traceDrawMobility)]))
    return { ...state, cursor, trace }
  })
}
