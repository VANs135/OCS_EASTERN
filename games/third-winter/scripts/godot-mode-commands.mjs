import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync as readFileSyncSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalScorpion } from '../desktop/local/data.mjs'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'
import { deployScorpionGroundCounter } from '../src/import/scorpion-deployment.ts'
import { scorpionModeFace } from '../src/import/scorpion-mode-face.ts'
import { scorpionEnemyZoc } from '../src/match/scorpion-supply-position.ts'
import { prepareScorpionReserve } from '../src/match/scorpion-reserves.ts'
import {
  canSwitchMode, canReleaseReserve, canMoveInPhase, validateModeState,
  exertsZoc, canUseTransport, canEngineer, canStackWithHedgehog, mustEndMoveInSupply,
} from '@ocs-eastern/series/modes'

// Oracle fixture for the native mode/reserve command layer (08 换面与预备命令).
// Every expected snapshot is projected by the TypeScript functions; the GDScript side replays them.
const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))
const [root, output = join(dist, 'godot', '08-mode-commands.json'), tables = dist] = process.argv.slice(2)
if (!root) throw new Error('请提供第三冬资料库目录，可另传输出路径和图表目录')

const data = await loadLocalScorpion(resolve(root), resolve(tables))
const sample = sampleScorpionOpening(data.setup, data.assets, 19440126)
const base = sample.started.state
const defs = data.assets.catalog.definitions
const bundlePath = join(resolve(tables), 'godot', '08-opening-data.json')
const bundle = JSON.parse(readFileSyncSync(bundlePath, 'utf8'))
const packetFaces = bundle.view.catalog.faces

const clone = (value) => JSON.parse(JSON.stringify(value))
const otherSide = (side) => (side === 'axis' ? 'soviet' : 'axis')

// ── 样本选取：步兵团 / 装甲团 / HQ / 炮兵 / 运输点数 / 编内卡车 ──
const onMap = Object.entries(base.units).map(([id, unit]) => ({ id, unit, def: defs.get(unit.definition) }))
const byCategory = (category) => onMap.filter(({ def, unit }) =>
  def?.source.category === category && unit.combat === true)

const infantry = byCategory('infantry')[0]
const armor = byCategory('armor')[0]
const hq = onMap.find(({ def }) => def?.kind === 'hq')
const organicTruck = onMap.find(({ unit }) => unit.organicTruck !== undefined)
const transportPoint = onMap.find(({ def }) => def?.kind === 'transport')

// 08 开局在盘无炮兵；从数据包已覆盖的炮兵定义合成一枚（与数据包 faces 模板同源）。
const artyKey = Object.keys(packetFaces).find((key) =>
  bundle.view.catalog.definitions[key].artillery && packetFaces[key].move)
const artyDef = defs.get(artyKey)
const artyHex = [...data.assets.map.hexes.keys()][0]
const artyUnit = deployScorpionGroundCounter(artyDef, artyHex, 0)

const samples = [
  { label: '步兵团', unit: infantry.unit, id: infantry.id },
  { label: '装甲团', unit: armor.unit, id: armor.id },
  { label: '司令部', unit: hq.unit, id: hq.id },
  { label: '炮兵', unit: artyUnit, id: 'synth:artillery' },
  { label: '编内卡车', unit: organicTruck.unit, id: organicTruck.id },
  { label: '运输点数', unit: transportPoint.unit, id: transportPoint.id },
]

const movementCursor = (side) => ({ turn: 1, first: 'soviet', phasing: side, phase: 'movement' })

function forgedState({ cursor, units, moved = [], airlifted = [], combatTargets = [], victory = null }) {
  return {
    kind: 'playing', victory, cursor: clone(cursor), moved: [...moved],
    groundActivity: { turn: cursor.turn, phasing: cursor.phasing, phase: cursor.phase,
      spent: {}, airlifted: [...airlifted] },
    combatTargets: [...combatTargets], units: clone(units),
  }
}

// ── set-ground-mode 逐面投影行 ──
const faceRows = []
function pushFaceRow(label, actor, unit, unitId, face, patch = {}, rejectCode = null) {
  const action = { unitId, face }
  let expected
  if (rejectCode) {
    expected = { ok: false, errorCode: rejectCode }
  } else {
    const projected = scorpionModeFace(unit, defs.get(unit.definition), face)
    expected = { ok: true, unit: clone(projected) }
  }
  faceRows.push({ label, actor, action, state: forgedState({
    cursor: patch.cursor ?? movementCursor(actor), units: { [unitId]: unit },
    moved: patch.moved ?? [], airlifted: patch.airlifted ?? [],
  }), expected })
}

for (const sampleRow of samples) {
  const { label, unit, id } = sampleRow
  const hasMoveFace = packetFaces[unit.definition]?.move != null
  if (!hasMoveFace) {
    // 非战斗算子（运输点数 / 编内卡车）：命令先按单位资格拒绝，轮不到查面模板。
    pushFaceRow(`${label} 换面被拒`, unit.side, unit, id, 'move', {}, 'movement_unit')
    continue
  }
  const currentMove = unit.moveMode === true
  const targetFace = currentMove ? 'combat' : 'move'
  pushFaceRow(`${label} 换${targetFace === 'move' ? '移动面' : '战斗面'}`, unit.side, unit, id, targetFace)
  const reverseFace = currentMove ? 'move' : 'combat'
  pushFaceRow(`${label} 换回${reverseFace === 'move' ? '移动面' : '战斗面'}`, unit.side, unit, id, reverseFace)
}

// 无印刷移动面的战斗算子（数据包无该面模板）：面存在性守卫拒绝。
const forgedNoFace = { side: 'soviet', combat: true, definition: 'forge:no-face', hex: 's1.11',
  strength: 6, actionRating: 2, mobility: 'leg', allowance: 4, printedRe: 2, combatClass: 'other',
  antiTank: 0, stepsLost: 0, fueled: false }
pushFaceRow('无印刷移动面的战斗算子换移动面被拒', 'soviet', forgedNoFace, 'forge:no-face', 'move', {},
  'mode_face_unavailable')

// 拒绝路径：非移动阶段 / 非本方席位 / 非本方单位 / 预备标记 / 已移动 / 已空运 / 非法朝向。
const friendly = infantry.unit
pushFaceRow('非移动阶段换面被拒', friendly.side, friendly, infantry.id, 'move',
  { cursor: { turn: 1, first: 'soviet', phasing: friendly.side, phase: 'reaction' } }, 'movement_phase')
pushFaceRow('非本方席位换面被拒', otherSide(friendly.side), friendly, infantry.id, 'move',
  { cursor: { turn: 1, first: 'soviet', phasing: friendly.side, phase: 'movement' } }, 'wrong_actor')
const enemyUnit = { ...clone(friendly), side: otherSide(friendly.side) }
pushFaceRow('非本方单位换面被拒', friendly.side, enemyUnit, infantry.id, 'move', {}, 'movement_unit')
const reservedUnit = { ...clone(friendly), reserve: infantry.id }
pushFaceRow('预备单位换面被拒', friendly.side, reservedUnit, infantry.id, 'move', {}, 'movement_unit')
pushFaceRow('本阶段已移动换面被拒', friendly.side, friendly, infantry.id, 'move',
  { moved: [infantry.id] }, 'movement_spent')
pushFaceRow('已空运单位换面被拒', friendly.side, friendly, infantry.id, 'move',
  { airlifted: [infantry.id] }, 'movement_airlift')
pushFaceRow('非法朝向换面被拒', friendly.side, friendly, infantry.id, 'sideways', {}, 'mode_face')

// ── 预备三命令行 ──
const reserveRows = []
function pushReserveRow(label, command, actor, action, state, expected) {
  reserveRows.push({ label, command, actor, action, state: clone(state), expected: clone(expected) })
}

// mark-reserve 成功：当前面 / 指定移动面；编内卡车同样可进预备（无移动面，只留当前面）。
const reserveSamples = [
  { row: samples[0], faces: ['current', 'move'] },
  { row: samples[4], faces: ['current'] },
]
for (const { row: sampleRow, faces } of reserveSamples) {
  const { label, unit, id } = sampleRow
  for (const face of faces) {
    const st = forgedState({ cursor: movementCursor(unit.side), units: { [id]: unit } })
    const prepared = prepareScorpionReserve(st, unit.side, id, face, data.assets)
    pushReserveRow(`${label} 进入预备（${face}）`, 'mark-reserve', unit.side, { unitId: id, face },
      prepared, { ok: true, unit: prepared.units[id] })
  }
}

// mark-reserve 拒绝路径。
// 敌 ZOC：取真实开局中位于敌方 ZOC 的本方单位；行内保留全盘算子，使原生 ZOC 计算与 TS 同口径。
const zocSide = infantry.unit.side
const enemyZoc = scorpionEnemyZoc(base, data.assets.map, zocSide)
const inZoc = onMap.find(({ id, unit }) => unit.side === zocSide && enemyZoc.has(unit.hex))
if (inZoc) {
  const st = forgedState({ cursor: movementCursor(zocSide), units: base.units })
  pushReserveRow('敌 ZOC 内进预备被拒', 'mark-reserve', zocSide, { unitId: inZoc.id, face: 'current' },
    st, { ok: false, errorCode: 'reserve_zoc' })
}

// 运输点数 / 混乱 / 进击 / 已移动 / 已空运 均不合格。
const tp = transportPoint.unit
const tpState = forgedState({ cursor: movementCursor(tp.side), units: { [transportPoint.id]: tp } })
pushReserveRow('运输点数进预备被拒', 'mark-reserve', tp.side, { unitId: transportPoint.id, face: 'current' },
  tpState, { ok: false, errorCode: 'reserve_unit' })
const dgUnit = { ...clone(friendly), disorganized: true }
pushReserveRow('混乱单位进预备被拒', 'mark-reserve', friendly.side, { unitId: infantry.id, face: 'current' },
  forgedState({ cursor: movementCursor(friendly.side), units: { [infantry.id]: dgUnit } }),
  { ok: false, errorCode: 'reserve_unit' })
const exploitUnit = { ...clone(friendly), exploit: true }
pushReserveRow('进击单位进预备被拒', 'mark-reserve', friendly.side, { unitId: infantry.id, face: 'current' },
  forgedState({ cursor: movementCursor(friendly.side), units: { [infantry.id]: exploitUnit } }),
  { ok: false, errorCode: 'reserve_unit' })
pushReserveRow('已移动单位进预备被拒', 'mark-reserve', friendly.side, { unitId: infantry.id, face: 'current' },
  forgedState({ cursor: movementCursor(friendly.side), units: { [infantry.id]: friendly }, moved: [infantry.id] }),
  { ok: false, errorCode: 'reserve_unit' })
pushReserveRow('已空运单位进预备被拒', 'mark-reserve', friendly.side, { unitId: infantry.id, face: 'current' },
  forgedState({ cursor: movementCursor(friendly.side), units: { [infantry.id]: friendly }, airlifted: [infantry.id] }),
  { ok: false, errorCode: 'reserve_unit' })
pushReserveRow('预备朝向非法被拒', 'mark-reserve', friendly.side, { unitId: infantry.id, face: 'sideways' },
  forgedState({ cursor: movementCursor(friendly.side), units: { [infantry.id]: friendly } }),
  { ok: false, errorCode: 'reserve_orientation' })
pushReserveRow('非移动阶段进预备被拒', 'mark-reserve', friendly.side, { unitId: infantry.id, face: 'current' },
  forgedState({ cursor: { turn: 1, first: 'soviet', phasing: friendly.side, phase: 'reaction' },
    units: { [infantry.id]: friendly } }), { ok: false, errorCode: 'movement_phase' })
pushReserveRow('非本方席位进预备被拒', 'mark-reserve', otherSide(friendly.side),
  { unitId: infantry.id, face: 'current' },
  forgedState({ cursor: { turn: 1, first: 'soviet', phasing: friendly.side, phase: 'movement' },
    units: { [infantry.id]: friendly } }),
  { ok: false, errorCode: 'wrong_actor' })

// leave-reserve：成功清除标记并可重选朝向；未在预备则拒绝。
const reserved = { ...clone(friendly), reserve: infantry.id }
const leaveState = forgedState({ cursor: movementCursor(friendly.side), units: { [infantry.id]: reserved } })
const preparedLeave = prepareScorpionReserve(leaveState, friendly.side, infantry.id, 'move', data.assets)
const leaveUnit = { ...preparedLeave.units[infantry.id], reserve: null }
pushReserveRow('预备单位退出预备', 'leave-reserve', friendly.side, { unitId: infantry.id, face: 'move' },
  leaveState, { ok: true, unit: leaveUnit })
pushReserveRow('非预备单位退出被拒', 'leave-reserve', friendly.side, { unitId: infantry.id, face: 'current' },
  forgedState({ cursor: movementCursor(friendly.side), units: { [infantry.id]: friendly } }),
  { ok: false, errorCode: 'reserve_not_reserve' })

// release-reserve：反应阶段由非阶段本方释放；成功置 released=true。
const releaseSide = friendly.side
const releasePhasing = otherSide(releaseSide)
const reservedReleased = { ...clone(friendly), reserve: infantry.id }
const reactionCursor = { turn: 1, first: 'soviet', phasing: releasePhasing, phase: 'reaction' }
const releaseState = forgedState({ cursor: reactionCursor, units: { [infantry.id]: reservedReleased } })
const releaseVerdict = canReleaseReserve({ state: { face: 'combat', marker: 'reserve' },
  side: releaseSide, activeSide: releasePhasing, phase: 'reaction' })
const releasedUnit = { ...reservedReleased, reserve: null, released: true }
pushReserveRow('反应阶段释放预备', 'release-reserve', releaseSide, { unitId: infantry.id },
  releaseState, { ok: true, unit: releasedUnit, maMult: releaseVerdict.maMult })

// release-reserve 拒绝路径。
const alreadyReleased = { ...clone(friendly), reserve: infantry.id, released: true }
pushReserveRow('重复释放预备被拒', 'release-reserve', releaseSide, { unitId: infantry.id },
  forgedState({ cursor: reactionCursor, units: { [infantry.id]: alreadyReleased } }),
  { ok: false, errorCode: 'reserve_released' })
pushReserveRow('移动阶段释放预备被拒', 'release-reserve', releaseSide, { unitId: infantry.id },
  forgedState({ cursor: movementCursor(releasePhasing), units: { [infantry.id]: reservedReleased } }),
  { ok: false, errorCode: 'reserve_release' })
pushReserveRow('反应阶段阶段方释放被拒', 'release-reserve', releasePhasing, { unitId: infantry.id },
  forgedState({ cursor: reactionCursor, units: { [infantry.id]: reservedReleased } }),
  { ok: false, errorCode: 'reserve_release' })
pushReserveRow('进击阶段有战斗目标释放被拒', 'release-reserve', releaseSide, { unitId: infantry.id },
  forgedState({ cursor: { turn: 1, first: 'soviet', phasing: releasePhasing, phase: 'exploitation' },
    units: { [infantry.id]: reservedReleased }, combatTargets: ['s1.11'] }),
  { ok: false, errorCode: 'reserve_release' })
const dgReserve = { ...clone(friendly), reserve: infantry.id, disorganized: true }
pushReserveRow('混乱单位释放被拒', 'release-reserve', releaseSide, { unitId: infantry.id },
  forgedState({ cursor: reactionCursor, units: { [infantry.id]: dgReserve } }),
  { ok: false, errorCode: 'reserve_release' })

// ── canSwitchMode 合法性矩阵 ──
const switchRows = []
function pushSwitch(req, expected) { switchRows.push({ req: clone(req), expected: clone(expected) }) }
const combatReq = (to, orientation, extra = {}) => ({
  to, orientation, inEnemyZoc: false, unitClass: 'combat', side: 'soviet',
  phase: 'movement', adjacentEnemyAttackCapable: false, ...extra,
})
pushSwitch(combatReq('combat', 'combat'), { ok: true })
pushSwitch(combatReq('combat', 'move'), { ok: false, rule: '5.5', reason: '进入战斗模式必须朝向战斗面' })
pushSwitch(combatReq('move', 'move'), { ok: true })
pushSwitch(combatReq('move', 'combat'), { ok: false, rule: '5.6', reason: '进入移动模式必须朝向移动面' })
pushSwitch(combatReq('reserve', 'combat'), { ok: true })
pushSwitch(combatReq('reserve', 'combat', { inEnemyZoc: true }),
  { ok: false, rule: '5.7c', reason: '不可在敌方 ZOC 内进入预备模式' })
pushSwitch(combatReq('reserve', 'combat', { adjacentEnemyAttackCapable: true }),
  { ok: false, rule: 'IV-B', reason: '初设时与敌方攻击力单位相邻，不能设为预备或战略模式' })
pushSwitch(combatReq('strat', 'move'), { ok: true })
pushSwitch(combatReq('strat', 'move', { inEnemyZoc: true }),
  { ok: false, rule: '5.8a', reason: '不可在敌方 ZOC 内进入战略模式' })
pushSwitch(combatReq('strat', 'combat'), { ok: false, rule: '5.8', reason: '战略模式朝向必须是移动面' })
pushSwitch(combatReq('reserve', 'combat', { unitClass: 'transportPoint' }),
  { ok: false, rule: '5.7f', reason: '运输点数不允许进入预备模式（编内卡车除外）' })
pushSwitch(combatReq('strat', 'move', { unitClass: 'transportPoint' }),
  { ok: false, rule: '5.8c', reason: '运输点数不能进入战略模式' })
pushSwitch(combatReq('combat', 'combat', { unitClass: 'transportPoint' }),
  { ok: false, rule: '5.5c', reason: '补员单位与运输点数不能进入战斗模式' })
pushSwitch(combatReq('combat', 'combat', { unitClass: 'facility' }),
  { ok: false, rule: '6.1b', reason: '无 MA 设施不可移动或撤退' })
pushSwitch(combatReq('combat', 'combat', { phase: 'reaction' }),
  { ok: false, rule: '5.4', reason: '主动模式切换只能在本方移动阶段进行' })

// ── canReleaseReserve / canMoveInPhase / validateModeState / 派生判定 ──
const releaseRows = []
function pushRelease(input, expected) { releaseRows.push({ input: clone(input), expected: clone(expected) }) }
pushRelease({ state: { face: 'combat', marker: 'reserve' }, side: 'soviet', activeSide: 'axis', phase: 'reaction' },
  canReleaseReserve({ state: { face: 'combat', marker: 'reserve' }, side: 'soviet', activeSide: 'axis', phase: 'reaction' }))
pushRelease({ state: { face: 'combat', marker: 'reserve' }, side: 'axis', activeSide: 'axis', phase: 'reaction' },
  canReleaseReserve({ state: { face: 'combat', marker: 'reserve' }, side: 'axis', activeSide: 'axis', phase: 'reaction' }))
pushRelease({ state: { face: 'move', marker: 'reserve', released: true }, side: 'soviet', activeSide: 'axis', phase: 'exploitation' },
  canReleaseReserve({ state: { face: 'move', marker: 'reserve', released: true }, side: 'soviet', activeSide: 'axis', phase: 'exploitation' }))
pushRelease({ state: { face: 'combat', marker: 'reserve' }, side: 'soviet', activeSide: 'axis', phase: 'movement' },
  canReleaseReserve({ state: { face: 'combat', marker: 'reserve' }, side: 'soviet', activeSide: 'axis', phase: 'movement' }))
pushRelease({ state: { face: 'combat' }, side: 'soviet', activeSide: 'axis', phase: 'reaction' },
  canReleaseReserve({ state: { face: 'combat' }, side: 'soviet', activeSide: 'axis', phase: 'reaction' }))
pushRelease({ state: { face: 'combat', marker: 'reserve', released: true }, side: 'soviet', activeSide: 'axis', phase: 'reaction' },
  canReleaseReserve({ state: { face: 'combat', marker: 'reserve', released: true }, side: 'soviet', activeSide: 'axis', phase: 'reaction' }))

const movePhaseRows = []
function pushMovePhase(input, phase, expected) { movePhaseRows.push({ input: clone(input), phase, expected: clone(expected) }) }
const moveState = { face: 'combat' }
pushMovePhase({ state: moveState, side: 'soviet', activeSide: 'soviet' }, 'movement',
  canMoveInPhase({ state: moveState, side: 'soviet', activeSide: 'soviet' }, 'movement'))
pushMovePhase({ state: moveState, side: 'axis', activeSide: 'soviet' }, 'movement',
  canMoveInPhase({ state: moveState, side: 'axis', activeSide: 'soviet' }, 'movement'))
pushMovePhase({ state: { face: 'combat', marker: 'reserve', released: true }, side: 'soviet', activeSide: 'axis' }, 'reaction',
  canMoveInPhase({ state: { face: 'combat', marker: 'reserve', released: true }, side: 'soviet', activeSide: 'axis' }, 'reaction'))
pushMovePhase({ state: { face: 'combat', marker: 'reserve' }, side: 'soviet', activeSide: 'axis' }, 'reaction',
  canMoveInPhase({ state: { face: 'combat', marker: 'reserve' }, side: 'soviet', activeSide: 'axis' }, 'reaction'))
pushMovePhase({ state: moveState, side: 'axis', activeSide: 'axis' }, 'reaction',
  canMoveInPhase({ state: moveState, side: 'axis', activeSide: 'axis' }, 'reaction'))
pushMovePhase({ state: { face: 'combat', marker: 'exploit' }, side: 'soviet', activeSide: 'soviet' }, 'exploitation',
  canMoveInPhase({ state: { face: 'combat', marker: 'exploit' }, side: 'soviet', activeSide: 'soviet' }, 'exploitation'))
pushMovePhase({ state: { face: 'combat', marker: 'reserve', released: true }, side: 'soviet', activeSide: 'soviet' }, 'exploitation',
  canMoveInPhase({ state: { face: 'combat', marker: 'reserve', released: true }, side: 'soviet', activeSide: 'soviet' }, 'exploitation'))
pushMovePhase({ state: moveState, side: 'soviet', activeSide: 'soviet' }, 'exploitation',
  canMoveInPhase({ state: moveState, side: 'soviet', activeSide: 'soviet' }, 'exploitation'))
pushMovePhase({ state: moveState, side: 'axis', activeSide: 'soviet' }, 'exploitation',
  canMoveInPhase({ state: moveState, side: 'axis', activeSide: 'soviet' }, 'exploitation'))

const validateRows = [
  { state: { face: 'combat', marker: 'strat' }, unitClass: 'combat', expected: validateModeState({ face: 'combat', marker: 'strat' }, 'combat') },
  { state: { face: 'move', marker: 'dg' }, unitClass: 'transportPoint', expected: validateModeState({ face: 'move', marker: 'dg' }, 'transportPoint') },
  { state: { face: 'combat' }, unitClass: 'combat', expected: validateModeState({ face: 'combat' }, 'combat') },
]

const predicateStates = [
  { label: '基础战斗面', state: { face: 'combat' } },
  { label: '基础移动面', state: { face: 'move' } },
  { label: '预备', state: { face: 'combat', marker: 'reserve' } },
  { label: '已释放预备', state: { face: 'combat', marker: 'reserve', released: true } },
  { label: '进击', state: { face: 'combat', marker: 'exploit' } },
  { label: '混乱', state: { face: 'combat', marker: 'dg' } },
  { label: '战略', state: { face: 'move', marker: 'strat' } },
]
const predicateRows = predicateStates.map(({ label, state }) => ({
  label, state: clone(state),
  expected: {
    exertsZoc: exertsZoc(state), canUseTransport: canUseTransport(state),
    canEngineer: canEngineer(state), canStackWithHedgehog: canStackWithHedgehog(state),
    mustEndMoveInSupply: mustEndMoveInSupply(state),
  },
}))

const fixture = {
  version: 1, scenarioId: '08-korsun-pocket', seed: sample.seed ?? 19440126, fingerprint: data.fingerprint,
  faceRows, reserveRows, switchRows, releaseRows, movePhaseRows, validateRows, predicateRows,
}

await mkdir(dirname(resolve(output)), { recursive: true })
await writeFile(resolve(output), JSON.stringify(fixture) + '\n')
const totals = faceRows.length + reserveRows.length + switchRows.length + releaseRows.length +
  movePhaseRows.length + validateRows.length + predicateRows.length
console.log(`已导出 08 换面/预备命令对照 · 换面 ${faceRows.length} · 预备 ${reserveRows.length} · ` +
  `切换 ${switchRows.length} · 释放 ${releaseRows.length} · 阶段 ${movePhaseRows.length} · ` +
  `校验 ${validateRows.length} · 派生 ${predicateRows.length} · 共 ${totals} 条 · ${resolve(output)}`)
