import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalScorpion } from '../desktop/local/data.mjs'
import { scorpionStepCost, scorpionTraceStepCost } from '../src/ttw/scorpion/terrain-cost.ts'

// Oracle fixture for the native hexside costs: every printed edge, both directions,
// all three mobilities, in freeze and thaw. The trace algorithm itself stays in TypeScript.
const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))
const [root, output = join(dist, 'godot', '08-terrain.json'), tables = dist] = process.argv.slice(2)
if (!root) throw new Error('请提供第三冬资料库目录，可另传输出路径和图表目录')

const data = await loadLocalScorpion(resolve(root), resolve(tables))
const map = data.assets.map
const mobilities = ['track', 'truck', 'leg']
const weathers = ['freeze', 'thaw']
const edgeKeyOf = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)
const cost = (value) => (value === 'all' ? 'all' : value)

const edges = {}
const costs = {}
let printed = 0
for (const from of map.hexes.keys()) {
  for (const to of map.neighbors(from)) {
    const edge = map.edge(from, to)
    if (!edge) continue
    printed++
    edges[edgeKeyOf(from, to)] = edge
    for (const mobility of mobilities) {
      for (const weather of weathers) {
        costs[`${weather}|${mobility}|${from}|${to}`] = cost(scorpionTraceStepCost(map, from, to, mobility, weather))
      }
    }
  }
}
// Ordinary (dry) costs keep the separate dry column apart from the trace's freeze/thaw choice.
const dry = {}
for (const from of map.hexes.keys()) {
  for (const to of map.neighbors(from)) {
    if (!map.edge(from, to)) continue
    for (const mobility of mobilities) {
      dry[`${mobility}|${from}|${to}`] = cost(scorpionStepCost(map, from, to, mobility, 'dry'))
    }
  }
}

const fixture = {
  version: 1, scenarioId: '08-korsun-pocket', fingerprint: data.fingerprint,
  mobilities, weathers, edges, terrains: Object.fromEntries([...map.hexes].map(([hex, { terrains }]) => [hex, [...terrains]])),
  costs, dry,
}
await mkdir(dirname(resolve(output)), { recursive: true })
await writeFile(resolve(output), JSON.stringify(fixture) + '\n')
console.log(`已导出 08 格边取费对照 · 印刷边 ${printed} 条 · 记录 ${Object.keys(costs).length} 条 · ${resolve(output)}`)
