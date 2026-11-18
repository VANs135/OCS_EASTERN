import { parseCombatResult } from '@ocs-eastern/series/tables/ground-combat'
import { scorpionRemnantDestinations } from '../src/match/scorpion-remnants.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionMapStacks } from '../src/view/scorpion-map-counters.ts'

/** Controlled last-step loss for the 57th Infantry Division on its printed setup hex. */
export function sampleScorpionRemnant(opening, assets, board) {
  const { state } = opening
  const [divisionId, division] = Object.entries(state.units).find(([, unit]) =>
    assets.catalog.definitions.get(unit.definition)?.source.name === 'Ge 57 Inf Div')
  const attackerId = Object.keys(state.units).find((id) => state.units[id].side === 'soviet' && state.units[id].attackCapable)
  const [destination] = scorpionRemnantDestinations(state, division.hex, assets)
  if (!attackerId || !destination) throw new Error('The controlled remnant sample needs a westward exit')
  const code = 'A DL1'
  const controlled = { ...opening, state: { ...state, cursor: { ...state.cursor, phase: 'combat' },
    units: { ...state.units, [divisionId]: { ...division, stepsLost: 3, disorganized: true } },
    combat: { target: division.hex, attacker: 'soviet', attackers: [attackerId], defenders: [divisionId],
      defenderLeader: divisionId, step: 'defender-result', roll: { code, ...parseCombatResult(code) } } } }
  const { record: settled } = submitScorpionSession(controlled, 'axis', {
    id: `sample-remnant-${opening.revision}`, expectedRevision: opening.revision,
    action: { type: 'resolve-combat', lossOrder: [divisionId], optionLosses: 0, retreats: [],
      remnants: [{ divisionId, hex: destination }] },
  }, assets, board)
  const stack = scorpionMapStacks(settled.state, assets.catalog, []).find(({ hex }) => hex === destination)
  const piece = stack?.pages.flat().find(({ id }) => settled.state.units[id]?.remnantOf === divisionId)
  const vp = settled.state.arrival.sovietVp - state.arrival.sovietVp
  if (piece?.asset !== 'Remn1.png' || vp !== 1 || !settled.state.pieces.some(({ id }) => id === divisionId)) {
    throw new Error('Remnant placement, dead pile and victory points must settle together')
  }
  return { settled, report: { division: division.definition, origin: division.hex, destination, asset: piece.asset, vp } }
}
