import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { campaignHexKey, scorpionHexId, scorpionPrintedHex } from '../src/import/hex-id.ts'
import { scorpionGroundProfile } from '../src/import/ground-profile.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { scorpionGroundDeployment } from '../src/import/scorpion-deployment.ts'
import { loadScorpionMap } from '../src/import/scorpion-map-files.ts'
import { loadScorpionUnits } from '../src/import/scorpion-unit-sources.ts'
import { scorpionArrivalCatalog } from '../src/import/scorpion-arrivals.ts'
import { scorpionFixedSupply } from '../src/ttw/scorpion/fixed-supply.ts'
import { scorpionAxisSources, scorpionInitialRailGauge, scorpionSovietSources } from '../src/ttw/scorpion/initial-map.ts'
import { scorpionSupplyNetwork, scorpionTraceOptions } from '../src/ttw/scorpion/supply-trace.ts'
import { scorpionSupplyPosition } from '../src/match/scorpion-supply-position.ts'
import { remainingSteps } from '../src/match/scorpion-losses.ts'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'

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
  let record = started
  // First-turn source entries printed in Scorpion p.55. The general front-line control module is separate.
  const reinforcements = () => ({ catalog: playableArrivals,
    supplySources: { axis: new Set(scorpionAxisSources), soviet: new Set(scorpionSovietSources) },
    controlOf: (id) => id === 's22.02' ? 'soviet' : null, arrivalDestinations: (entry) => entry.destinations,
    alertDestinations: () => [] })
  const tablePath = process.env.OCS_V43_CRT
  const combat = tablePath ? { table: await readAt(dirname(resolve(tablePath)), basename(tablePath)) } : undefined
  function submit(action, seat = record.state.cursor.phasing) {
    const command = { id: `start-${record.revision}`, expectedRevision: record.revision, action }
    record = submitScorpionSession(record, seat, command, assets, { reinforcements, combat }).record
  }
  submit({ type: 'complete-refit' })
  for (const { id, destinations } of playableArrivals.filter(({ side, turn }) => side === 'soviet' && turn === 1)) {
    submit({ type: 'place-arrival', arrivalId: id, hex: destinations[0] })
  }
  submit({ type: 'place-supply', target: { kind: 'hex', id: 's22.02' }, tokens: 8 })
  submit({ type: 'finish-scheduled-arrivals' })
  submit({ type: 'complete-reinforcement' })
  // A Soviet leg unit makes this single move in its own opening area. It is unaffected by the truck ZOC rule.
  const [unitId] = Object.entries(record.state.units).find(([, unit]) =>
    definitions.get(unit.definition)?.source.name === 'Sov 58 Rifle Div')
  submit({ type: 'ground-move', unitId, path: ['s1.12'] })
  opening = {
    startPhase: started.state.cursor.phase,
    startGroundCounters: Object.keys(started.state.units).length,
    airUnitsPlaced: started.state.pieces.filter((piece) => piece.kind === 'aircraft' && piece.location.kind !== 'air-setup').length,
    setupAlerts: before.state.opening.drawnAlerts.length,
    reserveAlerts: started.state.availableAlerts.length,
    startSupplyTokens: Object.values(started.state.dumps).reduce((sum, dump) => sum + dump.tokens, 0),
    followingPhase: record.state.cursor.phase,
    followingGroundCounters: Object.keys(record.state.units).length,
    firstMoveDestination: record.state.units[unitId].hex,
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
  if (combat) opening.sampleBattle = sampleBattle(record.state, map, submit, () => record.state)
  submit({ type: 'complete-combat' })
  submit({ type: 'complete-exploitation' })
  submit({ type: 'complete-cleanup' })
  submit({ type: 'complete-refit' })
  submit({ type: 'finish-scheduled-arrivals' })
  submit({ type: 'complete-reinforcement' })
  opening.axisAttritionChecks = finishSupply()
  submit({ type: 'complete-reaction' }, 'soviet')
  submit({ type: 'complete-combat' })
  submit({ type: 'complete-exploitation' })
  submit({ type: 'complete-cleanup' })
  submit({ type: 'retain-initiative', dumpId: 'soviet:hex:s1.14' }, 'soviet')
  submit({ type: 'choose-first', first: 'soviet' }, 'soviet')
  opening.nextTurn = record.state.turn.number
  opening.nextPhase = record.state.cursor.phase
}

function sampleBattle(state, map, submit, latest) {
  const sovietSupply = scorpionSupplyNetwork(map, scorpionSupplyPosition(state, map, 'soviet'))
  let chosen
  for (const [unitId, unit] of Object.entries(state.units)) {
    if (unit.side !== 'soviet' || !unit.attackCapable || unit.mobility !== 'leg') continue
    const dumpId = Object.keys(state.dumps).find((id) => id.startsWith('soviet:hex:') &&
      state.dumps[id].tokens >= remainingSteps(unit) && sovietSupply.canUseDump(unit.hex, id.split(':')[2]))
    const target = map.neighbors(unit.hex).find((hex) => !map.edge(unit.hex, hex)?.river &&
      !scorpionAxisSources.includes(hex) && Object.values(state.units).some((enemy) =>
        enemy.side === 'axis' && enemy.combat && enemy.hex === hex))
    if (dumpId && target) {
      chosen = { unitId, unit, dumpId, target }
      break
    }
  }
  if (!chosen) throw new Error('No eligible opening regular combat for the audit')
  const { unitId, unit, dumpId, target } = chosen
  submit({ type: 'declare-combat', target, attackers: [unitId], payments: [{ unitId, dumpId, tokens: remainingSteps(unit) }] })
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
  return { from: unit.hex, target, result: rolled.code }
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
