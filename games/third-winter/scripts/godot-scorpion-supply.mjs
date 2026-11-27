import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalScorpion } from '../desktop/local/data.mjs'
import { scorpionEnemyZoc, scorpionSupplyPosition } from '../src/match/scorpion-supply-position.ts'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'

// Oracle fixture for the native supply position. The trace itself stays in TypeScript.
const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))
const [root, output = join(dist, 'godot', '08-supply.json'), tables = dist] = process.argv.slice(2)
if (!root) throw new Error('请提供第三冬资料库目录，可另传输出路径和图表目录')

const seed = 19440126
const data = await loadLocalScorpion(resolve(root), resolve(tables))
const opening = sampleScorpionOpening(data.setup, data.assets, seed)
const state = JSON.parse(JSON.stringify(opening.started.state))
const map = data.assets.map

const sorted = (set) => [...set].sort()
const position = (side) => {
  const facts = scorpionSupplyPosition(state, map, side)
  return {
    sources: sorted(facts.sources), controlled: sorted(facts.controlled),
    enemyCombat: sorted(facts.enemyCombat), unnegatedEnemyZoc: sorted(facts.unnegatedEnemyZoc),
    detrainableFacilities: sorted(facts.detrainableFacilities),
    headquarters: facts.headquarters.map(({ id, hex, throwRange, kessel }) => ({
      id, hex, throwRange: throwRange ?? null, kessel: kessel === true })),
    extenders: facts.extenders.map(({ hex, range, mobility }) => ({ hex, range, mobility })),
    weather: facts.weather,
  }
}
const fixture = {
  version: 1, scenarioId: '08-korsun-pocket', seed, fingerprint: data.fingerprint, revision: 0,
  zoc: { axis: sorted(scorpionEnemyZoc(state, map, 'axis')), soviet: sorted(scorpionEnemyZoc(state, map, 'soviet')) },
  position: { axis: position('axis'), soviet: position('soviet') },
}
await mkdir(dirname(resolve(output)), { recursive: true })
await writeFile(resolve(output), JSON.stringify(fixture) + '\n')
console.log(`已导出 08 补给态势对照 · 轴心 ZOC ${fixture.zoc.axis.length} 格 · 苏军 ZOC ${fixture.zoc.soviet.length} 格 · ${resolve(output)}`)
