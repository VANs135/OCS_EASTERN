import { airTransportModes } from '@ocs-eastern/series/air-transport'
import { aircraftProfile, inScorpionAirRange } from '../../src/match/scorpion-air-bases.ts'

// 第一批第 5 项：空军按出发基地编组。右键目标格时，候选行按「出发基地」成组出现，每一行写明
// 航程 / 阵营分区 / 装载额度 / 货物，并一次性提交整个编组（unitIds 多机、cargoUnitIds + supplyTokens
// 混装、flightModes 逐机航程模式）。基地用 ScorpionAirBase 形状，与 refit.mjs 的整备基地同构，
// 因此机场批量整备（refit-aircraft）与编组任务读的是同一个基地键。

const canonical = (hex) => String(hex)
export const sameAirBase = (left, right) => Boolean(left && right) && left.kind === right.kind &&
  (left.kind === 'off-map-air' || canonical(left.hex) === canonical(right.hex))

export const baseName = (base) => base.kind === 'off-map-air' ? '地图外空军盒' : base.hex
export const dumpKey = (side, base) => base.kind === 'hex' ? `${side}:hex:${base.hex}` : `${side}:air-box`

/** Where an active aircraft is based, in the same shape the refit draft uses. */
export function airBaseOf(piece) {
  if (piece?.location?.kind === 'off-map-air') return { kind: 'off-map-air' }
  if (piece?.location?.kind === 'hex') return { kind: 'hex', hex: canonical(piece.location.hex) }
  return undefined
}

/** Every base this side may launch from: its airfields plus its own air box. */
export function friendlyLaunchBases(state, side) {
  return [{ kind: 'off-map-air' },
    ...(state.airBases ?? []).filter((base) => base.side === side).map(({ hex }) => ({ kind: 'hex', hex: canonical(hex) }))]
}

/** Active aircraft of this side parked at one base. */
export function groupedAircraft(state, side, base) {
  return (state.pieces ?? []).filter((piece) => piece.kind === 'aircraft' && piece.side === side && piece.active &&
    sameAirBase(airBaseOf(piece), base)).map((piece) => piece.id)
}

/**
 * What one departure base can put over a target hex right now: the aircraft there, their range and
 * Air Army sector, the pooled transport capacity of the loaded ones, and the supply sitting at it.
 */
export function baseGroup(state, side, base, target, data) {
  const ids = groupedAircraft(state, side, base)
  if (!ids.length) return null
  const pieces = ids.map((id) => state.pieces.find((piece) => piece.id === id))
  const profiles = pieces.map((piece) => aircraftProfile(piece, data.assets))
  const inRange = ids.filter((id, index) => inScorpionAirRange(base, target, profiles[index].range))
  if (!inRange.length) return null
  const range = Math.min(...profiles.map(({ range }) => range))
  const sectors = [...new Set(profiles.flatMap(({ airArmy }) => airArmy === null ? [] : [airArmy]))]
  const capacity = profiles.reduce((total, { transport }) => total + transport * airTransportModes.normal.capacity, 0)
  const supply = state.dumps?.[dumpKey(side, base)]?.tokens ?? 0
  const fighter = profiles.some(({ fighter }) => fighter)
  return { base, ids, inRange, range, sectors, capacity, supply, fighter,
    tankBuster: profiles.some(({ tankBuster }) => tankBuster),
    label: `${baseName(base)} · 航程 ${range} · 分区 ${sectors.length ? sectors.join('/') : '不限'} · 装载 ${capacity} · 货物 ${supply}T` }
}

/** Field conditions the rule layer also enforces before a mission may launch. */
export const canFly = (state) => !state.combat && !state.airMission &&
  state.turn?.weather?.flight !== 'none'

/**
 * The grouped offers for a target hex. Every row carries the whole base group, so a player picks a
 * base and a mission, not a plane; the row label states range, sector, capacity and cargo.
 */
export function airGroupChoices(state, side, target, data, add) {
  if (!canFly(state) || target.kind !== 'hex') return []
  const groups = friendlyLaunchBases(state, side)
    .map((base) => baseGroup(state, side, base, target, data)).filter(Boolean)
  const enemyCombat = Object.values(state.units ?? {}).some((unit) => unit.side !== side && unit.combat && unit.hex === target.hex)
  const enemyBase = (state.airBases ?? []).some((base) => base.side !== side && canonical(base.hex) === canonical(target.hex))
  const friendlyHere = (state.airBases ?? []).some((base) => base.side === side && canonical(base.hex) === canonical(target.hex))
  const labels = []
  const push = (label, mission, fields) => { labels.push(label); add(label, 'launch-air-mission', { mission, target, ...fields }) }
  for (const group of groups) {
    const { base, inRange, label, capacity, supply, fighter } = group
    const profile = (id) => aircraftProfile(state.pieces.find((piece) => piece.id === id), data.assets)
    if (enemyCombat) {
      const bombers = inRange.filter((id) => !profile(id).tankBuster).slice(0, 4)
      if (bombers.length) push(`对地轰炸 ${target.hex} · ${label}`, 'barrage', { unitIds: bombers, targetKind: 'units' })
      if (fighter) push(`低空扫射 ${target.hex} · ${label}`, 'hip-shoot', { unitIds: [inRange[0]] })
    }
    if (enemyBase) {
      const sweepers = inRange.filter((id) => profile(id).fighter)
      if (sweepers.length) push(`战斗机扫荡 ${target.hex} · ${label}`, 'fighter-sweep', { unitIds: [sweepers[0]] })
      push(`轰炸机场 ${target.hex} · ${label}`, 'barrage', { unitIds: inRange.slice(0, 4), targetKind: 'air-base' })
    }
    // Unit and supply cargo load together from the same base, so a single row mixes them. Flight
    // range modes are per aircraft and the draft keeps them equal across the group.
    const cargo = Object.keys(state.units ?? {}).filter((id) => state.units[id]?.side === side && state.units[id]?.combat &&
      state.units[id]?.hex === base.hex && state.units[id]?.moveMode)
    for (const mode of base.kind === 'off-map-air' ? ['double-capacity'] : ['normal', 'double-capacity', 'extended']) {
      if (airTransportModes[mode].stay && !friendlyHere) continue
      const cap = Math.min(supply, Math.floor(capacity * airTransportModes[mode].capacity))
      const unitIds = inRange.slice(0, 4)
      const flightModes = unitIds.map((id) => ({ id, mode }))
      for (let supplyTokens = 0; supplyTokens <= cap; supplyTokens++) {
        if (!supplyTokens && !cargo.length) continue
        const fields = { unitIds, supplySource: base, supplyTokens, flightModes, ...(cargo.length ? { cargoUnitIds: cargo } : {}) }
        const cargoLabel = `空运 ${supplyTokens}T${cargo.length ? ` + ${cargo.length} 枚部队` : ''} 到 ${target.hex} · ${label}`
        if (friendlyHere) push(cargoLabel, 'transport', fields)
        if (!airTransportModes[mode].stay) push(cargoLabel.replace('空运', '空投'), 'air-drop', fields)
      }
    }
  }
  return labels
}
