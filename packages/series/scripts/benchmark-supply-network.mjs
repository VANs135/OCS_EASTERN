import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { supplyNetwork } from '../src/supply-network.ts'

const width = 100
const height = 80
const hexes = Array.from({ length: width * height }, (_, i) => String(i))
const adjacency = new Map(hexes.map((hex) => {
  const x = Number(hex) % width
  const y = Math.floor(Number(hex) / width)
  const near = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1], [x - 1, y + 1], [x + 1, y - 1]]
  return [hex, near.filter(([a, b]) => a >= 0 && a < width && b >= 0 && b < height).map(([a, b]) => String(b * width + a))]
}))
const stations = new Set(hexes.filter((hex) => Number(hex) % 9 === 0))
const state = {
  sources: new Set(hexes.filter((hex) => Number(hex) % width === 0)),
  controlled: stations,
  headquarters: hexes.filter((hex) => Number(hex) % 101 === 0).map((hex) => ({ id: `hq:${hex}`, hex, throwRange: 6, mobility: 'truck' })),
  extenders: hexes.filter((hex) => Number(hex) % 157 === 0).map((hex) => ({ hex, range: 4, mobility: 'truck' })),
  enemyCombat: new Set(hexes.filter((hex) => Number(hex) % 211 === 15)),
  unnegatedEnemyZoc: new Set(hexes.filter((hex) => Number(hex) % 211 === 16)),
}
const queries = Array.from({ length: 1600 }, (_, i) => ({ hex: String((i * 137 + 23) % hexes.length), mobility: i % 3 === 0 ? 'leg' : 'truck' }))

function run(create, mode) {
  const counters = { neighbors: 0, costs: 0, rail: 0 }
  const board = {
    hasHex: (hex) => adjacency.has(hex),
    neighbors: (hex) => { counters.neighbors++; return adjacency.get(hex) ?? [] },
    incomingNeighbors: (hex) => { counters.neighbors++; return adjacency.get(hex) ?? [] },
    traceCost: (from, to, mobility) => {
      counters.costs++
      const sample = (Number(from) * 19 + Number(to) * 13) % 17
      if (sample === 0) return null
      if (sample === 1) return 'all'
      return sample < 4 && mobility === 'truck' ? 2 : 1
    },
    railCanTrace: (from, to) => { counters.rail++; return Math.abs(Number(from) - Number(to)) === 1 },
    detrainable: (hex) => stations.has(hex),
  }
  const start = performance.now()
  const network = create(board, state)
  if (mode === 'trace-exists' && network.prepareTraceCoverage) {
    for (const mobility of new Set(queries.map((query) => query.mobility))) network.prepareTraceCoverage(mobility)
  }
  const values = queries.map(({ hex, mobility }, index) => {
    const dump = queries[(index + 11) % queries.length].hex
    if (mode === 'trace-and-dump') return [network.trace(hex, mobility), network.canUseDump(hex, dump, mobility)]
    if (mode === 'dump-only') return network.canUseDump(hex, dump, mobility)
    return network.hasTrace ? network.hasTrace(hex, mobility) : network.trace(hex, mobility).length > 0
  })
  return { values, stats: { ms: Number((performance.now() - start).toFixed(1)), ...counters } }
}

const baseline = process.argv[2] ? (await import(pathToFileURL(resolve(process.argv[2])).href)).supplyNetwork : undefined
const report = { hexes: hexes.length, queryLocations: queries.length, headquarters: state.headquarters.length, batches: [] }
for (const name of ['trace-and-dump', 'dump-only', 'trace-exists']) {
  const before = baseline && run(baseline, name)
  const after = run(supplyNetwork, name)
  if (before && JSON.stringify(before.values) !== JSON.stringify(after.values)) throw new Error(`Changed supply results: ${name}`)
  report.batches.push({ name, ...(before ? { before: before.stats, identical: true } : {}), after: after.stats })
}
console.log(JSON.stringify(report, null, 2))
