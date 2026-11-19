import { scorpionGroundProfile } from '../src/import/ground-profile.ts'
import { aircraftProfile, atAirBase } from '../src/match/scorpion-air-bases.ts'
import { hasScorpionBarrageSpotter } from '../src/match/scorpion-barrage.ts'
import { remainingSteps } from '../src/match/scorpion-losses.ts'
import { prepareScorpionDemoSupply, submitScorpionDemo } from './scorpion-demo-commands.mjs'
import { scorpionStepCost } from '../src/ttw/scorpion/terrain-cost.ts'

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
    record = submitScorpionDemo(record, seat, command, assets, board).record
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

function openingBombardmentAircraft(opening, assets) {
  const box = { kind: 'off-map-air' }
  const candidates = opening.state.pieces.filter((piece) => piece.kind === 'aircraft' && piece.side === 'soviet' &&
    piece.active).map((piece) => ({ piece, ...aircraftProfile(piece, assets) }))
    .filter(({ bombing, airArmy }) => bombing >= 1 && airArmy === null).sort((a, b) => b.bombing - a.bombing)
  const offMap = candidates.find(({ piece }) => atAirBase(piece.location, box))
  if (!offMap) throw new Error('No independent Soviet aircraft with barrage strength in the off-map box')
  return [offMap, ...candidates.filter((candidate) => candidate !== offMap).slice(0, 3)].map(({ piece }) => piece.id)
}

export function sampleScorpionAirBarrage(opening, assets, board) {
  const box = { kind: 'off-map-air' }
  const unitIds = openingBombardmentAircraft(opening, assets)
  const targets = Map.groupBy(Object.values(opening.state.units).filter((unit) => unit.side === 'axis' && unit.combat &&
    !opening.state.airBases.some((base) => base.hex === unit.hex) &&
    hasScorpionBarrageSpotter(opening.state, 'soviet', unit.hex, assets.map)), ({ hex }) => hex)
  const [hex] = [...targets].sort(([, a], [, b]) => b.length - a.length)[0] ?? []
  if (!hex) throw new Error('No opening air barrage target with a spotter')
  let record = opening
  const submit = (seat, action) => {
    const command = { id: `sample-bombing-${record.revision}`, expectedRevision: record.revision, action }
    record = submitScorpionDemo(record, seat, command, assets, board).record
  }

  submit('soviet', { type: 'launch-air-mission', mission: 'barrage', target: { kind: 'hex', hex }, unitIds })
  if (record.state.airMission?.step.kind === 'interception') submit('axis', { type: 'respond-interception', unitId: null })
  if (record.state.airMission?.step.kind === 'flak-loss') {
    submit('soviet', { type: 'choose-flak-loss', unitId: record.state.airMission.step.candidates[0] })
  }
  if (record.state.airMission?.step.kind !== 'barrage') throw new Error('The opening bombing run did not reach the target')
  const attacking = record
  submit('axis', { type: 'choose-barrage-terrain', terrain: assets.map.hexes.get(hex).terrains[0] })
  let losses = record.state.barrage?.lossesDue ?? 0
  if (losses) {
    const allocation = []
    for (const [unitId, unit] of Object.entries(record.state.units)) {
      if (unit.hex !== hex || unit.side !== 'axis' || !unit.combat) continue
      const steps = Math.min(losses, remainingSteps(unit))
      allocation.push({ unitId, steps })
      losses -= steps
      if (!losses) break
    }
    submit('axis', { type: 'assign-barrage-loss', allocation })
  }
  const returning = record
  for (const unitId of returning.state.airMission?.returning ?? []) {
    submit('soviet', { type: 'return-aircraft', unitId, base: box })
  }
  const event = record.state.barrageHistory.at(-1)
  const survivors = Object.values(record.state.units).filter((unit) => unit.side === 'axis' && unit.hex === hex && unit.combat)
  const landed = unitIds.every((id) => {
    const plane = record.state.pieces.find((piece) => piece.id === id)
    return plane?.active === false && atAirBase(plane.location, box)
  })
  if (record.state.airMission || event.cost !== 0 || event.air.shortRange || !event.roll.disorganize ||
    !survivors.length || survivors.some((unit) => !unit.disorganized) || !landed) {
    throw new Error(`The opening bombing run did not finish with the expected off-map flight and ground result: ${hex} ${JSON.stringify(event.roll)}`)
  }
  return { attacking, returning, returned: record, event, unitIds }
}

export function sampleScorpionTrainbusting(opening, assets, board) {
  const unitIds = openingBombardmentAircraft(opening, assets)
  const target = { kind: 'hex', hex: 's17.04' }
  let record = opening
  const submit = (seat, action) => {
    const command = { id: `sample-trainbusting-${record.revision}`, expectedRevision: record.revision, action }
    record = submitScorpionDemo(record, seat, command, assets, board).record
  }
  submit('soviet', { type: 'launch-air-mission', mission: 'trainbusting', target, unitIds })
  if (record.state.airMission?.step.kind === 'interception') submit('axis', { type: 'respond-interception', unitId: null })
  if (record.state.airMission?.step.kind === 'flak-loss') {
    submit('soviet', { type: 'choose-flak-loss', unitId: record.state.airMission.step.candidates[0] })
  }
  const returning = record
  const event = record.state.barrageHistory?.at(-1)
  if (record.state.airMission?.step.kind !== 'return' || !event?.trainbustingRoll?.placed) {
    throw new Error('The opening trainbusting run did not place its marker')
  }
  for (const unitId of record.state.airMission.returning) {
    submit('soviet', { type: 'return-aircraft', unitId, base: { kind: 'off-map-air' } })
  }
  if (record.state.airMission) throw new Error('The opening trainbusting aircraft did not finish returning')
  return { returning, returned: record, event }
}

export function sampleScorpionSupplyAirlift(opening, assets, board) {
  const box = { kind: 'off-map-air' }
  const source = 'soviet:air-box'
  const target = { kind: 'hex', hex: 's18.07' }
  const destination = `soviet:hex:${target.hex}`
  let record = prepareScorpionDemoSupply(opening, assets, board)
  const submit = (seat, action) => {
    const command = { id: `sample-airlift-${record.revision}`, expectedRevision: record.revision, action }
    record = submitScorpionDemo(record, seat, command, assets, board).record
  }
  submit('soviet', { type: 'finish-scheduled-arrivals' })
  submit('soviet', { type: 'place-supply', target: { kind: 'air-box' }, tokens: record.state.window.variableTokens })
  submit('soviet', { type: 'complete-reinforcement' })
  const before = record
  const plane = record.state.pieces.find((piece) => piece.kind === 'aircraft' && piece.side === 'soviet' &&
    piece.active && atAirBase(piece.location, box) && aircraftProfile(piece, assets).transport === 1)
  if (!plane) throw new Error('Missing opening Soviet transport in the off-map air box')
  submit('soviet', { type: 'launch-air-mission', mission: 'transport', target, unitIds: [plane.id], supplyTokens: 2 })
  if (record.state.airMission?.step.kind === 'interception') submit('axis', { type: 'respond-interception', unitId: null })
  if (record.state.airMission?.step.kind === 'return') submit('soviet', { type: 'return-aircraft', unitId: plane.id, base: box })
  const event = record.state.airHistory?.at(-1)
  const delivered = event?.airlift?.unloading?.delivered
  if (record.state.airMission || !delivered || record.state.dumps[source].tokens !== before.state.dumps[source].tokens - 2 ||
    record.state.dumps[destination].tokens !== (before.state.dumps[destination]?.tokens ?? 0) + delivered) {
    throw new Error('The opening supply airlift did not debit the off-map box and deliver to the on-map base')
  }
  return { before, returned: record, event }
}

export function sampleScorpionSupplyDrop(before, assets, board) {
  const box = { kind: 'off-map-air' }
  const target = { kind: 'hex', hex: 's21.13' }
  const source = 'soviet:air-box'
  const destination = `soviet:hex:${target.hex}`
  if (before.state.airBases.some((base) => base.hex === target.hex)) throw new Error('The sample drop must target a hex without an air base')
  const lift = before.state.pieces.find((piece) => piece.kind === 'aircraft' && piece.side === 'soviet' && piece.active &&
    atAirBase(piece.location, box) && aircraftProfile(piece, assets).transport === 1)
  if (!lift) throw new Error('Missing the Soviet transport for the supply drop')
  let record = before
  const submit = (seat, action) => {
    const command = { id: `sample-drop-${record.revision}`, expectedRevision: record.revision, action }
    record = submitScorpionDemo(record, seat, command, assets, board).record
  }
  submit('soviet', { type: 'launch-air-mission', mission: 'air-drop', target, supplyTokens: 2, unitIds: [lift.id] })
  if (record.state.airMission?.step.kind === 'interception') submit('axis', { type: 'respond-interception', unitId: null })
  const returning = record
  if (record.state.airMission?.step.kind === 'return') submit('soviet', { type: 'return-aircraft', unitId: lift.id, base: box })
  const event = record.state.airHistory?.at(-1)
  const result = event?.drop?.result
  if (record.state.airMission || !result || record.state.dumps[source].tokens !== before.state.dumps[source].tokens - 2 ||
    (record.state.dumps[destination]?.tokens ?? 0) !== (before.state.dumps[destination]?.tokens ?? 0) + result.landedTokens) {
    throw new Error('The supply drop did not settle the departure and target hex supply')
  }
  return { before, returning, returned: record, event }
}

/** Actual airport, supply dump and unit data. Clear the defending stack to exercise capture in a controlled branch. */
export function sampleScorpionOnMapSupplyAirlift(opening, assets, board) {
  const source = { kind: 'hex', hex: 's13.11' }
  const target = { kind: 'hex', hex: 's18.07' }
  const sourceId = `axis:hex:${source.hex}`
  const destinationId = `axis:hex:${target.hex}`
  const neighbors = assets.map.neighbors(target.hex)
  const [captor] = Object.entries(opening.state.units).find(([, unit]) =>
    unit.side === 'axis' && unit.attackCapable && unit.mobility === 'leg' && neighbors.includes(unit.hex)) ?? []
  const plane = opening.state.pieces.find((piece) => piece.kind === 'aircraft' && piece.side === 'axis' && piece.active &&
    atAirBase(piece.location, source) && aircraftProfile(piece, assets).transport === 0.5)
  if (!captor || !plane) throw new Error('Missing the Axis ground or air counter for the controlled on-map airlift')
  const units = Object.fromEntries(Object.entries(opening.state.units).filter(([, unit]) => unit.side !== 'soviet' || unit.hex !== target.hex))
  const cursor = { ...opening.state.cursor, phase: 'movement', phasing: 'axis' }
  let record = { ...opening, state: { ...opening.state, units, cursor } }
  const submit = (seat, action) => {
    const command = { id: `sample-on-map-airlift-${record.revision}`, expectedRevision: record.revision, action }
    record = submitScorpionDemo(record, seat, command, assets, board).record
  }
  submit('axis', { type: 'ground-move', unitId: captor, path: [target.hex] })
  const before = record
  submit('axis', { type: 'launch-air-mission', mission: 'transport', target, supplySource: source, supplyTokens: 1,
    unitIds: [plane.id], flightModes: [{ id: plane.id, mode: 'double-capacity' }] })
  submit('axis', { type: 'return-aircraft', unitId: plane.id, base: source })
  const event = record.state.airHistory?.at(-1)
  if (event?.airlift?.unloading?.delivered !== 1 || record.state.dumps[sourceId].tokens !== before.state.dumps[sourceId].tokens - 1 ||
    record.state.dumps[destinationId].tokens !== (before.state.dumps[destinationId]?.tokens ?? 0) + 1) {
    throw new Error('The on-map airlift did not debit its departure dump and credit the captured air base')
  }
  return { before, returned: record, event, aircraft: assets.catalog.definitions.get(plane.definition).source.name }
}

/** Prepare the transport and one real ground counter at the departure field in the controlled capture branch. */
export function sampleScorpionGroundAirlift(opening, assets, board) {
  const source = { kind: 'hex', hex: 's13.11' }
  const target = { kind: 'hex', hex: 's18.07' }
  const box = { kind: 'off-map-air' }
  const aircraft = opening.state.pieces.filter((piece) => piece.kind === 'aircraft' && piece.side === 'axis' && piece.active)
  const plane = aircraft.find((piece) => aircraftProfile(piece, assets).transport === 1)
  const spare = aircraft.find((piece) => atAirBase(piece.location, source) && aircraftProfile(piece, assets).fighter)
  const [id, unit] = Object.entries(opening.state.units).find(([, candidate]) => {
    if (candidate.side !== 'axis' || !candidate.combat || candidate.printedRe !== 1 || candidate.hex === target.hex) return false
    const definition = assets.catalog.definitions.get(candidate.definition)
    const mode = definition && scorpionGroundProfile(definition, 'move')
    return mode?.mobility === 'leg' && mode.allowance >= 2 && mode.allowance <= 6
  }) ?? []
  if (!plane || !spare || !unit) throw new Error('Missing a transport, fighter, or eligible ground counter for the controlled airlift')
  const pieces = opening.state.pieces.map((piece) => piece.id === plane.id ? { ...piece, location: source }
    : piece.id === spare.id ? { ...piece, location: box } : piece)
  const before = { ...opening, state: { ...opening.state, pieces,
    units: { ...opening.state.units, [id]: { ...unit, hex: source.hex } } } }
  let record = before
  const submit = (action) => {
    const command = { id: `sample-ground-airlift-${record.revision}`, expectedRevision: record.revision, action }
    record = submitScorpionDemo(record, 'axis', command, assets, board).record
  }
  submit({ type: 'launch-air-mission', mission: 'transport', target, supplySource: source, cargoUnitIds: [id],
    unitIds: [plane.id], flightModes: [{ id: plane.id, mode: 'double-capacity' }] })
  submit({ type: 'return-aircraft', unitId: plane.id, base: source })
  const landed = record
  const loaded = landed.state.units[id]
  const next = assets.map.neighbors(target.hex).find((hex) => {
    const cost = scorpionStepCost(assets.map, target.hex, hex, 'leg', 'freeze')
    return typeof cost === 'number' && cost <= loaded.allowance / 2 &&
      !Object.values(landed.state.units).some((counter) => counter.side === 'soviet' && counter.hex === hex)
  })
  if (loaded.hex !== target.hex || !loaded.moveMode || !next) throw new Error('Ground cargo did not arrive with a legal ground movement option')
  submit({ type: 'ground-move', unitId: id, path: [next] })
  if (record.state.units[id].hex !== next) throw new Error('The airlifted counter did not complete its ground move')
  return { before, landed, marched: record, id, destination: next, name: assets.catalog.definitions.get(unit.definition).source.name }
}
