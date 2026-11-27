import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalScorpion } from '../desktop/local/data.mjs'
import { deployScorpionGroundCounter } from '../src/import/scorpion-deployment.ts'
import { scorpionGroundProfile } from '../src/import/ground-profile.ts'
import { prepareScorpionOpening } from '../src/match/scorpion-setup.ts'
import { scorpionAirstripPool } from '../src/match/scorpion-airfield-work.ts'
import { scorpionTransportStock } from '../src/match/scorpion-transport-points.ts'
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
// Projection needs the printed name and counter face of every referenced definition, and the marker
// faces drawn on the map. Exporting the slice keeps GDScript away from the raw catalog format.
const definitionIds = new Set([...Object.values(opening.units).map((unit) => unit.definition),
  ...opening.pieces.map((piece) => piece.definition), ...opening.pool.map(({ definition }) => definition),
  // Kessel slots and remnants are drawn from the card even when no counter is on the map.
  'hq:id:4150', 'hq:id:4151', 'land:id:3999', 'land:id:4499'])
const definitions = Object.fromEntries([...definitionIds].map((id) => {
  const definition = catalog.definitions.get(id)
  if (!definition) throw new Error(`Missing catalog definition ${id}`)
  const source = definition.source
  const profile = scorpionGroundProfile(definition, 'combat')
  return [id, { name: source.name, side: source.side, kind: definition.kind, re: source.re,
    abilities: source.abilities ?? [],
    transport: typeof source.faces.combat?.stats?.transport === 'number' ? source.faces.combat.stats.transport : null,
    // Printed combat-face profile, so transport stock buckets by printed values rather than unit fields.
    moveProfile: profile ? { mobility: profile.mobility, allowance: profile.allowance } : null,
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
// Printed reinforcement catalog: the native board resolves entry hexes without any oracle call.
// Only the catalog is read here, so a first-turn cursor is enough to open the board.
const arrivalCatalog = data.board.reinforcements({
  kind: 'playing', units: opening.units, pieces: opening.pieces, dumps: opening.dumps, airBases: [],
  cursor: { turn: 1, first: 'soviet', phasing: 'soviet', phase: 'aircraft-refit', retention: 'soviet' },
}).catalog
  .map(({ id, side, turn, destinations, definition, face, stepsLost, organicTruck, optionalForce }) =>
    ({ id, side, turn, destinations, definition, face, stepsLost, organicTruck, optionalForce }))
const view = {
  catalog: { definitions, markers },
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
