import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scorpionArrivalCatalog } from '../src/import/scorpion-arrivals.ts'
import { loadScorpionMap } from '../src/import/scorpion-map-files.ts'
import { loadScorpionUnits } from '../src/import/scorpion-unit-sources.ts'
import { startScorpionPlayerTurns } from '../src/match/scorpion-player-turn.ts'
import { submitScorpionReinforcement } from '../src/match/scorpion-reinforcement.ts'
import { completeScorpionCleanup } from '../src/match/scorpion-round.ts'
import { answerRetention, chooseFirstPlayer, rollInitiative } from '../src/ttw/scorpion/initiative-step.ts'
import { calibratedSurface } from '../src/view/calibrated-surface.ts'
import { scorpionBoxFrame, scorpionSessionBoxFrame, scorpionSurfaceBoxes } from '../src/view/scorpion-boxes.ts'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'

const [root, ...options] = process.argv.slice(2)
if (!root) throw new Error('Usage: preview:map -- <TTW directory> [unit backup directory] [--render=PNG path]')
const renderOption = options.find((arg) => arg.startsWith('--render='))
const unitRoot = options.find((arg) => !arg.startsWith('--')) ?? join(dirname(resolve(root)), 'DATA备份')
const json = async (...path) => JSON.parse((await readFile(join(...path), 'utf8')).replace(/^\uFEFF/, ''))
const scenario = [root, 'data', 'scenarios', '08-scorpion']
const [calibration, catalog, setup, arrivals, groundMap] = await Promise.all([
  json(root, '地图标定', 'hex-calib-瓶中蝎.json'), loadScorpionUnits((file) => json(unitRoot, file)),
  json(...scenario, 'setup.json'), json(...scenario, 'reinforcements.json'),
  loadScorpionMap((...path) => json(root, ...path)),
])
const surface = calibratedSurface(calibration)
const boxes = scorpionSurfaceBoxes(surface)
const imageDirectory = resolve(root, 'vmod', 'images')
const map = join(imageDirectory, 'Scorpion-Map-200929.png')
const { before, axisConfirmed, started } = sampleScorpionOpening(setup, { map: groundMap, catalog })
const { pieces, turn: initial } = started.state
const frames = [
  { caption: '开局 · 轴心部署', ...scorpionSessionBoxFrame(before.state, catalog) },
  { caption: '轴心已确认 · 苏军部署', ...scorpionSessionBoxFrame(axisConfirmed.state, catalog) },
  { caption: '双方部署已确认 · 1 月 26 日苏军先行', ...scorpionSessionBoxFrame(started.state, catalog) },
]

function frame(caption, turn, player) {
  frames.push({ caption, ...scorpionBoxFrame(turn, pieces, catalog, player) })
}

function dice(...faces) {
  return () => {
    const face = faces.shift()
    if (face === undefined) throw new Error('Unexpected preview roll')
    return face
  }
}

function ready(turn) {
  const rolling = turn.step.kind === 'retention' ? answerRetention(turn, turn.step.responder, 'roll').turn : turn
  const initiative = rollInitiative(rolling, dice(6, 5, 2, 1))
  return chooseFirstPlayer(initiative, 'axis', 'axis')
}

function nextRound(turn, riverSteps, ...rolls) {
  const firstCursor = { ...startScorpionPlayerTurns(turn), phase: 'cleanup' }
  const arrival = { placed: [], mobilized: [], sovietVp: turn.vp }
  const first = completeScorpionCleanup(turn, { cursor: firstCursor, arrival, victory: null },
    firstCursor.phasing, riverSteps, 'soviet', dice())
  const secondCursor = { ...first.cursor, phase: 'cleanup' }
  return completeScorpionCleanup(first.turn, { cursor: secondCursor, arrival, victory: null },
    secondCursor.phasing, riverSteps, 'soviet', dice(...rolls)).turn
}

const second = nextRound(initial, 0, 6, 6)
frame('1 月 29 日 · 正常飞行', second)
const third = nextRound(ready(second), 2, 1, 3, 4)
frame('2 月 1 日 · 第聂伯河扣 2 分', third)
const fourth = nextRound(ready(third), 0, 6)
frame('2 月 5 日 · 解冻、禁飞', fourth)

const arrivalCatalog = scorpionArrivalCatalog(arrivals, catalog.aliases)
const optional = arrivalCatalog.find((entry) => entry.optionalForce === 'axis-24-panzer')
if (!optional) throw new Error('Missing Scorpion 24th Panzer arrival')
const cursor = startScorpionPlayerTurns(ready(fourth))
let record = { state: { cursor, window: null, arrival: { placed: [], mobilized: [], sovietVp: fourth.vp },
  arrivalsOnMap: [], dumps: {}, pax: { axis: 0, soviet: 0 }, availableAlerts: [], placedAlerts: [], victory: null },
  revision: 0, receipts: [] }
const board = { catalog: arrivalCatalog, arrivalDestinations: (entry) => entry.destinations,
  supplySources: { axis: new Set(), soviet: new Set() }, controlOf: () => 'axis', alertDestinations: () => [] }
function submit(action) {
  record = submitScorpionReinforcement(record, 'axis', { id: action.type, expectedRevision: record.revision, action },
    board, dice(), () => 0).record
}
submit({ type: 'complete-refit' })
submit({ type: 'place-arrival', arrivalId: optional.id, hex: optional.destinations[0] })
frame('第 24 装甲师入场 · 苏军净胜利分加 5', ready(fourth), record.state)

const assets = new Set(frames.flatMap(({ trackers, inventories }) =>
  [...trackers, ...inventories.flatMap(({ counters }) => counters)].map(({ asset }) => asset)))
await Promise.all([access(map), ...[...assets].map((asset) => access(join(imageDirectory, asset)))])
const temporary = await mkdtemp(join(tmpdir(), 'ocs-scorpion-'))
const model = join(temporary, 'frames.json')
try {
  await writeFile(model, JSON.stringify({ width: surface.width, height: surface.height, map, boxes, frames, imageDirectory,
    labels: { title: '第三冬 · 瓶中蝎小地图', previous: '上一步', next: '下一步', empty: '空', hidden: '仅本方可见' } }))
  const renderer = fileURLToPath(new URL('../desktop/CalibratedMap.ps1', import.meta.url))
  const args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', renderer, '-ModelPath', model]
  if (renderOption) args.push('-RenderTo', resolve(renderOption.slice('--render='.length)))
  await new Promise((done, fail) => {
    const child = spawn('powershell.exe', args, { stdio: 'inherit', windowsHide: true })
    child.once('error', fail)
    child.once('exit', (code) => code === 0 ? done() : fail(new Error(`Windows map viewer exited with code ${code}`)))
  })
} finally {
  await rm(model, { force: true })
  await rmdir(temporary)
}
