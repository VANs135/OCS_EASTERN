import { aircraftProfile, atAirBase } from '../src/match/scorpion-air-bases.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'

/** Exercise both missions from the same actual deployment, independently of the rest of the audit. */
export function sampleScorpionAirOperations(opening, assets, board) {
  const box = { kind: 'off-map-air' }
  const asset = opening.state.pieces.find((piece) => piece.kind === 'aircraft' && piece.side === 'soviet' &&
    piece.active && !piece.reduced && atAirBase(piece.location, box) &&
    aircraftProfile(piece, assets).fighter && aircraftProfile(piece, assets).airArmy === null)
  if (!asset) throw new Error('Missing full-strength independent Soviet fighter in the opening air box')
  const unitId = asset.id
  let record = opening
  const submit = (seat, action) => {
    const command = { id: `sample-air-${record.revision}`, expectedRevision: record.revision, action }
    record = submitScorpionSession(record, seat, command, assets, board).record
  }
  const launch = (mission, hex) => {
    submit('soviet', { type: 'launch-air-mission', mission, target: { kind: 'hex', hex }, unitIds: [unitId] })
  }
  const active = (side, target) => record.state.pieces.filter((piece) =>
    piece.kind === 'aircraft' && piece.side === side && piece.active && atAirBase(piece.location, target))

  launch('base-transfer', 's18.07')
  if (record.state.airMission?.step.kind === 'interception') submit('axis', { type: 'respond-interception', unitId: null })
  const capacity = record.state.airfieldCapacityChoice
  if (capacity) {
    const unitIds = active('soviet', { kind: 'hex', hex: capacity.hex }).filter((piece) => piece.id !== unitId)
      .slice(0, capacity.excess).map(({ id }) => id)
    submit('soviet', { type: 'settle-airfield-capacity', unitIds })
  }
  const transfer = record
  const landed = transfer.state.pieces.find(({ id }) => id === unitId)
  if (transfer.state.airMission || !landed?.active || !atAirBase(landed.location, { kind: 'hex', hex: 's18.07' })) {
    throw new Error('The off-map normal-range transfer did not leave an active fighter at s18.07')
  }

  record = opening
  launch('fighter-sweep', 's13.11')
  const launched = record
  let pendingReturn
  while (record.state.airMission) {
    const { step, target, returning } = record.state.airMission
    if (step.kind === 'combat-aborts') {
      submit(step.actor, { type: 'choose-air-aborts', unitIds: [] })
    } else if (step.kind === 'return') {
      pendingReturn = record
      submit('soviet', { type: 'return-aircraft', unitId: returning[0], base: box })
    } else if (step.kind === 'pick-attacker' || step.kind === 'pick-defender') {
      const choice = active(step.actor, target).find((piece) =>
        step.kind === 'pick-defender' || aircraftProfile(piece, assets).fighter)
      if (!choice) throw new Error('Missing eligible aircraft in the Scorpion sweep')
      submit(step.actor, { type: 'choose-air-combat-unit', unitId: choice.id })
    } else {
      throw new Error(`Unexpected sweep step: ${step.kind}`)
    }
  }
  if (!pendingReturn || record.state.pieces.find(({ id }) => id === unitId)?.active !== false) {
    throw new Error('The sweep fighter failed to return inactive to the map box')
  }
  return { transfer, launched, pendingReturn, returned: record, unitId }
}
