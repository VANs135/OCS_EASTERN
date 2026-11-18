import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRngState } from '@ocs-eastern/series/rng'
import { scorpionArrivalCatalog } from '../src/import/scorpion-arrivals.ts'
import { loadScorpionMap } from '../src/import/scorpion-map-files.ts'
import { loadScorpionUnits } from '../src/import/scorpion-unit-sources.ts'
import { startScorpionPlayerTurns } from '../src/match/scorpion-player-turn.ts'
import { submitScorpionReinforcement } from '../src/match/scorpion-reinforcement.ts'
import { completeScorpionCleanup } from '../src/match/scorpion-round.ts'
import { submitScorpionDemo } from './scorpion-demo-commands.mjs'
import { answerRetention, chooseFirstPlayer, rollInitiative } from '../src/ttw/scorpion/initiative-step.ts'
import { calibratedSurface } from '../src/view/calibrated-surface.ts'
import { scorpionBoxFrame, scorpionSessionBoxFrame, scorpionSurfaceBoxes } from '../src/view/scorpion-boxes.ts'
import { scorpionBarrageMarkerFrame, scorpionSovietAid } from '../src/view/scorpion-barrage-markers.ts'
import { scorpionMapStacks } from '../src/view/scorpion-map-counters.ts'
import {
  sampleScorpionAirBarrage, sampleScorpionAirOperations, sampleScorpionGroundAirlift, sampleScorpionOnMapSupplyAirlift,
  sampleScorpionSupplyAirlift, sampleScorpionSupplyDrop, sampleScorpionTrainbusting,
} from './scorpion-air-example.mjs'
import { sampleScorpionFrontBarrage } from './scorpion-front-barrage-example.mjs'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'
import { sampleScorpionRefit } from './scorpion-refit-example.mjs'
import { sampleScorpionExtender, sampleScorpionLogistics } from './scorpion-logistics-example.mjs'
import { sampleScorpionRetreatCapture } from './scorpion-retreat-example.mjs'
import { sampleScorpionRemnant } from './scorpion-remnant-example.mjs'
import { sampleScorpionReroll } from './scorpion-reroll-example.mjs'

const [root, ...options] = process.argv.slice(2)
if (!root) throw new Error('Usage: preview:map -- <TTW directory> [unit backup directory] [--render=PNG path | --render-aid=PNG path] [--frame=N]')
const renderOption = options.find((arg) => arg.startsWith('--render=') || arg.startsWith('--render-aid='))
const renderIndex = options.find((arg) => arg.startsWith('--frame='))?.slice('--frame='.length)
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
const aid = { ...scorpionSovietAid, path: join(imageDirectory, scorpionSovietAid.asset) }
const { before, axisConfirmed, started } = sampleScorpionOpening(setup, { map: groundMap, catalog })
const { pieces, turn: initial } = started.state
const frames = []
function boardFrame(state) {
  const { mapCounters, aidCounters } = scorpionBarrageMarkerFrame(state, catalog)
  return { aidCounters, mapStacks: scorpionMapStacks(state, catalog, mapCounters) }
}
function sessionFrame(caption, state) {
  frames.push({ caption, ...scorpionSessionBoxFrame(state, catalog), ...boardFrame(state) })
}
sessionFrame('开局 · 轴心部署', before.state)
sessionFrame('轴心已确认 · 苏军部署', axisConfirmed.state)
sessionFrame('双方部署已确认 · 1 月 26 日苏军先行', started.state)
const { reroll: openingReroll } = scorpionSessionBoxFrame(started.state, catalog)

function frame(caption, turn, player) {
  frames.push({ caption, ...scorpionBoxFrame(turn, pieces, catalog, player),
    ...boardFrame({ ...started.state, turn }), reroll: openingReroll })
}

function dice(...faces) {
  return () => {
    const face = faces.shift()
    if (face === undefined) throw new Error('Unexpected preview roll')
    return face
  }
}

function ready(turn, first = 'axis') {
  const rolling = turn.step.kind === 'retention' ? answerRetention(turn, turn.step.responder, 'roll').turn : turn
  const initiative = rollInitiative(rolling, dice(6, 5, 2, 1))
  return chooseFirstPlayer(initiative, 'axis', first)
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

const barragePath = process.env.OCS_V43_BARRAGE
let logistics
let extender
{
  const barrage = barragePath ? JSON.parse(await readFile(barragePath, 'utf8')) : undefined
  const facilityPath = process.env.OCS_V43_FACILITY
  const facilityBarrage = facilityPath ? JSON.parse(await readFile(facilityPath, 'utf8')) : undefined
  const setupAssets = { map: groundMap, catalog }
  const rules = { barrage, facilityBarrage, reinforcements: () => ({ ...board, controlOf: () => 'soviet',
    supplySources: { axis: new Set(), soviet: new Set(['s22.02']) } }) }
  let opening = started
  function issue(action) {
    opening = submitScorpionDemo(opening, 'soviet',
      { id: `preview-opening-${opening.revision}`, expectedRevision: opening.revision, action }, setupAssets, rules).record
  }
  issue({ type: 'complete-refit' })
  for (const entry of arrivalCatalog.filter(({ side, turn }) => side === 'soviet' && turn === 1)) {
    issue({ type: 'place-arrival', arrivalId: entry.id, hex: entry.destinations[0] })
  }
  issue({ type: 'place-supply', target: { kind: 'hex', id: 's22.02' }, tokens: 8 })
  issue({ type: 'finish-scheduled-arrivals' })
  issue({ type: 'complete-reinforcement' })
  logistics = sampleScorpionLogistics(opening, setupAssets, rules)
  extender = sampleScorpionExtender(opening, setupAssets, rules)
  if (barrage) {
    const { deployed, finished, center } = sampleScorpionFrontBarrage(opening, setupAssets, rules)
    sessionFrame('首回合炮击 · 准备格', opening.state)
    sessionFrame(`首回合炮击 · 标记移到 ${center}`, deployed.state)
    sessionFrame('首回合炮击完毕 · 标记翻面回到恢复格 1', finished.state)
  }
  const counters = Object.entries(opening.state.units)
    .filter(([, unit]) => unit.side === 'soviet' && unit.combat && unit.mobility === 'leg' && unit.hex === 's2.16')
    .slice(0, 2).map(([unitId]) => ({ unitId }))
  if (counters.length === 2) {
    issue({ type: 'reserve-stack-move', path: ['s3.16'], counters })
    sessionFrame('苏军预备队从 s2.16 移至 s3.16', opening.state)
  }
  const air = sampleScorpionAirOperations(opening, setupAssets, rules)
  sessionFrame('转场演示 · 地图外战斗机抵达 s18.07，保持激活', air.transfer.state)
  sessionFrame('扫荡演示 · 苏军战斗机飞抵 s13.11，等待空战', air.launched.state)
  sessionFrame('空战结束 · 苏军战斗机等待返航', air.pendingReturn.state)
  sessionFrame('返航完成 · 苏军战斗机回到地图外空军盒，转为非激活', air.returned.state)
  if (barrage) {
    const strike = sampleScorpionAirBarrage(opening, setupAssets, rules)
    sessionFrame(`轰炸演示 · 空军抵达 ${strike.event.target}`, strike.attacking.state)
    sessionFrame('轰炸结算 · 守军混乱，空军准备返航', strike.returning.state)
    sessionFrame('轰炸返航 · 飞机回到空军盒，转为非激活', strike.returned.state)
  }
  if (facilityBarrage) {
    const strike = sampleScorpionTrainbusting(opening, setupAssets, rules)
    sessionFrame(`运输破坏 · 目标格 ${strike.event.target} 放置标记，飞机准备返航`, strike.returning.state)
    sessionFrame('运输破坏 · 飞机已返航，目标格保留标记', strike.returned.state)
  }
}

const refit = sampleScorpionRefit(started, { map: groundMap, catalog })
sessionFrame('整备演示 · 飞机处于非激活', refit.before.state)
sessionFrame(refit.airBase ? '整备完成 · 图上机场消耗 1T，地图外免费' : '整备完成 · 地图外空军盒免费', refit.after.state)

const airliftTurn = ready(second, 'soviet')
const airliftOpening = { ...started, state: { ...started.state, turn: airliftTurn, cursor: startScorpionPlayerTurns(airliftTurn) } }
const airlift = sampleScorpionSupplyAirlift(airliftOpening, { map: groundMap, catalog }, { reinforcements: () => board })
sessionFrame('空运演示 · 增援补给放入苏军空军盒', airlift.before.state)
sessionFrame(`空运结算 · ${airlift.event.target.hex} 收到 ${airlift.event.airlift.unloading.delivered}T`, airlift.returned.state)

const onMapAirlift = sampleScorpionOnMapSupplyAirlift(started, { map: groundMap, catalog }, {})
sessionFrame('图上空运演示 · 轴心国夺取 s18.07 后的受控盘面', onMapAirlift.before.state)
sessionFrame('图上空运结算 · He.111H 从 s13.11 运送 1T 至 s18.07', onMapAirlift.returned.state)
const groundAirlift = sampleScorpionGroundAirlift(onMapAirlift.before, { map: groundMap, catalog }, {})
sessionFrame('战斗单位空运演示 · 受控盘面，部队和运输机在出发机场集结', groundAirlift.before.state)
sessionFrame('战斗单位空运 · 部队在 s18.07 卸载，运输机返场', groundAirlift.landed.state)
sessionFrame(`战斗单位空运 · 部队使用剩余移动力抵达 ${groundAirlift.destination}`, groundAirlift.marched.state)
// Use a separate preview branch so the PNG always shows a landed supply counter.
const dropOpening = { ...airlift.before, state: { ...airlift.before.state, rng: createRngState(1) } }
const supplyDrop = sampleScorpionSupplyDrop(dropOpening, { map: groundMap, catalog }, {})
const { target: dropTarget, drop: { result: dropResult } } = supplyDrop.event
if (!dropResult.landedTokens) throw new Error('The seeded drop preview needs a landed supply counter')
sessionFrame(`补给空投 · ${dropTarget.hex} 落地 ${dropResult.landedTokens}T，损失 ${dropResult.lostTokens}T`, supplyDrop.returning.state)
sessionFrame(`补给空投 · 飞机回到苏军空军盒，${dropTarget.hex} 保留落地补给`, supplyDrop.returned.state)
sessionFrame(`运输点在 ${logistics.from} 装载 2T`, logistics.loaded.state)
sessionFrame(`运输点在 ${logistics.to} 卸载 1T，${logistics.organicHex} 编内卡车为编队供油`, logistics.arrived.state)
sessionFrame(`延补队演示 · 受控盘面，轴心 5 个空载运输点在 ${extender.hex}`, extender.before.state)
sessionFrame(`延补队演示 · ${extender.hex} 翻到 ${extender.range} MP 延补队面`, extender.formed.state)
const combatTablePath = process.env.OCS_V43_CRT
if (combatTablePath) {
  const combat = { table: JSON.parse(await readFile(combatTablePath, 'utf8')) }
  const retreat = sampleScorpionRetreatCapture(started, { map: groundMap, catalog }, { combat })
  sessionFrame(`撤退 · ${retreat.airfield} 机场易手，等待轴心飞机位移`, retreat.paused.state)
  sessionFrame(`撤退完成 · 部队抵达 ${retreat.destination}，轴心飞机移入地图外空军盒`, retreat.finished.state)
  const remnant = sampleScorpionRemnant(started, { map: groundMap, catalog }, { combat })
  sessionFrame(`受控战果 · 第 57 步兵师进死人堆，残部营放在 ${remnant.report.destination}，苏军加 1 分`, remnant.settled.state)
}
const reroll = sampleScorpionReroll(airliftOpening, { map: groundMap, catalog }, { reinforcements: () => board })
sessionFrame('第 2 回合 · 苏军掷增援补给', reroll.initial.state)
sessionFrame('苏军重掷 · 算子已转交轴心', reroll.transferred.state)
sessionFrame(`轴心保留骰点 · 苏军获得 ${reroll.report.sp} SP`, reroll.settled.state)

const assets = new Set(frames.flatMap(({ trackers, inventories, aidCounters, mapStacks, reroll }) => {
  const onMap = mapStacks.flatMap(({ pages }) => pages.flat())
  return [...trackers, ...aidCounters, ...onMap, ...(reroll ? [reroll] : []), ...inventories.flatMap(({ counters }) => counters),
    ...onMap.flatMap(({ badges }) => badges ?? [])].flatMap(({ asset }) => asset ? [asset] : [])
}))
await Promise.all([access(map), access(aid.path), ...[...assets].map((asset) => access(join(imageDirectory, asset)))])
const temporary = await mkdtemp(join(tmpdir(), 'ocs-scorpion-'))
const model = join(temporary, 'frames.json')
try {
  await writeFile(model, JSON.stringify({ width: surface.width, height: surface.height, map, boxes, frames, imageDirectory, aid,
    labels: { title: '第三冬 · 瓶中蝎', map: '小地图', aid: '苏军辅助卡', previous: '上一步', next: '下一步',
      empty: '空', hidden: '仅本方可见', cycle: '查看这个格的下一页算子' } }))
  const renderer = fileURLToPath(new URL('../desktop/CalibratedMap.ps1', import.meta.url))
  const args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', renderer, '-ModelPath', model]
  if (renderOption) args.push('-RenderTo', resolve(renderOption.slice(renderOption.indexOf('=') + 1)))
  if (renderOption?.startsWith('--render-aid=')) args.push('-RenderAid')
  if (renderIndex !== undefined) {
    const index = Number(renderIndex)
    if (!Number.isSafeInteger(index) || index < 0 || index >= frames.length) throw new Error('Invalid preview frame')
    args.push('-RenderFrame', String(index))
  }
  await new Promise((done, fail) => {
    const child = spawn('powershell.exe', args, { stdio: 'inherit', windowsHide: true })
    child.once('error', fail)
    child.once('exit', (code) => code === 0 ? done() : fail(new Error(`Windows map viewer exited with code ${code}`)))
  })
} finally {
  await rm(model, { force: true })
  await rmdir(temporary)
}
