import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { scorpionArrivalCatalog } from '../../src/import/scorpion-arrivals.ts'
import { loadScorpionMap } from '../../src/import/scorpion-map-files.ts'
import { loadScorpionUnits } from '../../src/import/scorpion-unit-sources.ts'
import { scorpionReinforcementBoard } from '../../src/match/scorpion-reinforcement-board.ts'
import { calibratedSurface } from '../../src/view/calibrated-surface.ts'
import { scorpionSurfaceBoxes } from '../../src/view/scorpion-boxes.ts'
import { scorpionSovietAid } from '../../src/view/scorpion-barrage-markers.ts'

export async function loadLocalScorpion(root, tables, unitRoot = join(dirname(root), 'DATA备份')) {
  const data = new Map()
  async function json(path) {
    let raw
    try { raw = await readFile(path) } catch (error) {
      throw new Error(`无法读取 ${path}`, { cause: error })
    }
    data.set(path, raw)
    return JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''))
  }
  const scenario = join(root, 'data', 'scenarios', '08-scorpion')
  const [map, catalog, setup, arrivalsData, calibration, table, barrage, facilityBarrage] = await Promise.all([
    loadScorpionMap((...parts) => json(join(root, ...parts))),
    loadScorpionUnits((file) => json(join(unitRoot, file))), json(join(scenario, 'setup.json')),
    json(join(scenario, 'reinforcements.json')), json(join(root, '地图标定', 'hex-calib-瓶中蝎.json')),
    json(process.env.OCS_V43_CRT || join(tables, 'ocs-v43-crt.json')),
    json(process.env.OCS_V43_BARRAGE || join(tables, 'ocs-v43-barrage.json')),
    json(process.env.OCS_V43_FACILITY || join(tables, 'ocs-v43-facility.json')),
  ])
  const arrivals = scorpionArrivalCatalog(arrivalsData, catalog.aliases)
  const surface = calibratedSurface(calibration)
  const imageDirectory = resolve(root, 'vmod', 'images')
  const artwork = join(imageDirectory, 'Scorpion-Map-200929.png')
  const aid = { ...scorpionSovietAid, path: join(imageDirectory, scorpionSovietAid.asset) }
  await Promise.all([access(artwork), access(aid.path)])
  // Compare the loaded bytes by role so relocating a complete data directory keeps the same fingerprint.
  const hashes = [...data.values()].map((bytes) => createHash('sha256').update(bytes).digest('hex')).sort()
  const fingerprint = createHash('sha256').update(hashes.join('\n')).digest('hex')
  const assets = { map, catalog }
  const model = { width: surface.width, height: surface.height, map: artwork, boxes: scorpionSurfaceBoxes(surface),
    imageDirectory, aid, labels: { title: '第三冬 · 瓶中蝎', map: '小地图', aid: '苏军辅助卡', empty: '空',
      hidden: '仅本方可见', cycle: '查看这个格的下一页算子' } }
  return { fingerprint, assets, setup, model,
    board: { combat: { table }, barrage, facilityBarrage, reinforcements: (state) => scorpionReinforcementBoard(state, assets, arrivals) } }
}
