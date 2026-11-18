import { carriedScorpionTokens } from '../src/match/scorpion-sp-payment.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { deployScorpionGroundCounter } from '../src/import/scorpion-deployment.ts'

/** Use the actual Soviet deployment and map for both halves of the example. */
export function sampleScorpionLogistics(opening, assets, board) {
  const from = 's5.16'
  const to = 's4.15'
  const side = 'soviet'
  const units = Object.entries(opening.state.units)
  const regular = units.find(([, unit]) => unit.hex === from && unit.side === side && !unit.combat && !unit.organicTruck)
  const organic = units.find(([, unit]) => unit.hex === 's2.16' && unit.side === side && unit.organicTruck)
  if (!regular || !organic) throw new Error('Missing the printed logistics counters for the Scorpion example')
  const [unitId] = regular
  const [organicId, organicUnit] = organic
  let record = opening
  const submit = (action) => {
    const command = { id: `sample-logistics-${record.revision}`, expectedRevision: record.revision, action }
    record = submitScorpionSession(record, side, command, assets, board).record
  }
  submit({ type: 'load-transport', unitId, tokens: 2 })
  const loaded = record
  submit({ type: 'ground-move', unitId, path: [to] })
  submit({ type: 'unload-transport', unitId, tokens: 1 })
  submit({ type: 'fuel-formation', formation: organicUnit.formation, payments: [{ dumpId: organicId, tokens: 4 }] })
  const delivered = (record.state.dumps[`${side}:hex:${to}`]?.tokens ?? 0) - (opening.state.dumps[`${side}:hex:${to}`]?.tokens ?? 0)
  const recipients = record.state.formationFuel.at(-1).recipients
  if (record.state.units[unitId].hex !== to || carriedScorpionTokens(record.state.units[unitId]) !== 1 ||
    carriedScorpionTokens(record.state.units[organicId]) !== 0 || delivered !== 1 || !recipients.length ||
    loaded.state.dumps[`${side}:hex:${from}`].tokens !== opening.state.dumps[`${side}:hex:${from}`].tokens - 2) {
    throw new Error('The Scorpion opening did not complete the load, delivery and formation fueling')
  }
  return { loaded, arrived: record, from, to, delivered, recipients: recipients.length, organicHex: organicUnit.hex }
}

/** The printed scenario does not place ordinary Axis Transport Points. Use a controlled branch. */
export function sampleScorpionExtender(opening, assets, board) {
  const hex = 's1.07'
  const definitions = ['Ge Truck 2/45', 'Ge Truck 3/45'].map((name) => assets.catalog.aliases.get(name)?.[0])
  if (definitions.some((definition) => !definition) || !assets.map.hexes.has(hex)) {
    throw new Error('Missing the printed Axis transport counters or map hex')
  }
  const unitIds = ['sample-extender:one', 'sample-extender:two']
  const units = { ...opening.state.units, ...Object.fromEntries(definitions.map((definition, i) =>
    [unitIds[i], deployScorpionGroundCounter(definition, hex, 0)])) }
  const before = { ...opening, state: { ...opening.state, units, moved: [],
    cursor: { ...opening.state.cursor, phasing: 'axis' } } }
  const command = { id: 'sample-extender-form', expectedRevision: before.revision, action: { type: 'form-extender', unitIds } }
  const formed = submitScorpionSession(before, 'axis', command, assets, board).record
  const { range, asset } = formed.state.units[unitIds[0]].extender
  return { before, formed, hex, range, asset }
}
