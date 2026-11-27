import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalScorpion } from '../desktop/local/data.mjs'
import { scorpionInitialRailGauge } from '../src/ttw/scorpion/initial-map.ts'
import { scorpionSupplyNetwork } from '../src/ttw/scorpion/supply-trace.ts'
import { scorpionSupplyPosition } from '../src/match/scorpion-supply-position.ts'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'

// Oracle fixture for the native supply trace: per side and mobility, every hex's options
// plus the covered set after prepareTraceCoverage.
const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))
const [root, output = join(dist, 'godot', '08-trace.json'), tables = dist] = process.argv.slice(2)
if (!root) throw new Error('请提供第三冬资料库目录，可另传输出路径和图表目录')

const seed = 19440126
const data = await loadLocalScorpion(resolve(root), resolve(tables))
const opening = sampleScorpionOpening(data.setup, data.assets, seed)
const state = JSON.parse(JSON.stringify(opening.started.state))
const map = data.assets.map
const railGauge = scorpionInitialRailGauge(map)
const mobilities = ['truck', 'leg']
const hexes = [...map.hexes.keys()].sort()

const sides = {}
for (const side of ['axis', 'soviet']) {
  const facts = scorpionSupplyPosition(state, map, side)
  const network = scorpionSupplyNetwork(map, { ...facts, railGauge, weather: facts.weather })
  const trace = {}
  const covered = {}
  for (const mobility of mobilities) {
    trace[mobility] = Object.fromEntries(hexes.map((hex) => [hex, network.trace(hex, mobility)]))
    network.prepareTraceCoverage(mobility)
    covered[mobility] = hexes.filter((hex) => network.hasTrace(hex, mobility))
  }
  sides[side] = { weather: facts.weather, trace, covered }
}

const fixture = {
  version: 1, scenarioId: '08-korsun-pocket', seed, fingerprint: data.fingerprint, revision: 0,
  mobilities, hexes, sides,
}
await mkdir(dirname(resolve(output)), { recursive: true })
await writeFile(resolve(output), JSON.stringify(fixture) + '\n')
console.log(`已导出 08 补给 trace 对照 · 轴心覆盖 ${sides.axis.covered.truck.length} 格 · 苏军覆盖 ${sides.soviet.covered.truck.length} 格 · ${resolve(output)}`)
