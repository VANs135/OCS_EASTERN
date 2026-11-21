import type { Side } from '@ocs-eastern/series/state-types'
import type { RollDie } from '@ocs-eastern/series/dice'
import { rollInitiativeContest } from '@ocs-eastern/series/initiative'
import { mayRetainInitiative, retentionAfterRoll } from './initiative.ts'
import type { ScorpionTurn } from './pre-turn.ts'

interface OnMapDump {
  side: Side
  tokens: number
}

/** A retention payment spends the indicated side's on-map supply in the same state update. */
export function answerRetention(
  turn: Readonly<ScorpionTurn>,
  actor: Side,
  choice: 'pay' | 'roll',
  dump?: Readonly<OnMapDump>,
): { turn: ScorpionTurn; dump: OnMapDump | undefined } {
  const step = turn.step
  if (step.kind !== 'retention' || step.responder !== actor) {
    throw new Error('This side cannot answer the initiative question')
  }
  if (choice === 'roll') {
    return {
      turn: { ...turn, step: { kind: 'roll', retention: step.retention } },
      dump,
    }
  }
  if (!dump || dump.side !== actor || !mayRetainInitiative(turn.number, step.retention, actor, dump.tokens / 4)) {
    throw new Error('Initiative retention requires one SP from the acting side’s on-map dump')
  }
  return {
    turn: { ...turn, step: { kind: 'choose-order', responder: actor, retention: step.retention } },
    dump: { ...dump, tokens: dump.tokens - 4 },
  }
}

/** OCS 2.3 rolls; the Scorpion retention policy is updated on a winner only. */
export function rollInitiative(turn: Readonly<ScorpionTurn>, roll: RollDie): ScorpionTurn {
  const step = turn.step
  if (step.kind !== 'roll') throw new Error('Initiative dice are not due')
  const responder = rollInitiativeContest(roll)
  if (!responder) return turn
  return {
    ...turn,
    step: { kind: 'choose-order', responder, retention: retentionAfterRoll(step.retention, responder) },
  }
}

export function chooseFirstPlayer(turn: Readonly<ScorpionTurn>, actor: Side, first: Side): ScorpionTurn {
  const step = turn.step
  if (step.kind !== 'choose-order' || step.responder !== actor) {
    throw new Error('This side cannot choose the first player')
  }
  return { ...turn, step: { kind: 'player-turn', first, retention: step.retention } }
}
