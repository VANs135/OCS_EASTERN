import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import type { Side } from '@ocs-eastern/series/state-types'
import { answerRetention, chooseFirstPlayer } from '../ttw/scorpion/initiative-step.ts'
import type { ScorpionTurn } from '../ttw/scorpion/pre-turn.ts'

type InitiativeCommand =
  | { type: 'retain-initiative'; dumpId: string }
  | { type: 'roll-initiative' }
  | { type: 'choose-first'; first: Side }

interface SupplyDump {
  side: Side
  tokens: number
  location: 'on-map' | 'off-map'
}

interface ScorpionPreTurnState {
  turn: ScorpionTurn
  dumps: Readonly<Record<string, SupplyDump>>
}

/** The room supplies the authenticated side. Automatic dice remain with the rules caller. */
export function submitScorpionInitiative(
  record: Readonly<MatchRecord<ScorpionPreTurnState, InitiativeCommand, Side>>,
  side: Side,
  command: Readonly<Command<InitiativeCommand>>,
) {
  return acceptCommand(record, side, command, (state, actor, action) => {
    if (action.type === 'choose-first') {
      return { ...state, turn: chooseFirstPlayer(state.turn, actor, action.first) }
    }
    if (action.type === 'roll-initiative') {
      return { ...state, turn: answerRetention(state.turn, actor, 'roll').turn }
    }
    const dump = state.dumps[action.dumpId]
    if (dump?.location !== 'on-map') throw new Error('Choose an on-map supply dump')
    const paid = answerRetention(state.turn, actor, 'pay', dump)
    if (!paid.dump) throw new Error('Missing paid supply dump')
    return {
      turn: paid.turn,
      dumps: { ...state.dumps, [action.dumpId]: { ...dump, tokens: paid.dump.tokens } },
    }
  })
}
