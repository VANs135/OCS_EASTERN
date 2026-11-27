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
const manifest = { version: 1, workId: 'third-winter', scenarioId: '08-korsun-pocket',
  rulesVersion: '4.3', fingerprint: data.fingerprint, hexIds, opening, deployment }
await mkdir(dirname(resolve(output)), { recursive: true })
await writeFile(resolve(output), JSON.stringify(manifest) + '\n')
console.log(`已生成 08 初设数据 · ${hexIds.length} 格 · ${Object.keys(opening.units).length} 枚地面算子 · ${resolve(output)}`)
