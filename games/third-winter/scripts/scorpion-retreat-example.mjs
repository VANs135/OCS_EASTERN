import { parseCombatResult } from '@ocs-eastern/series/tables/ground-combat'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'

/** Controlled Do2 result using the printed air base, its actual aircraft and the Scorpion map. */
export function sampleScorpionRetreatCapture(opening, assets, board) {
  const origin = 's13.10'
  const airfield = 's13.11'
  const destination = 's13.12'
  const attackerHex = 's13.09'
  const units = Object.entries(opening.state.units)
  const [attackerId, attacker] = units.find(([, unit]) => unit.side === 'axis' && unit.attackCapable)
  const [defenderId, defender] = units.find(([, unit]) => unit.side === 'soviet' && unit.attackCapable && unit.mobility === 'leg')
  const code = 'A Do2'
  const combat = { target: origin, attacker: 'axis', attackers: [attackerId], defenders: [defenderId],
    attackerLeader: attackerId, defenderLeader: defenderId, heldAtStart: { axis: [attackerHex], soviet: [origin] },
    hedgehog: 0, roll: { code, ...parseCombatResult(code) }, step: 'defender-result' }
  let record = { ...opening, state: { ...opening.state, combat,
    cursor: { ...opening.state.cursor, phase: 'combat', phasing: 'axis' },
    units: { [attackerId]: { ...attacker, hex: attackerHex }, [defenderId]: { ...defender, hex: origin } } } }
  const issue = (side, action) => {
    const command = { id: `sample-retreat-capture-${record.revision}`, expectedRevision: record.revision, action }
    record = submitScorpionSession(record, side, command, assets, board).record
  }
  issue('soviet', { type: 'resolve-combat', lossOrder: [], optionLosses: 0,
    retreats: [{ units: [defenderId], path: [airfield, destination] }] })
  const paused = record
  const aircraft = paused.state.capture?.aircraft.map(({ id }) => ({ id, destination: { kind: 'off-map-air' } }))
  if (paused.state.units[defenderId].hex !== airfield || !aircraft?.length) {
    throw new Error('The retreat must stop at the captured air base for Axis displacement')
  }
  issue('axis', { type: 'settle-capture', aircraft })
  issue('soviet', { type: 'continue-combat-retreat' })
  if (record.state.units[defenderId].hex !== destination || record.state.combat?.step !== 'advance' ||
    record.state.rng.drawCount !== paused.state.rng.drawCount || record.state.captureHistory?.length !== 1) {
    throw new Error('The retreat did not resume and complete without rolling for the same capture twice')
  }
  return { paused, finished: record, origin, airfield, destination, displaced: aircraft.length }
}
