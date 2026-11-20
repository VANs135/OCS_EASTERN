import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { basename, dirname, join, resolve } from 'node:path'
import { barrageColumn } from '@ocs-eastern/series/tables/barrage'
import { campaignHexKey, scorpionHexDistance, scorpionHexId, scorpionPrintedHex } from '../src/import/hex-id.ts'
import { scorpionArtillery } from '../src/import/scorpion-artillery.ts'
import { scorpionGroundProfile } from '../src/import/ground-profile.ts'
import { submitScorpionDemo } from './scorpion-demo-commands.mjs'
import { scorpionGroundDeployment } from '../src/import/scorpion-deployment.ts'
import { loadScorpionFiles } from '../src/import/scorpion-files.mjs'
import { scorpionArrivalCatalog } from '../src/import/scorpion-arrivals.ts'
import { scorpionFixedSupply } from '../src/ttw/scorpion/fixed-supply.ts'
import { mayPlanTtwCombatAirDrop } from '../src/ttw/air/airdrop-eligibility.ts'
import { scorpionAxisSources, scorpionControlSites, scorpionInitialRailGauge, scorpionOpeningFrontControl, scorpionSovietSources } from '../src/ttw/scorpion/initial-map.ts'
import { scorpionSupplyNetwork, scorpionTraceOptions } from '../src/ttw/scorpion/supply-trace.ts'
import { scorpionEnemyZoc, scorpionSupplyPosition } from '../src/match/scorpion-supply-position.ts'
import { scorpionReinforcementBoard } from '../src/match/scorpion-reinforcement-board.ts'
import { scorpionSpPayment } from '../src/match/scorpion-sp-payment.ts'
import { scorpionStepCost } from '../src/ttw/scorpion/terrain-cost.ts'
import { remainingSteps } from '../src/match/scorpion-losses.ts'
import { scorpionMapStacks } from '../src/view/scorpion-map-counters.ts'
import {
  sampleScorpionAirBarrage, sampleScorpionAirOperations, sampleScorpionGroundAirlift, sampleScorpionOnMapSupplyAirlift,
  sampleScorpionSupplyAirlift, sampleScorpionSupplyDrop, sampleScorpionTrainbusting,
} from './scorpion-air-example.mjs'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'
import { sampleScorpionRefit } from './scorpion-refit-example.mjs'
import { sampleScorpionFrontBarrage } from './scorpion-front-barrage-example.mjs'
import { sampleScorpionExtender, sampleScorpionLogistics } from './scorpion-logistics-example.mjs'
import { sampleScorpionRetreatCapture } from './scorpion-retreat-example.mjs'
import { sampleScorpionRemnant } from './scorpion-remnant-example.mjs'
import { sampleScorpionReroll } from './scorpion-reroll-example.mjs'
import { playScorpionToEnd } from './scorpion-playthrough.mjs'

const root = process.argv[2]
const args = process.argv.slice(3)
// --scorpion-only skips the campaign map checks. The Scorpion map ships its own files, so the
// campaign 地图数据库/map_hexes.json and map_edges.json are not needed for a Scorpion audit.
const scorpionOnly = args.includes('--scorpion-only')
if (!root) throw new Error('Usage: npm run audit:data --workspace=@ocs-eastern/third-winter -- <TTW directory> [unit directory] [--scorpion-only]')
const unitRoot = args.find((arg) => !arg.startsWith('--'))
const readAt = async (folder, ...path) => JSON.parse((await readFile(join(folder, ...path), 'utf8')).replace(/^\uFEFF/, ''))
const read = (...path) => readAt(root, ...path)
const [{ catalog: { definitions, aliases, rawIds }, setup, arrivals: reinforcement, map }, campaign] = await Promise.all([
  loadScorpionFiles(root, unitRoot, (file) => readAt(file)),
  scorpionOnly ? null : Promise.all([read('地图数据库', 'map_hexes.json'), read('地图数据库', 'map_edges.json')]),
])
const [hexes, edges] = campaign ?? [null, null]
const byHex = hexes ? new Map(hexes.items.map((hex) => [campaignHexKey(hex.hex_id), hex])) : new Map()
if (hexes && byHex.size !== hexes.items.length) throw new Error('Campaign source hex ID collision')
const seamIssues = hexes ? hexes.items.filter((hex) => {
  if (!hex.seam_twin) return false
  const peer = byHex.get(campaignHexKey(hex.seam_twin))
  return peer?.seam_twin !== hex.hex_id || peer.seam_primary === hex.seam_primary
}) : []
const danglingEdges = edges ? edges.items.filter((edge) =>
  [edge.hex_a, edge.hex_b].some((id) => id !== null && !byHex.has(campaignHexKey(id))),
) : []
const edgeGroups = new Map()
for (const edge of edges?.items ?? []) {
  if (!edge.seam_dup_group) continue
  const keys = edgeGroups.get(edge.seam_dup_group) ?? new Set()
  keys.add(JSON.stringify([edge.road_present, edge.road_subclass, edge.rail_present, edge.rail_class]))
  edgeGroups.set(edge.seam_dup_group, keys)
}
function references(value) {
  if (Array.isArray(value)) return value.flatMap(references)
  if (value === null || typeof value !== 'object') return []
  return typeof value.ref === 'string' ? [value.ref] : Object.values(value).flatMap(references)
}
const sourceRefs = [...references(setup), ...references(reinforcement)]
const unresolved = [...new Set(sourceRefs.filter((name) => aliases.get(name)?.length !== 1))]
const playableArrivals = unresolved.length === 0 ? scorpionArrivalCatalog(reinforcement, aliases) : []
const missingSetupHexes = [...new Set(
  [setup.units, setup.air, setup.markers].flat().filter(({ at }) => at)
    .map(({ at }) => scorpionPrintedHex(at.col, at.row)).filter((hex) => !map.hexes.has(hex)),
)]
const placementHexes = [...playableArrivals, ...scorpionFixedSupply].flatMap(({ destinations }) => destinations)
const missingArrivalHexes = [...new Set(placementHexes.filter((hex) =>
  !map.hexes.has(scorpionHexId(hex)),
))]
const deployment = unresolved.length === 0 && missingSetupHexes.length === 0
  ? scorpionGroundDeployment(setup.units, aliases, map)
  : { units: {}, lossChoices: [] }
function unknownMovement(keys) {
  return [...new Set(keys)].flatMap((key) => {
    const definition = definitions.get(key)
    if (!definition || !['land', 'hq', 'transport'].includes(definition.kind)) return []
    const unknownModes = ['combat', 'move'].filter((mode) => !scorpionGroundProfile(definition, mode))
    return unknownModes.length ? [{ name: definition.source.name, modes: unknownModes }] : []
  })
}
const unknownSetupMovement = unknownMovement(Object.values(deployment.units).map(({ definition }) => definition))
const unknownArrivalMovement = unknownMovement(playableArrivals.map(({ definition }) => definition))
let opening
if (unresolved.length === 0 && missingSetupHexes.length === 0 && missingArrivalHexes.length === 0) {
  const assets = { map, catalog: { definitions, aliases } }
  const { before, started } = sampleScorpionOpening(setup, assets)
  const refit = sampleScorpionRefit(started, assets)
  let record = started
  const reinforcements = (state) => scorpionReinforcementBoard(state, assets, playableArrivals)
  const tablePath = process.env.OCS_V43_CRT
  const combat = tablePath ? { table: await readAt(dirname(resolve(tablePath)), basename(tablePath)) } : undefined
  const barragePath = process.env.OCS_V43_BARRAGE
  const barrage = barragePath ? await readAt(dirname(resolve(barragePath)), basename(barragePath)) : undefined
  const facilityPath = process.env.OCS_V43_FACILITY
  const facilityBarrage = facilityPath ? await readAt(dirname(resolve(facilityPath)), basename(facilityPath)) : undefined
  const board = { reinforcements, combat, barrage, facilityBarrage }
  function submit(action, seat = record.state.cursor.phasing) {
    const command = { id: `start-${record.revision}`, expectedRevision: record.revision, action }
    record = submitScorpionDemo(record, seat, command, assets, board).record
  }
  submit({ type: 'complete-refit' })
  for (const { id, destinations } of playableArrivals.filter(({ side, turn }) => side === 'soviet' && turn === 1)) {
    submit({ type: 'place-arrival', arrivalId: id, hex: destinations[0] })
  }
  submit({ type: 'place-supply', target: { kind: 'hex', id: 's22.02' }, tokens: 8 })
  submit({ type: 'finish-scheduled-arrivals' })
  submit({ type: 'complete-reinforcement' })
  const air = sampleScorpionAirOperations(record, assets, board)
  const { from, to, delivered, recipients, organicHex } = sampleScorpionLogistics(record, assets, board)
  const { hex: extenderHex, range, asset: extenderAsset } = sampleScorpionExtender(record, assets, board)
  const front = scorpionOpeningFrontControl(map)
  const sites = scorpionControlSites(map)
  if (Object.keys(started.state.railControl).length !== sites.size || Object.keys(started.state.railControl).some((hex) => !sites.has(hex)) ||
    Object.values(started.state.units).some(({ hex, side }) => sites.has(hex) && front[hex] !== side) ||
    started.state.airBases.some(({ hex, side }) => sites.has(hex) && front[hex] !== side) ||
    scorpionAxisSources.some((hex) => front[hex] !== 'axis') || scorpionSovietSources.some((hex) => front[hex] !== 'soviet') ||
    front['s13.11'] !== 'axis') {
    throw new Error('The opening control boundary contradicts the printed deployment or a supply source')
  }
  const [unitId, rifle] = Object.entries(record.state.units).find(([, unit]) =>
    definitions.get(unit.definition)?.source.name === 'Sov 58 Rifle Div')
  const beforeConstruction = record
  const source = scorpionSpPayment(record.state, 'soviet', map).available([rifle]).find(({ tokens }) => tokens >= 8)
  if (!source) throw new Error('No construction supply in reach of the 58th Rifle Division')
  submit({ type: 'work-hedgehog', operation: 'build', hex: rifle.hex, unitIds: [unitId], payments: [{ ...source, tokens: 8 }] })
  const stacked = scorpionMapStacks(record.state, assets.catalog, []).find(({ hex }) => hex === rifle.hex)
  const hedgehog = stacked?.pages.flat().find(({ id }) => id === `hedgehog:${rifle.hex}`)
  if (hedgehog?.asset !== 'misc_hog-1.png') throw new Error('The constructed hedgehog needs its printed counter')
  record = beforeConstruction
  submit({ type: 'ground-move', unitId, path: ['s1.12'] })
  const enemyZoc = scorpionEnemyZoc(record.state, map, 'soviet')
  const reserves = Map.groupBy(Object.entries(record.state.units).filter(([id, unit]) => id !== unitId &&
    unit.side === 'soviet' && unit.combat && unit.mobility === 'leg' && unit.allowance > 0 && !enemyZoc.has(unit.hex)),
  ([, unit]) => unit.hex)
  const safeHexes = new Set(Object.values(record.state.units).filter((unit) => unit.side === 'soviet' && unit.combat)
    .map((unit) => unit.hex))
  const reserveMove = [...reserves].flatMap(([hex, stack]) => {
    if (stack.length < 2) return []
    return map.neighbors(hex).filter((near) => safeHexes.has(near) && !enemyZoc.has(near) &&
      scorpionStepCost(map, hex, near, 'leg', record.state.turn.weather.ground) !== null)
      .map((near) => ({ from: hex, to: near, unitIds: stack.slice(0, 2).map(([id]) => id) }))
  })[0]
  if (!reserveMove) throw new Error('No legal two-counter Reserve move in the Scorpion opening')
  submit({ type: 'reserve-stack-move', path: [reserveMove.to], counters: reserveMove.unitIds.map((id) => ({ unitId: id })) })
  opening = {
    startPhase: started.state.cursor.phase,
    sampleAir: { id: air.unitId, transfer: air.transfer.state.airHistory.at(-1),
      sweep: air.returned.state.airHistory.at(-1), returned: air.returned.state.pieces.find(({ id }) => id === air.unitId).location },
    sampleRefit: { airBase: refit.airBase, tokensSpent: refit.spent,
      offMapActive: refit.after.state.pieces.find(({ id }) => id === refit.offMap)?.active },
    startGroundCounters: Object.keys(started.state.units).length,
    airUnitsPlaced: started.state.pieces.filter((piece) => piece.kind === 'aircraft' && piece.location.kind !== 'air-setup').length,
    setupAlerts: before.state.opening.drawnAlerts.length,
    reserveAlerts: started.state.availableAlerts.length,
    startSupplyTokens: Object.values(started.state.dumps).reduce((sum, dump) => sum + dump.tokens, 0),
    followingPhase: record.state.cursor.phase,
    followingGroundCounters: Object.keys(record.state.units).length,
    firstMoveDestination: record.state.units[unitId].hex,
    sampleLogistics: { from, to, delivered, recipients, organicHex },
    controlledExtender: { hex: extenderHex, range, asset: extenderAsset },
    sampleHedgehog: { hex: rifle.hex, asset: hedgehog.asset },
    openingControl: Object.fromEntries(['axis', 'soviet'].map((side) =>
      [side, Object.values(started.state.railControl).filter((controller) => controller === side).length])),
    reserveMove: { from: reserveMove.from, to: reserveMove.to, counters: reserveMove.unitIds.length },
  }
  if (combat) {
    const beforeOverrun = record
    const { origin, airfield, destination, displaced } = sampleScorpionRetreatCapture(started, assets, board)
    opening.controlledRetreatCapture = { origin, airfield, destination, displaced }
    opening.controlledDefenderStocks = sampleDefenderStocks(record, assets, board)
    opening.controlledRemnant = sampleScorpionRemnant(record, assets, board).report
    opening.sampleOverrun = sampleBattle(record.state, map, submit, () => record.state, true)
    record = beforeOverrun
  }
  if (barrage) {
    const strike = sampleScorpionAirBarrage(record, assets, board)
    opening.sampleAirBarrage = { target: strike.event.target, strength: strike.event.strength, result: strike.event.roll.code,
      cost: strike.event.cost, shortRange: strike.event.air.shortRange, aircraft: strike.unitIds.length }
    const { deployed, finished, front, center, result } = sampleScorpionFrontBarrage(record, assets, board)
    opening.sampleFrontBarrage = { front, center, activeHex: deployed.state.frontBarrage.center,
      recoveryBox: finished.state.barrageRecovery[front], cost: result.cost, result: result.roll.code }
  }
  if (facilityBarrage) {
    const mission = sampleScorpionTrainbusting(record, assets, board)
    record = mission.returned
    const { target, trainbustingRoll } = mission.event
    opening.sampleTrainbusting = { target, result: trainbustingRoll.code, cost: mission.event.cost }
  }
  function finishSupply() {
    submit({ type: 'complete-movement' })
    for (const { formation, anchors } of record.state.supply.splits) {
      submit({ type: 'choose-formation-trace', formation, anchor: anchors[0] })
    }
    submit({ type: 'check-attrition' })
    const attrition = record.state.supply.attrition
    for (const stack of attrition.filter(({ assigned }) => !assigned)) {
      let remainder = stack.losses
      const allocation = []
      for (const id of stack.units) {
        const steps = Math.min(remainder, remainingSteps(record.state.units[id]))
        if (!steps) break
        allocation.push({ unitId: id, steps })
        remainder -= steps
      }
      submit({ type: 'assign-attrition', hex: stack.hex, allocation })
    }
    submit({ type: 'complete-supply' })
    return attrition.length
  }
  opening.attritionChecks = finishSupply()
  opening.phaseAfterSupply = record.state.cursor.phase
  submit({ type: 'complete-reaction' }, 'axis')
  if (barrage) {
    const beforeBarrage = record
    opening.sampleArtillery = sampleArtillery(record.state, map, barrage, submit, () => record.state)
    record = beforeBarrage
  }
  if (combat) opening.sampleBattle = sampleBattle(record.state, map, submit, () => record.state)
  submit({ type: 'complete-combat' })
  submit({ type: 'complete-exploitation' })
  submit({ type: 'complete-cleanup' })
  if (opening.sampleTrainbusting) {
    if (!record.state.trainbusting.some(({ hex }) => hex === opening.sampleTrainbusting.target)) {
      throw new Error('Soviet Trainbusting marker was removed in its own cleanup')
    }
    opening.sampleTrainbusting.presentAfterSovietCleanup = true
  }
  submit({ type: 'complete-refit' })
  submit({ type: 'finish-scheduled-arrivals' })
  submit({ type: 'complete-reinforcement' })
  opening.axisAttritionChecks = finishSupply()
  const [released, remaining] = reserveMove.unitIds
  submit({ type: 'release-reserve', unitId: released }, 'soviet')
  opening.reserveReleasedInSovietReaction = record.state.units[released].released
  opening.secondCounterStillInReserve = Boolean(record.state.units[remaining].reserve)
  submit({ type: 'complete-reaction' }, 'soviet')
  submit({ type: 'complete-combat' })
  submit({ type: 'complete-exploitation' })
  submit({ type: 'complete-cleanup' })
  if (opening.sampleTrainbusting) {
    if (record.state.trainbusting.length) throw new Error('Axis cleanup did not remove the Soviet Trainbusting marker')
    opening.sampleTrainbusting.removedAfterAxisCleanup = true
  }
  submit({ type: 'retain-initiative', dumpId: 'soviet:hex:s1.14' }, 'soviet')
  submit({ type: 'choose-first', first: 'soviet' }, 'soviet')
  opening.nextTurn = record.state.turn.number
  opening.nextPhase = record.state.cursor.phase
  opening.sampleReroll = sampleScorpionReroll(record, assets, board).report
  if (record.state.turn.weather.flight === 'none') {
    opening.sampleAirlift = { flight: 'none' }
  } else {
    const lift = sampleScorpionSupplyAirlift(record, assets, board)
    opening.sampleAirlift = { target: lift.event.target.hex, loaded: lift.event.airlift.tokens, ...lift.event.airlift.unloading }
    const { event } = sampleScorpionSupplyDrop(lift.before, assets, board)
    opening.sampleSupplyDrop = { target: event.target.hex, aircraft: event.flights[0].id, ...event.drop.result }
  }
  const onMap = sampleScorpionOnMapSupplyAirlift(started, assets, board)
  opening.controlledOnMapAirlift = { aircraft: onMap.aircraft, source: onMap.event.airlift.source.hex,
    target: onMap.event.target.hex, ...onMap.event.airlift.unloading }
  const groundLift = sampleScorpionGroundAirlift(onMap.before, assets, board)
  opening.controlledGroundAirlift = { unit: groundLift.name, landingHex: groundLift.landed.state.units[groundLift.id].hex,
    groundDestination: groundLift.destination, groundMpUsed: groundLift.marched.state.groundActivity.spent[groundLift.id] }
  opening.playthroughs = auditPlaythroughs(setup, assets, playableArrivals)
  if (combat) assert.ok(opening.sampleBattle.losses.axis > 0 && opening.sampleBattle.losses.soviet > 0)
}

function auditPlaythroughs(setup, assets, arrivals) {
  const full = playScorpionToEnd(setup, assets, arrivals, { seed: 19440126, withdraw: true })
  const thawEnd = playScorpionToEnd(setup, assets, arrivals, { seed: 153, withdraw: true })
  const sudden = playScorpionToEnd(setup, assets, arrivals, { seed: 19440126, withdraw: false, sovietOptional: true })
  assert.equal(full.turns.length, 8)
  assert.equal(full.reloads, 16)
  assert.equal(full.vp, 6)
  assert.deepEqual(full.result, { outcome: 'draw' })
  assert.equal(new Set(full.turns.map(({ first }) => first)).size, 2)
  assert.equal(full.turns.filter(({ ground }) => ground === 'thaw').length, 1)
  assert.equal(full.arrivals, arrivals.filter(({ optionalForce, side }) => !optionalForce || side === 'axis').length)
  assert.ok(full.alertsPlaced > 0)
  for (const turn of full.turns) {
    if (turn.ground === 'freeze') assert.equal(turn.phases.length, 16)
    else {
      const next = turn.first === 'axis' ? 'soviet' : 'axis'
      assert.deepEqual(turn.phases, ['aircraft-refit', 'reinforcement', 'movement', 'supply', 'cleanup']
        .flatMap((phase) => [`${turn.first}:${phase}`, `${next}:${phase}`]))
    }
  }
  assert.equal(thawEnd.turns.length, 7)
  assert.equal(thawEnd.endTurn, 8)
  assert.equal(thawEnd.groundAtEnd, 'thaw')
  assert.equal(sudden.endTurn, 3)
  assert.equal(sudden.vp, -4)
  assert.deepEqual(sudden.result, { outcome: 'axis', level: 'major' })
  const compact = ({ turns, ...report }) => ({ ...report, turns: turns.map(({ phases, ...turn }) => ({ ...turn, phases: phases.length })) })
  return { full: compact(full), thawEnd: compact(thawEnd), sudden: compact(sudden) }
}

function sampleArtillery(state, map, table, submit, latest) {
  const network = scorpionSupplyNetwork(map, scorpionSupplyPosition(state, map, 'soviet'))
  const enemies = [...new Set(Object.values(state.units).filter((unit) => unit.side === 'axis' && unit.combat).map(({ hex }) => hex))]
  for (const [unitId, unit] of Object.entries(state.units)) {
    if (unit.side !== 'soviet' || unit.reserve || !unit.artillery?.strength) continue
    const { artillery } = unit
    const strength = artillery.strength * (artillery.independentRe ? remainingSteps(unit) / unit.printedRe : 1) *
      (unit.disorganized ? 0.5 : 1)
    if (strength < 1 || !artillery.range) continue
    const { cost } = barrageColumn(table, strength)
    const dumpId = Object.keys(state.dumps).find((id) => id.startsWith('soviet:hex:') && state.dumps[id].tokens >= cost &&
      network.canDrawDump(unit.hex, id.split(':')[2]))
    const target = enemies.find((hex) => scorpionHexDistance(unit.hex, hex) <= artillery.range)
    if (!target || !dumpId) continue
    submit({ type: 'declare-artillery-barrage', target, batteries: [{ unitId }],
      supply: { kind: 'direct', payments: [{ dumpId, tokens: cost }] } })
    submit({ type: 'choose-barrage-terrain', terrain: map.hexes.get(target).terrains[0] }, 'axis')
    const shot = latest().barrageHistory.at(-1)
    if (shot.lossesDue) {
      let remainder = shot.lossesDue
      const allocation = []
      for (const [id, defender] of Object.entries(latest().units)) {
        if (!remainder) break
        if (!defender.combat || defender.side !== 'axis' || defender.hex !== target) continue
        const steps = Math.min(remainder, remainingSteps(defender))
        allocation.push({ unitId: id, steps })
        remainder -= steps
      }
      submit({ type: 'assign-barrage-loss', allocation }, 'axis')
    }
    return { from: unit.hex, target, strength, tokensSpent: cost, result: shot.roll.code, losses: shot.lossesDue }
  }
  throw new Error('No eligible opening artillery barrage for the audit')
}

function sampleDefenderStocks(opening, assets, board) {
  const counters = Object.entries(opening.state.units).filter(([, unit]) => unit.attackCapable && !unit.reserve)
  const [attackerId, attacker] = counters.find(([, unit]) => unit.side === 'soviet' && unit.mobility === 'leg')
  const singles = counters.filter(([, unit]) => unit.side === 'axis' && unit.printedRe === 1).slice(0, 2)
  const division = counters.find(([, unit]) => unit.side === 'axis' && unit.printedRe > 1 && remainingSteps(unit) > 1)
  const from = attacker.hex
  const target = assets.map.neighbors(from).find((hex) => !scorpionAxisSources.includes(hex) &&
    scorpionStepCost(assets.map, from, hex, 'leg', 'freeze') !== null)
  if (!target || singles.length !== 2 || !division) throw new Error('Missing the actual counters for the controlled defensive supply check')
  const defenseDump = `axis:hex:${target}`
  const attackDump = `soviet:hex:${from}`
  const spend = (defenders) => {
    const units = { [attackerId]: attacker, ...Object.fromEntries(defenders.map(([id, unit]) => [id, { ...unit, hex: target }])) }
    const dumps = { [defenseDump]: { side: 'axis', location: 'on-map', tokens: 1 },
      [attackDump]: { side: 'soviet', location: 'on-map', tokens: remainingSteps(attacker) } }
    let record = { ...opening, state: { ...opening.state, units, dumps, cursor: { ...opening.state.cursor, phase: 'combat' } } }
    const issue = (seat, action) => {
      const command = { id: `sample-defense-${record.revision}`, expectedRevision: record.revision, action }
      record = submitScorpionDemo(record, seat, command, assets, board).record
    }
    issue('soviet', { type: 'declare-combat', target, attackers: [attackerId],
      payments: [{ unitId: attackerId, dumpId: attackDump, tokens: remainingSteps(attacker) }] })
    const participants = defenders.map(([id]) => id)
    issue('axis', { type: 'defend-combat', payments: [], internalUnitIds: participants })
    if (participants.some((id) => record.state.units[id].internalStocks !== 'low')) throw new Error('A defender did not spend its own stocks')
    return record.state.dumps[defenseDump].tokens
  }
  const singleStepStockLeft = spend(singles)
  const multiStepStockLeft = spend([division])
  if (singleStepStockLeft !== 1 || multiStepStockLeft !== 0) throw new Error('Incorrect application of 12.10h to the defending stack')
  return { target, singleStepStockLeft, multiStepStockLeft }
}

function sampleBattle(state, map, submit, latest, overrun = false) {
  const sovietSupply = scorpionSupplyNetwork(map, scorpionSupplyPosition(state, map, 'soviet'))
  let chosen
  for (const [unitId, unit] of Object.entries(state.units)) {
    if (unit.side !== 'soviet' || !unit.attackCapable || unit.reserve || unit.mobility !== 'leg') continue
    if (overrun && (unit.allowance < 3 || state.moved.includes(unitId) ||
      Object.values(state.units).filter((other) => other.hex === unit.hex && other.combat)
        .reduce((total, other) => total + other.printedRe - other.stepsLost, 0) > 10)) continue
    const dumpId = Object.keys(state.dumps).find((id) => id.startsWith('soviet:hex:') &&
      state.dumps[id].tokens >= remainingSteps(unit) && sovietSupply.canUseDump(unit.hex, id.split(':')[2]))
    const target = map.neighbors(unit.hex).find((hex) => {
      if (map.edge(unit.hex, hex)?.river || scorpionAxisSources.includes(hex) || !Object.values(state.units).some((enemy) =>
        enemy.side === 'axis' && enemy.combat && enemy.hex === hex)) return false
      if (!overrun) return true
      const cost = scorpionStepCost(map, unit.hex, hex, 'leg', 'freeze', false)
      return typeof cost === 'number' && cost <= 3
    })
    if (dumpId && target) {
      chosen = { unitId, unit, dumpId, target }
      break
    }
  }
  if (!chosen) throw new Error(`No eligible opening ${overrun ? 'overrun' : 'regular combat'} for the audit`)
  const { unitId, unit, dumpId, target } = chosen
  submit({ type: overrun ? 'declare-overrun' : 'declare-combat', target, attackers: [unitId],
    payments: [{ unitId, dumpId, tokens: remainingSteps(unit) }] })
  const movementPointsSpent = overrun ? unit.allowance - latest().overrunMarch.remaining[unitId] : undefined
  submit({ type: 'defend-combat', payments: [] }, 'axis')
  submit({ type: 'select-combat-rating', unitId })
  submit({ type: 'select-combat-rating', unitId: latest().combat.defenders[0] }, 'axis')
  const terrain = map.hexes.get(target).terrains[0]
  submit({ type: 'choose-combat-terrain', terrain, attackingTerrain: { [unit.hex]: terrain } }, 'axis')
  const rolled = latest().combat.roll
  const losses = { soviet: 0, axis: 0 }
  for (const [seat, side] of [['soviet', 'attacker'], ['axis', 'defender']]) {
    const battle = latest().combat
    const slots = side === 'attacker' ? battle.attackers : battle.defenders
    const leader = side === 'attacker' ? battle.attackerLeader : battle.defenderLeader
    const ordered = [leader, ...slots.filter((id) => id !== leader)]
    const counts = new Map(ordered.map((id) => [id, remainingSteps(latest().units[id])]))
    const hard = Math.min(rolled[side].loss, [...counts.values()].reduce((sum, count) => sum + count, 0))
    const lossOrder = []
    while (lossOrder.length < hard + rolled[side].option && [...counts.values()].some((count) => count)) {
      for (const id of ordered) {
        if (lossOrder.length === hard + rolled[side].option) break
        if (counts.get(id) > 0) { lossOrder.push(id); counts.set(id, counts.get(id) - 1) }
      }
    }
    submit({ type: 'resolve-combat', lossOrder, optionLosses: lossOrder.length - hard, retreats: [] }, seat)
    losses[seat] = lossOrder.length
  }
  if (latest().combat?.step === 'advance') submit({ type: 'advance-after-combat', unitIds: [] })
  return { from: unit.hex, target, result: rolled.code, losses, movementPointsSpent,
    finalHex: overrun ? latest().units[unitId]?.hex ?? null : undefined }
}
const railGauge = scorpionInitialRailGauge(map)
const axisSources = new Set(scorpionAxisSources)
const empty = new Set()
const axisTrace = { side: 'axis', sources: axisSources, controlled: empty, enemyCombat: empty,
  unnegatedEnemyZoc: empty, railGauge, detrainableFacilities: empty, headquarters: [], weather: 'freeze' }
const unusableAxisSources = scorpionAxisSources.filter((hex) =>
  !scorpionTraceOptions(map, axisTrace, hex).some(({ source }) => source === hex),
)
const sovietTrace = { ...axisTrace, side: 'soviet', sources: new Set(scorpionSovietSources) }
const unusableSovietSources = scorpionSovietSources.filter((hex) =>
  !scorpionTraceOptions(map, sovietTrace, hex).some(({ source }) => source === hex),
)
const dropCapable = [...definitions.values()].filter(mayPlanTtwCombatAirDrop)
  .map(({ sourceId, source }) => ({ id: sourceId, name: source.name }))
if (dropCapable.length !== 1) throw new Error('The TTW catalog must resolve its one designated drop-capable brigade')
const report = {
  definitions: definitions.size,
  dropCapableCombatUnits: dropCapable,
  legacyIdCollisions: [...rawIds].filter(([, rows]) => rows.length > 1).map(([id, rows]) => ({
    id, matches: rows.map(({ kind, source }) => ({ kind, name: source.name })),
  })),
  missingLegacyIds: [...definitions.values()].filter((entry) => entry.sourceId === null).length,
  scorpion: {
    sourceHexes: map.hexes.size,
    sourceEdges: map.edgeCount,
    setupRefs: references(setup).length,
    reinforcementRefs: references(reinforcement).length,
    playableArrivals: playableArrivals.length,
    fixedSupplyDeliveries: scorpionFixedSupply.length,
    groundCounters: Object.keys(deployment.units).length,
    printedStepLossChoices: deployment.lossChoices.length,
    fullOrganicTrucks: Object.values(deployment.units).filter((unit) => unit.organicTruck === 'full').length,
    unknownSetupMovement,
    unknownArrivalMovement,
    unknownArtilleryFaces: [...new Set([...Object.values(deployment.units).map((unit) => unit.definition),
      ...playableArrivals.map((entry) => entry.definition)])]
      .map((id) => definitions.get(id)).filter((definition) => definition && scorpionArtillery(definition, 'combat'))
      .filter((definition) => {
        const face = scorpionArtillery(definition, 'move')
        return face.strength === undefined || face.range === undefined
      }).map(({ source }) => source.name),
    unresolved,
    missingSetupHexes,
    missingArrivalHexes,
    unusableAxisSources,
    sovietSupplyEntrances: scorpionSovietSources.length,
    unusableSovietSources,
    opening,
  },
  campaign: hexes ? {
    sourceHexes: hexes.items.length,
    sourceEdges: edges.items.length,
    openEndedEdges: edges.items.filter((edge) => edge.hex_a === null || edge.hex_b === null).length,
    danglingEdges: danglingEdges.map(({ edge_key }) => edge_key),
    mismatchedHexTwins: seamIssues.map(({ hex_id }) => hex_id),
    seamTransportDisagreements: [...edgeGroups].filter(([, values]) => values.size > 1).map(([id]) => id),
  } : { skipped: true, reason: '--scorpion-only: campaign 地图数据库/map_hexes.json and map_edges.json not read' },
}
console.log(JSON.stringify(report, null, 2))
if (unresolved.length || danglingEdges.length || seamIssues.length || unusableAxisSources.length || unusableSovietSources.length ||
    unknownSetupMovement.length || unknownArrivalMovement.length ||
    missingSetupHexes.length || missingArrivalHexes.length) process.exitCode = 1
