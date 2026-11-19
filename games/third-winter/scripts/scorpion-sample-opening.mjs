import { createScorpionSession, submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionOpeningAirBases } from '../src/ttw/scorpion/setup-stores.ts'

/** Exercise the opening through the same command boundary that the desktop match will call. */
export function sampleScorpionOpening(setup, assets, seed = 19440126) {
  const before = createScorpionSession(setup, assets, seed)
  let record = before
  function submit(seat, action) {
    const command = { id: `opening-${record.revision}`, expectedRevision: record.revision, action }
    record = submitScorpionSession(record, seat, command, assets).record
  }
  function baseAircraft(seat) {
    const airfield = scorpionOpeningAirBases.find((base) => base.side === seat)
    const aircraft = record.state.opening.pieces.filter((piece) => piece.kind === 'aircraft' && piece.side === seat)
    for (const [index, { id }] of aircraft.entries()) {
      const base = index < 4 + airfield.level ? { kind: 'hex', hex: airfield.hex } : { kind: 'off-map-air' }
      submit(seat, { type: 'base-aircraft', id, base })
    }
  }
  baseAircraft('axis')
  const alertHexes = ['s1.09', 's2.09']
  for (const [index, { id }] of record.state.opening.drawnAlerts.entries()) {
    submit('axis', { type: 'place-setup-alert', id, hex: alertHexes[index] })
  }
  submit('axis', { type: 'confirm-setup' })
  const axisConfirmed = record
  baseAircraft('soviet')
  for (const { candidates } of record.state.opening.lossChoices) {
    submit('soviet', { type: 'choose-setup-loss', id: candidates[0] })
  }
  submit('soviet', { type: 'confirm-setup' })
  return { before, axisConfirmed, started: record }
}
