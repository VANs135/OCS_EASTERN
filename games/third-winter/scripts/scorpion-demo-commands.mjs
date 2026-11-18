import { submitScorpionSession } from '../src/match/scorpion-session.ts'

/** Scripted players preserve the first result unless the demo is specifically about rerolling. */
export function submitScorpionDemo(record, side, command, assets, board) {
  const result = submitScorpionSession(record, side, command, assets, board)
  let current = result.record
  while (!result.duplicate && current.state.reroll) {
    current = submitScorpionSession(current, current.state.rerollHolder, {
      id: `demo-keep-${current.revision}`, expectedRevision: current.revision,
      action: { type: 'resolve-reroll', decision: 'keep' },
    }, assets, board).record
  }
  return { ...result, record: current }
}

export function prepareScorpionDemoSupply(opening, assets, board) {
  let record = opening
  const { phasing, turn } = opening.state.cursor
  const submit = (action) => {
    record = submitScorpionDemo(record, phasing, {
      id: `demo-schedule-${record.revision}`, expectedRevision: record.revision, action,
    }, assets, board).record
  }
  submit({ type: 'complete-refit' })
  const rules = board.reinforcements(record.state)
  for (const entry of rules.catalog.filter((arrival) => arrival.side === phasing && arrival.turn === turn && !arrival.optionalForce)) {
    const [hex] = rules.arrivalDestinations(entry)
    if (hex) submit({ type: 'place-arrival', arrivalId: entry.id, hex })
  }
  return record
}
