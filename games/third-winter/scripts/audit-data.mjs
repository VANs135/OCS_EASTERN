import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { barrageColumn } from '@ocs-eastern/series/tables/barrage'
import { campaignHexKey, scorpionHexDistance, scorpionHexId, scorpionPrintedHex } from '../src/import/hex-id.ts'
import { scorpionArtillery } from '../src/import/scorpion-artillery.ts'
import { scorpionGroundProfile } from '../src/import/ground-profile.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionGroundDeployment } from '../src/import/scorpion-deployment.ts'
import { loadScorpionMap } from '../src/import/scorpion-map-files.ts'
import { loadScorpionUnits } from '../src/import/scorpion-unit-sources.ts'
import { scorpionArrivalCatalog } from '../src/import/scorpion-arrivals.ts'
import { scorpionFixedSupply } from '../src/ttw/scorpion/fixed-supply.ts'
import { scorpionAxisSources, scorpionInitialRailGauge, scorpionSovietSources } from '../src/ttw/scorpion/initial-map.ts'
import { scorpionSupplyNetwork, scorpionTraceOptions } from '../src/ttw/scorpion/supply-trace.ts'
import { scorpionEnemyZoc, scorpionSupplyPosition } from '../src/match/scorpion-supply-position.ts'
import { scorpionStepCost } from '../src/ttw/scorpion/terrain-cost.ts'
import { remainingSteps } from '../src/match/scorpion-losses.ts'
import { sampleScorpionAirBarrage, sampleScorpionAirOperations, sampleScorpionSupplyAirlift, sampleScorpionTrainbusting } from './scorpion-air-example.mjs'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'
import { sampleScorpionRefit } from './scorpion-refit-example.mjs'
import { sampleScorpionFrontBarrage } from './scorpion-front-barrage-example.mjs'

const root = process.argv[2]
if (!root) throw new Error('Usage: npm run audit:data --workspace=@ocs-eastern/third-winter -- <TTW directory> [unit backup directory]')
const unitRoot = process.argv[3] ?? join(dirname(resolve(root)), 'DATA备份')
const readAt = async (folder, ...path) => JSON.parse((await readFile(join(folder, ...path), 'utf8')).replace(/^\uFEFF/, ''))
const read = (...path) => readAt(root, ...path)
const scenarioPath = ['data', 'scenarios', '08-scorpion']
const [{ definitions, aliases, rawIds }, setup, reinforcement, map, hexes, edges] = await Promise.all([
  loadScorpionUnits((file) => readAt(unitRoot, file)),
  read(...scenarioPath, 'setup.json'),
  read(...scenarioPath, 'reinforcements.json'),
  loadScorpionMap(read),
  read('地图数据库', 'map_hexes.json'),
  read('地图数据库', 'map_edges.json'),
])
const byHex = new Map(hexes.items.map((hex) => [campaignHexKey(hex.hex_id), hex]))
if (byHex.size !== hexes.items.length) throw new Error('Campaign source hex ID collision')
const seamIssues = hexes.items.filter((hex) => {
  if (!hex.seam_twin) return false
  const peer = byHex.get(campaignHexKey(hex.seam_twin))
  return peer?.seam_twin !== hex.hex_id || peer.seam_primary === hex.seam_primary
})
const danglingEdges = edges.items.filter((edge) =>
  [edge.hex_a, edge.hex_b].some((id) => id !== null && !byHex.has(campaignHexKey(id))),
)
const edgeGroups = new Map()
for (const edge of edges.items) {
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
  // First-turn source entries printed in Scorpion p.55. The general front-line control module is separate.
  const reinforcements = () => ({ catalog: playableArrivals,
    supplySources: { axis: new Set(scorpionAxisSources), soviet: new Set(scorpionSovietSources) },
    controlOf: (id) => id === 's22.02' ? 'soviet' : null, arrivalDestinations: (entry) => entry.destinations,
    alertDestinations: () => [] })
  const tablePath = process.env.OCS_V43_CRT
  const combat = tablePath ? { table: await readAt(dirname(resolve(tablePath)), basename(tablePath)) } : undefined
  const barragePath = process.env.OCS_V43_BARRAGE
  const barrage = barragePath ? await readAt(dirname(resolve(barragePath)), basename(barragePath)) : undefined
  const facilityPath = process.env.OCS_V43_FACILITY
  const facilityBarrage = facilityPath ? await readAt(dirname(resolve(facilityPath)), basename(facilityPath)) : undefined
  const board = { reinforcements, combat, barrage, facilityBarrage }
  function submit(action, seat = record.state.cursor.phasing) {
    const command = { id: `start-${record.revision}`, expectedRevision: record.revision, action }
    record = submitScorpionSession(record, seat, command, assets, board).record
  }
  submit({ type: 'complete-refit' })
  for (const { id, destinations } of playableArrivals.filter(({ side, turn }) => side === 'soviet' && turn === 1)) {
    submit({ type: 'place-arrival', arrivalId: id, hex: destinations[0] })
  }
  submit({ type: 'place-supply', target: { kind: 'hex', id: 's22.02' }, tokens: 8 })
  submit({ type: 'finish-scheduled-arrivals' })
  submit({ type: 'complete-reinforcement' })
  const air = sampleScorpionAirOperations(record, assets, board)
  const [unitId] = Object.entries(record.state.units).find(([, unit]) =>
    definitions.get(unit.definition)?.source.name === 'Sov 58 Rifle Div')
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
    reserveMove: { from: reserveMove.from, to: reserveMove.to, counters: reserveMove.unitIds.length },
  }
  if (combat) {
    const beforeOverrun = record
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
  if (record.state.turn.weather.flight === 'none') {
    opening.sampleAirlift = { flight: 'none' }
  } else {
    const lift = sampleScorpionSupplyAirlift(record, assets, board)
    opening.sampleAirlift = { target: lift.event.target.hex, loaded: lift.event.airlift.tokens, ...lift.event.airlift.unloading }
  }
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
  }
  if (latest().combat?.step === 'advance') submit({ type: 'advance-after-combat', unitIds: [] })
  return { from: unit.hex, target, result: rolled.code, movementPointsSpent,
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
const report = {
  definitions: definitions.size,
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
  campaign: {
    sourceHexes: hexes.items.length,
    sourceEdges: edges.items.length,
    openEndedEdges: edges.items.filter((edge) => edge.hex_a === null || edge.hex_b === null).length,
    danglingEdges: danglingEdges.map(({ edge_key }) => edge_key),
    mismatchedHexTwins: seamIssues.map(({ hex_id }) => hex_id),
    seamTransportDisagreements: [...edgeGroups].filter(([, values]) => values.size > 1).map(([id]) => id),
  },
}
console.log(JSON.stringify(report, null, 2))
if (unresolved.length || danglingEdges.length || seamIssues.length || unusableAxisSources.length || unusableSovietSources.length ||
    unknownSetupMovement.length || unknownArrivalMovement.length ||
    missingSetupHexes.length || missingArrivalHexes.length) process.exitCode = 1
