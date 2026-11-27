import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalScorpion } from '../desktop/local/data.mjs'
import { deployScorpionGroundCounter } from '../src/import/scorpion-deployment.ts'
import { scorpionModeFace } from '../src/import/scorpion-mode-face.ts'
import { scorpionGroundProfile } from '../src/import/ground-profile.ts'
import { scorpionArtillery } from '../src/import/scorpion-artillery.ts'
import { prepareScorpionOpening } from '../src/match/scorpion-setup.ts'
import { scorpionAirstripPool } from '../src/match/scorpion-airfield-work.ts'
import { scorpionTransportStock, transportPoints } from '../src/match/scorpion-transport-points.ts'
import { scorpionFixedSupply } from '../src/ttw/scorpion/fixed-supply.ts'
import { scorpionFirstTurn } from '../src/match/scorpion-session.ts'
import { scorpionDates } from '../src/ttw/scorpion/weather.ts'
import { scorpionControlSites, scorpionOpeningFrontControl,
  scorpionInitialRailGauge, scorpionSupplySources } from '../src/ttw/scorpion/initial-map.ts'
import { scorpionOpeningAirBases } from '../src/ttw/scorpion/setup-stores.ts'

const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))
const [root, output = join(dist, 'godot', '08-opening-data.json'), tables = dist] = process.argv.slice(2)
if (!root) throw new Error('请提供第三冬资料库目录，可另传输出路径和图表目录')

const data = await loadLocalScorpion(resolve(root), resolve(tables))
const opening = prepareScorpionOpening(data.setup, data.assets)
const { catalog, map } = data.assets
const hexIds = [...map.hexes.keys()]
const alertProfiles = Object.fromEntries([...new Set(opening.pool.map(({ definition }) => definition))].map((key) => {
  const { hex, ...profile } = deployScorpionGroundCounter(catalog.definitions.get(key), hexIds[0], 0)
  return [key, profile]
}))
const deployment = { airBases: scorpionOpeningAirBases, alertProfiles,
  controlSites: [...scorpionControlSites(map)], frontControl: scorpionOpeningFrontControl(map) }
// Printed reinforcement catalog and the counter template each entry deploys. The template is the
// exact `deployScorpionGroundCounter` output with the hex stripped, so the native session clones a
// counter instead of re-deriving ground profiles. Only the catalog is read, so a first-turn cursor
// is enough to open the board.
const arrivalCatalogSource = data.board.reinforcements({
  kind: 'playing', units: opening.units, pieces: opening.pieces, dumps: opening.dumps, airBases: [],
  cursor: { turn: 1, first: 'soviet', phasing: 'soviet', phase: 'aircraft-refit', retention: 'soviet' },
}).catalog
// Every definition referenced by an on-board unit, a dead-pile piece, the opening Alert pool or the
// reinforcement catalog. Aircraft, markers and formation headings have no ground counter profile.
const referencedIds = [...new Set([
  ...arrivalCatalogSource.map(({ definition }) => definition),
  ...opening.pool.map(({ definition }) => definition),
  ...Object.values(opening.units).map((unit) => unit.definition),
  ...opening.pieces.map((piece) => piece.definition),
])]
const deployableDefinition = (id) => {
  const definition = catalog.definitions.get(id)
  return definition && ['land', 'hq', 'transport'].includes(definition.kind) ? definition : undefined
}
const counterIds = referencedIds.filter((id) => deployableDefinition(id))
// Remnant battalions deploy on demand when an Axis division is eliminated; ship their deployed
// templates (combat + move face) so the native side clones a counter instead of re-deriving profiles.
for (const remnantId of ['land:id:3999', 'land:id:4499']) {
  if (deployableDefinition(remnantId) && !counterIds.includes(remnantId)) counterIds.push(remnantId)
}
// Counter template each entry clones: the exact deployScorpionGroundCounter output with the hex
// stripped, so the native session never re-derives ground profiles by hand.
const counters = Object.fromEntries(counterIds.map((id) => {
  const { hex, ...counter } = deployScorpionGroundCounter(deployableDefinition(id), hexIds[0], 0)
  return [id, counter]
}))
// Per-face templates: the combat face is the deployed counter; the move face is the same counter
// projected onto its back side through scorpionModeFace. A counter with no printed move face keeps
// `move: null` instead of a fabricated profile.
const faces = Object.fromEntries(counterIds.map((id) => {
  const definition = deployableDefinition(id)
  const { hex, ...combat } = deployScorpionGroundCounter(definition, hexIds[0], 0)
  let move = null
  try { move = scorpionModeFace(combat, definition, 'move') } catch { move = null }
  return [id, { combat, move }]
}))
// Projection needs the printed name and counter face of every referenced definition, and the marker
// faces drawn on the map. Exporting the slice keeps GDScript away from the raw catalog format.
const definitionIds = new Set([...referencedIds,
  // Kessel slots and remnants are drawn from the card even when no counter is on the map.
  'hq:id:4150', 'hq:id:4151', 'land:id:3999', 'land:id:4499'])
const definitions = Object.fromEntries([...definitionIds].map((id) => {
  const definition = catalog.definitions.get(id)
  if (!definition) throw new Error(`Missing catalog definition ${id}`)
  const source = definition.source
  const combatProfile = scorpionGroundProfile(definition, 'combat')
  const moveProfile = scorpionGroundProfile(definition, 'move')
  const artillery = scorpionArtillery(definition, 'combat')
  const artilleryMove = scorpionArtillery(definition, 'move')
  return [id, { name: source.name, side: source.side, kind: definition.kind, re: source.re,
    abilities: source.abilities ?? [],
    transport: typeof source.faces.combat?.stats?.transport === 'number' ? source.faces.combat.stats.transport : null,
    // Legacy printed combat-face profile; transport stock buckets by these printed values.
    moveProfile: combatProfile ? { mobility: combatProfile.mobility, allowance: combatProfile.allowance } : null,
    // Move-face ground profile, null when the counter has no printed back side.
    moveFaceProfile: moveProfile ? { mobility: moveProfile.mobility, allowance: moveProfile.allowance } : null,
    artillery: artillery ?? null,
    artilleryMove: artilleryMove ?? null,
    category: source.category ?? null,
    railOnly: source.railOnly ?? null,
    mustBeCity: source.mustBeCity ?? null,
    hqKind: source.hqKind ?? null,
    // Printed aircraft ranges: the combat face is the normal range, the move face the reduced one.
    range: typeof source.faces.combat?.stats?.range === 'number' ? source.faces.combat.stats.range : null,
    rangeMove: typeof source.faces.move?.stats?.range === 'number' ? source.faces.move.stats.range : null,
    faces: {
      combat: source.faces.combat?.asset ?? null, move: source.faces.move?.asset ?? null } }]
}))
const markerRefs = [...['Airbase Strength 1', 'Airbase Strength 2', 'Airbase Strength 3'],
  ...[1, 2, 3, 4, 5].map((points) => `Supply Point ${points}`),
  ...[1, 2, 3, 4, 5].map((tons) => `Supply Ton ${tons}T`),
  ...[1, 2, 3].map((steps) => `Step Loss ${steps}`),
  'DG (Disorganized)', 'Axis Reserve', 'Sov Reserve', 'Out of Supply', 'Low/Exhausted', 'Exhausted',
  '1T Organic c.png', '2T Organic c.png', '3T Organic c.png', 'F Organic c.png', 'misc_fueled.png', 'misc_fueled-Sv.png',
  'Turn', 'Ground', 'Flight', 'Soviet VPs Tracker', '1st Ukr Arty Ready', '2nd Ukr Arty Ready',
  'Year', 'Month', 'Player Turn', 'Axis Reserves Tracker', 'Soviet Reserves Tracker',
  'German Pax Tracker', 'Soviet Pax Tracker',
  ...[1, 2, 3, 4, 5, 6].map((slot) => `Air Strip ${slot}`)]
const markers = Object.fromEntries(markerRefs.flatMap((ref) => {
  const matches = catalog.aliases.get(ref)
  if (matches?.length !== 1) return []
  const faces = matches[0].source.faces
  // 4T never appears: four tons print as one SP counter. Only export refs that have artwork.
  if (!faces.combat?.asset && !faces.move?.asset) return []
  return [[ref, { combat: faces.combat?.asset ?? null, move: faces.move?.asset ?? null }]]
}))
for (const ref of ['Airbase Strength 1', 'Airbase Strength 2', 'Airbase Strength 3']) {
  if (!markers[ref]?.combat) throw new Error(`Missing marker artwork ${ref}`)
}
const basename = (path) => path.split(/[\\/]/).at(-1)
const firstTurn = scorpionFirstTurn()
const airstrips = [...scorpionAirstripPool({ airBases: [] }, catalog)].map(({ key, source }) => ({
  definition: key, asset: source.faces.combat?.asset ?? null }))
// Printed transport denominations for both sides; the project keeps inUse at zero, the view counts it.
const transportRows = [...scorpionTransportStock({}, 'axis', data.assets), ...scorpionTransportStock({}, 'soviet', data.assets)]
  .map(({ side, mobility, allowance, points, limit }) => ({ side, mobility, allowance, points, limit }))
const breakdownRows = data.assets.breakdowns
  ? [...data.assets.breakdowns.counters].map(([definition, { pool, copies }]) => ({
    definition, side: catalog.definitions.get(definition)?.source.side ?? null, pool, copies }))
  : []
// Undirected topology for the native supply layer: adjacency, printed edges, cities and rail gauges.
// Keys are normalised so GDScript needs no direction bookkeeping.
const edgeKeyOf = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)
const gauge = scorpionInitialRailGauge(map)
const mapGraph = { neighbors: {}, cities: {}, terrains: {}, edges: {}, railGauge: {} }
for (const hex of map.hexes.keys()) {
  mapGraph.neighbors[hex] = [...map.neighbors(hex)]
  mapGraph.terrains[hex] = [...map.hexes.get(hex).terrains]
  const city = map.hexes.get(hex).city
  if (city) mapGraph.cities[hex] = city
  for (const near of map.neighbors(hex)) {
    const edge = map.edge(hex, near)
    if (!edge) continue
    mapGraph.edges[edgeKeyOf(hex, near)] = edge
    if (edge.rail) mapGraph.railGauge[edgeKeyOf(hex, near)] = gauge(hex, near)
  }
}
// The catalog is the printed record; `counters` holds the deployed template each entry clones.
const arrivalCatalog = arrivalCatalogSource.map(({ id, side, turn, destinations, definition, face,
  stepsLost, organicTruck, optionalForce }) =>
  ({ id, side, turn, destinations, definition, face, stepsLost, organicTruck, optionalForce }))
// Captured transports deploy one-point counters of the captor's nation. The TS engine resolves
// them through the catalog alias ("Ge Truck" / "Sov Wagon"), so ship the same alias lookup and the
// deployed template the native side clones.
const capturedTransports = Object.fromEntries(
  ['Ge Truck', 'Ge Wagon', 'Sov Truck', 'Sov Wagon'].flatMap((ref) => {
    const match = catalog.aliases.get(ref)?.[0]
    if (!match || match.kind !== 'transport' || !transportPoints(match)) return []
    const { hex, ...body } = deployScorpionGroundCounter(match, hexIds[0], 0)
    return [[ref, body]]
  }))
const view = {
  catalog: { definitions, markers, counters, faces, capturedTransports },
  dates: [...scorpionDates],
  firstTurn: { number: firstTurn.number, date: scorpionDates[firstTurn.number - 1],
    ground: firstTurn.weather.ground, flight: firstTurn.weather.flight, vp: firstTurn.vp },
  airstrips, transportRows, breakdownRows, arrivals: arrivalCatalog,
  fixedSupply: scorpionFixedSupply.map(({ side, turn, sp, destinations }) => ({ side, turn, sp, destinations })),
  mapGraph,
  supplySources: { axis: [...scorpionSupplySources.axis], soviet: [...scorpionSupplySources.soviet] },
  model: { ...data.model, map: basename(data.model.map),
    aid: { ...data.model.aid, asset: basename(data.model.aid.asset) },
    cards: data.model.cards.map(({ path, ...card }) => ({ ...card, asset: basename(card.asset) })) },
}
const manifest = { version: 1, workId: 'third-winter', scenarioId: '08-korsun-pocket',
  rulesVersion: '4.3', fingerprint: data.fingerprint, hexIds, opening, deployment, view }
await mkdir(dirname(resolve(output)), { recursive: true })
await writeFile(resolve(output), JSON.stringify(manifest) + '\n')
console.log(`已生成 08 初设数据 · ${hexIds.length} 格 · ${Object.keys(opening.units).length} 枚地面算子 · ${resolve(output)}`)
