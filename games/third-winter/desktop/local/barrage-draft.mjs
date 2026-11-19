import { barrageColumn } from '@ocs-eastern/series/tables/barrage'
import { scorpionHexDistance } from '../../src/import/hex-id.ts'
import { scorpionSpPayment } from '../../src/match/scorpion-sp-payment.ts'
import { scorpionGroundActivity } from '../../src/match/scorpion-ground-activity.ts'
import { scorpionPhaseBarrages, scorpionRegularBarrageTargets } from '../../src/match/scorpion-barrage-timing.ts'
import { remainingSteps } from '../../src/match/scorpion-losses.ts'
import { targetUnits } from '../../src/match/scorpion-barrage.ts'
import { scorpionSupplyPosition } from '../../src/match/scorpion-supply-position.ts'
import { scorpionBarrageFrontAt, scorpionBarrageFronts } from '../../src/ttw/scorpion/barrage-markers.ts'
import { scorpionSupplyNetwork } from '../../src/ttw/scorpion/supply-trace.ts'

// Barrage draft: the window only forwards clicks, this module owns which fire missions the player
// may declare and why a marker is unavailable. scorpion-barrage.ts stays the only authority that
// charges supply, resolves the column and settles losses.

const LIMIT = 24
const ordinaryPhases = ['reaction', 'combat', 'exploitation']

const enemyOf = (side) => side === 'axis' ? 'soviet' : 'axis'

/** Whether one artillery counter may join a barrage now, mirroring prepareBarrage's own gates. */
function batteryEntry(state, side, unitId, target, fired) {
  const unit = state.units?.[unitId]
  const face = unit?.artillery
  if (!unit || unit.side !== side) return { ok: false, why: '不是本方炮兵' }
  if (!face?.strength || !face.range) return { ok: false, why: '没有炮击值' }
  if (unit.reserve) return { ok: false, why: '待命状态不可射击' }
  if (unit.hex === target) return { ok: false, why: '不能炮击自身所在格' }
  if (scorpionHexDistance(unit.hex, target) > face.range) return { ok: false, why: '超出印刷射程' }
  const phase = state.cursor.phase
  if (phase === 'reaction' && !unit.released) return { ok: false, why: '反应阶段需先释放预备队' }
  if (phase === 'exploitation' && !unit.released &&
    (!unit.exploit || scorpionGroundActivity(state).airlifted.includes(unitId))) return { ok: false, why: '扩张阶段不可射击' }
  if (phase === 'movement' && (unit.moveMode || unit.disorganized)) return { ok: false, why: '移动面或混乱状态不可射击' }
  const used = fired.filter((battery) => battery.unitId === unitId).reduce((total, battery) => total + battery.re, 0)
  const remaining = (face.independentRe ? remainingSteps(unit) : 1) - used
  if (remaining < 1) return { ok: false, why: '本阶段已射完' }
  return { ok: true, unit, face, remaining }
}

/** Why this hex cannot be barraged this phase, or null when it can. */
export function barrageTargetReason(state, side, target, data, targetKind = 'units') {
  if (!state || state.kind !== 'playing') return '对局未进行'
  if (state.barrage) return '已有一次射击待结算'
  if (state.cursor.phasing !== side || !ordinaryPhases.includes(state.cursor.phase)) return '只在反应、战斗或扩张阶段射击'
  if (state.combatTargets?.length) return '本阶段已发起地面战斗'
  if (!data.assets.map.hexes.has(target)) return '目标不在地图上'
  if (targetKind === 'air-base') {
    if (!state.airBases?.some((base) => base.side === enemyOf(side) && base.hex === target)) return '目标不是敌方机场'
  } else if (!targetUnits(state, enemyOf(side), target).length) return '目标格没有敌方战斗单位'
  if (scorpionRegularBarrageTargets(state).has(target)) return '本阶段此格已射击过（OCS 10.0e）'
  return null
}

/**
 * Artillery that may join one barrage on this hex: each counter on its own, then combinations that
 * fire together. A combination pays either through one dump every battery can draw, or through a
 * common Army HQ (OCS 12.7).
 */
export function artilleryDraft(state, side, target, data, preferredIds = []) {
  const reason = barrageTargetReason(state, side, target, data)
  if (reason) return { target, available: false, reason, rows: [], batteries: [] }
  const ledger = scorpionSpPayment(state, side, data.assets.map, data.board?.supplyRail)
  const fired = scorpionPhaseBarrages(state).flatMap((event) => event.batteries)
  const batteries = Object.keys(state.units).map((unitId) => ({ unitId,
    ...batteryEntry(state, side, unitId, target, fired) })).filter((entry) => entry.ok)
  if (!batteries.length) return { target, available: false, reason: '没有可参射的炮兵', rows: [], batteries: [] }
  const hqs = Object.keys(state.units).filter((id) => state.units[id].side === side && state.units[id].headquarters &&
    !state.units[id].headquarters.kessel)
  const strength = (volley) => volley.reduce((total, { unitId, re }) => {
    const entry = batteries.find((candidate) => candidate.unitId === unitId)
    // An independent battery may fire part of its RE; `re` is absent for the one-RE-per-phase counters.
    const firing = re ?? entry.remaining
    return total + entry.face.strength * firing / (entry.face.independentRe ? entry.unit.printedRe : 1) *
      (entry.unit.disorganized ? 0.5 : 1)
  }, 0)
  const sourcesOf = (unitId, via) => ledger.available([state.units[unitId]], false).map(({ dumpId }) => dumpId)
    .filter((dumpId) => ledger.canUse(state.units[unitId], dumpId, via ? { headquartersId: via } : {}))
  const splitOver = (dumpIds, cost) => {
    const balances = new Map(dumpIds.map((id) => [id, ledger.source(id).tokens]))
    let left = cost
    const payments = []
    for (const [dumpId, tokens] of balances) {
      const spend = Math.min(left, tokens)
      if (!spend) continue
      payments.push({ dumpId, tokens: spend })
      left -= spend
      if (!left) break
    }
    return left ? null : payments
  }
  const rows = []
  const offer = (volley, route) => {
    const total = strength(volley)
    if (total < 1) return
    const { initialColumn, cost } = barrageColumn(data.board.barrage, total)
    // OCS 12.7: several dumps may back one volley only through a single deliverable HQ. Without an HQ
    // the whole column cost comes off one shared dump (scorpion-barrage.ts re-checks this).
    const payments = route.hqId ? splitOver(route.dumpIds, cost)
      : route.dumpIds.filter((dumpId) => ledger.source(dumpId).tokens >= cost).slice(0, 1)
        .map((dumpId) => [{ dumpId, tokens: cost }])[0]
    if (!payments) return
    const price = route.hqId ? `司令部 ${state.units[route.hqId].hex} 投送` : `${route.dumpIds[0].split(':').at(-1)} 支付`
    rows.push({ label: `炮击 ${target} · ${volley.length} 门 · ${cost}T · ${price}`, strength: total, initialColumn, cost,
      fields: { target, batteries: volley, supply: route.hqId ? { kind: 'hq', hqId: route.hqId, payments } : { kind: 'direct', payments } } })
  }
  const counter = ([unitId]) => ({ unitId, ...(batteries.find((entry) => entry.unitId === unitId).face.independentRe
    ? { re: batteries.find((entry) => entry.unitId === unitId).remaining } : {}) })
  for (const { unitId } of batteries) {
    const volley = [counter([unitId])]
    for (const dumpId of sourcesOf(unitId)) offer(volley, { dumpIds: [dumpId] })
  }
  const preferred = preferredIds.filter((id) => batteries.some((entry) => entry.unitId === id))
  const ordered = [...preferred, ...batteries.map(({ unitId }) => unitId).filter((id) => !preferred.includes(id))]
  if (ordered.length > 1) for (let count = Math.min(ordered.length, 4); count >= 2 && rows.length < LIMIT; count--) {
    const volley = ordered.slice(0, count).map((id) => counter([id]))
    const ids = volley.map(({ unitId }) => unitId)
    const shared = sourcesOf(ids[0]).filter((dumpId) => ids.every((id) => sourcesOf(id).includes(dumpId)))
    // OCS 12.7 lets the volley be paid several dumps at once only through one HQ, so a direct row needs a
    // single shared dump that covers the whole column. Both routes are offered when both are legal.
    if (shared.length) offer(volley, { dumpIds: shared })
    for (const hqId of hqs) {
      const via = ids.map((id) => sourcesOf(id, hqId)).filter((dumpIds) => dumpIds.length)
      if (via.length === ids.length) offer(volley, { hqId, dumpIds: [...new Set(via.flat())] })
    }
  }
  return { target, available: rows.length > 0, reason: rows.length ? undefined : '没有合规的补给来源',
    batteries: batteries.map(({ unitId }) => unitId), rows: rows.slice(0, LIMIT) }
}

/** Why this front's marker cannot be spent now, or null when it can. */
export function frontMarkerReason(state, side, front) {
  if (side !== 'soviet') return '只有苏军使用方面军炮兵弹幕标记'
  if (!scorpionBarrageFronts.includes(front)) return '不是苏军方面军'
  if (state.barrage) return '已有一次射击待结算'
  if (state.cursor.turn !== 1) return '本作只在第 1 回合可用'
  if (state.cursor.phasing !== side) return '只在苏军回合放置'
  if (state.cursor.phase !== 'movement') return '只在第 1 回合的移动阶段放置'
  if (state.barrageRecovery?.[front]) return '这枚标记已翻面，正在恢复格'
  return null
}

/** Front barrage draft, entered from the marker on the Soviet aid card: the centers the marker may
 * occupy, the Army HQ that must throw supply to it, and the targets each volley may strike.
 */
export function frontBarrageDraft(state, side, data, front, center) {
  const reason = frontMarkerReason(state, side, front)
  if (reason) return { front, available: false, reason, centers: [], hqs: [], rows: [] }
  const { map } = data.assets
  const network = scorpionSupplyNetwork(map, scorpionSupplyPosition(state, map, side, data.board?.supplyRail))
  const hqs = Object.entries(state.units).filter(([, unit]) => unit.side === side && unit.headquarters && !unit.headquarters.kessel)
    .map(([id, unit]) => ({ id, hex: unit.hex }))
  // The marker lands next to a Soviet combat unit inside its own sector, within an Army HQ's throw
  // range; those hexes are the only centers worth listing.
  const friendly = Object.values(state.units).filter((unit) => unit.side === side && unit.combat).map((unit) => unit.hex)
  const centers = [...new Set(friendly.flatMap((hex) => [hex, ...map.neighbors(hex)])).values()]
    .filter((hex) => map.hexes.has(hex) && scorpionBarrageFrontAt(hex) === front)
  const at = center && map.hexes.has(center) && scorpionBarrageFrontAt(center) === front &&
    centers.includes(center) ? center : undefined
  if (!at) return { front, available: false, reason: centers.length ? '选择中心格' : '没有可放置标记的中心格', centers, hqs, rows: [] }
  const supports = hqs.filter(({ id }) => network.inThrowRange(id, at))
  if (!supports.length) return { front, available: false, reason: '中心格不在任何 Army HQ 的投送范围', centers, hqs, rows: [] }
  const fired = scorpionPhaseBarrages(state).flatMap((event) => event.batteries)
  const struck = scorpionRegularBarrageTargets(state)
  const targets = [at, ...map.neighbors(at)].filter((hex) => map.hexes.has(hex) && targetUnits(state, enemyOf(side), hex).length &&
    !struck.has(hex))
  const fired_ids = Object.keys(state.units).map((unitId) => ({ unitId, ...batteryEntry(state, side, unitId, at, fired) }))
    .filter((entry) => entry.ok)
  if (!fired_ids.length) return { front, available: false, reason: '没有可参射的炮兵', centers, hqs: supports, rows: [] }
  // TTW 3.4a: every firing battery must sit in one hex or one contiguous group of hexes, and no counter
  // may fire more RE in the whole mission than it has left. Both are re-checked by declareFront.
  const hexesOf = (ids) => new Set(ids.map((id) => state.units[id].hex))
  const contiguous = (ids) => {
    const hexes = hexesOf(ids)
    const [first] = [...hexes]
    const seen = new Set([first])
    for (const hex of seen) for (const neighbor of map.neighbors(hex)) if (hexes.has(neighbor)) seen.add(neighbor)
    return seen.size === hexes.size
  }
  const clusters = []
  for (const entry of fired_ids) {
    const cluster = clusters.find((group) => contiguous([...group, entry.unitId]))
    if (cluster) cluster.push(entry.unitId)
    else clusters.push([entry.unitId])
  }
  const rows = []
  // One RE from every battery in the cluster on each volley, so each volley is its whole group firing
  // together and the RE accounting never overlaps between volleys.
  const volleyFor = (ids, left, target) => ids.filter((id) => (left.get(id) ?? 0) >= 1)
    .map((id) => { left.set(id, left.get(id) - 1); return { unitId: id, re: 1 } })
  for (const ids of clusters) {
    for (const { id: hqId } of supports) {
      const left = new Map(ids.map((id) => [id, fired_ids.find((entry) => entry.unitId === id).remaining]))
      const volleys = []
      // The marker's own hex is struck first, then the adjacent stacks, up to the two-hex limit.
      for (const target of targets.slice(0, 3)) {
        const volley = volleyFor(ids, left, target)
        if (!volley.length) break
        volleys.push({ target, batteries: volley })
      }
      if (volleys.length) rows.push({
        label: `方面军炮击 · 中心 ${at} + ${volleys.length - 1} 个相邻目标 · ${state.units[hqId].hex} 司令部支持 · 免补给`,
        fields: { front, center: at, hqId, volleys } })
    }
  }
  return { front, available: rows.length > 0,
    reason: rows.length ? undefined : '中心或相邻格没有可射击目标，或没有可参射炮兵',
    centers, hqs: supports, targets, firing: fired_ids.map(({ unitId }) => unitId), rows: rows.slice(0, LIMIT) }
}

export const artilleryChoices = (draft) => draft?.available ? draft.rows.map(({ label, fields }) =>
  ({ label, type: 'declare-artillery-barrage', ...fields })) : []
export const frontChoices = (draft) => draft?.available ? draft.rows.map(({ label, fields }) =>
  ({ label, type: 'declare-front-barrage', ...fields })) : []
