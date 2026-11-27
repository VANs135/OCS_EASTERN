import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalScorpion } from '../desktop/local/data.mjs'
import { deployScorpionGroundCounter } from '../src/import/scorpion-deployment.ts'
import { prepareScorpionOpening } from '../src/match/scorpion-setup.ts'
import { scorpionControlSites, scorpionOpeningFrontControl } from '../src/ttw/scorpion/initial-map.ts'
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
  ...opening.pieces.map((piece) => piece.definition), ...opening.pool.map(({ definition }) => definition)])
const definitions = Object.fromEntries([...definitionIds].map((id) => {
  const definition = catalog.definitions.get(id)
  if (!definition) throw new Error(`Missing catalog definition ${id}`)
  const source = definition.source
  return [id, { name: source.name, side: source.side, kind: definition.kind, re: source.re,
    faces: { combat: source.faces.combat?.asset ?? null, move: source.faces.move?.asset ?? null } }]
}))
const markerRefs = [...['Airbase Strength 1', 'Airbase Strength 2', 'Airbase Strength 3'],
  ...[1, 2, 3, 4, 5].map((points) => `Supply Point ${points}`),
  ...[1, 2, 3, 4, 5].map((tons) => `Supply Ton ${tons}T`),
  ...[1, 2, 3].map((steps) => `Step Loss ${steps}`),
  'DG (Disorganized)', 'Axis Reserve', 'Sov Reserve', 'Out of Supply', 'Low/Exhausted', 'Exhausted',
  '1T Organic c.png', '2T Organic c.png', '3T Organic c.png', 'F Organic c.png', 'misc_fueled.png', 'misc_fueled-Sv.png']
const markers = Object.fromEntries(markerRefs.flatMap((ref) => {
  const matches = catalog.aliases.get(ref)
  const asset = matches?.length === 1 ? matches[0].source.faces.combat?.asset : undefined
  // 4T never appears: four tons print as one SP counter. Only export refs that have artwork.
  return asset ? [[ref, asset]] : []
}))
for (const ref of ['Airbase Strength 1', 'Airbase Strength 2', 'Airbase Strength 3']) {
  if (!markers[ref]) throw new Error(`Missing marker artwork ${ref}`)
}
const basename = (path) => path.split(/[\\/]/).at(-1)
const view = {
  catalog: { definitions, markers },
  model: { ...data.model, map: basename(data.model.map),
    aid: { ...data.model.aid, asset: basename(data.model.aid.asset) },
    cards: data.model.cards.map(({ path, ...card }) => ({ ...card, asset: basename(card.asset) })) },
}
const manifest = { version: 1, workId: 'third-winter', scenarioId: '08-korsun-pocket',
  rulesVersion: '4.3', fingerprint: data.fingerprint, hexIds, opening, deployment, view }
await mkdir(dirname(resolve(output)), { recursive: true })
await writeFile(resolve(output), JSON.stringify(manifest) + '\n')
console.log(`已生成 08 初设数据 · ${hexIds.length} 格 · ${Object.keys(opening.units).length} 枚地面算子 · ${resolve(output)}`)
