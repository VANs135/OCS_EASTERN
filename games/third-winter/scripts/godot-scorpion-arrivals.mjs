import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalScorpion } from '../desktop/local/data.mjs'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'

// Oracle fixture for the native reinforcement board: OCS 13.6 arrival destinations for the whole
// catalog and TTW 1.7a/2.4b Alert destinations for the opening Alert pool.
const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))
const [root, output = join(dist, 'godot', '08-arrivals.json'), tables = dist] = process.argv.slice(2)
if (!root) throw new Error('请提供第三冬资料库目录，可另传输出路径和图表目录')

const seed = 19440126
const data = await loadLocalScorpion(resolve(root), resolve(tables))
const opening = sampleScorpionOpening(data.setup, data.assets, seed)
const state = JSON.parse(JSON.stringify(opening.started.state))
const board = data.board.reinforcements(state)

// First-turn catalog entries all keep their printed hex, so two synthetic blocked edge entries
// cover the OCS 13.6b substitution branch: each sits on the enemy's printed supply source.
const synthetic = [
  { id: 'synthetic:soviet:edge', side: 'soviet', turn: 1, destinations: ['s1.06'], definition: 'land:id:2098' },
  { id: 'synthetic:axis:edge', side: 'axis', turn: 1, destinations: ['s22.02'], definition: 'land:id:2073' },
].map((entry) => ({ ...entry, legal: board.arrivalDestinations(entry) }))

const fixture = {
  version: 1, scenarioId: '08-korsun-pocket', seed, fingerprint: data.fingerprint, revision: 0,
  turn: state.cursor.turn, weather: state.turn.weather.ground,
  arrivals: [...board.catalog.map((entry) => ({ id: entry.id, side: entry.side, turn: entry.turn,
    definition: entry.definition, destinations: entry.destinations,
    legal: board.arrivalDestinations(entry) })), ...synthetic],
  alerts: state.availableAlerts.map((counter) => ({ id: counter.id, definition: counter.definition,
    legal: board.alertDestinations(counter) })),
}
await mkdir(dirname(resolve(output)), { recursive: true })
await writeFile(resolve(output), JSON.stringify(fixture) + '\n')
console.log(`已导出 08 增援板对照 · 抵达 ${fixture.arrivals.length} 条 · Alert ${fixture.alerts.length} 枚 · ${resolve(output)}`)
