// 剧本 01 初设盘面：把 774 条固定初设、104 架飞机、固定标记与
// 可选池的测试放置装成 CampaignMatchOpening。这里不启动整局 63 回合，
// 只给 P2/P3 局部/首回合夹具一块已经初设完成的真实盘面。
// 可选池（5 SP、2 SP、5 刺猬、12 Truck/14 Wagon、1 罗要塞）原文未指定格，
// 此函数采用显式、可复核的测试放置；不是历史唯一解。

import type { Side } from '@ocs-eastern/series/state-types'
import { tryCampaignHexKey } from '../import/hex-id.ts'
import type { TtwCampaignMapIndex } from '../import/campaign-map-index.ts'
import type { Definition } from '../import/unit-catalog.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { CampaignMatchOpening } from './campaign-match.ts'
import type { CampaignCounter } from './campaign-reinforcement-state.ts'
import type { CampaignHedgehog } from './campaign-hedgehogs.ts'
import type { CampaignAirBase } from './campaign-airfield.ts'
import type { CampaignFortress } from './campaign-fortress.ts'

interface DnieperSetupData {
  setup: ReturnType<typeof import('../import/campaign-setup.ts').prepareCampaignSetup>
  setupRaw: Record<string, unknown>
  catalog: Awaited<ReturnType<typeof import('../import/unit-v2.ts').loadThirdWinterV2Units>>
  map: TtwCampaignMapIndex
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid 01 setup row')
  return value as Record<string, unknown>
}

function rows(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Missing 01 setup rows')
  return value.map(record)
}

function setupCounter(definition: Definition<BackupUnit> | undefined, side: Side, hex: string): CampaignCounter {
  if (!definition || definition.source.side !== side ||
    (definition.kind !== 'land' && definition.kind !== 'hq' && definition.kind !== 'transport' &&
      definition.kind !== 'air-army-hq' && definition.kind !== 'luftflotte-hq')) {
    throw new Error(`Invalid 01 ground definition for ${side}`)
  }
  const re = definition.kind === 'air-army-hq' || definition.kind === 'luftflotte-hq' ? 0 : definition.source.re
  if (typeof re !== 'number' || !Number.isFinite(re) || re < 0) throw new Error(`Invalid 01 RE: ${definition.key}`)
  return { definition: definition.key, side, kind: definition.kind, location: { kind: 'map', hex },
    stepsLost: 0, currentRe: re, mode: 'combat' }
}

function hexOf(map: TtwCampaignMapIndex, hex: unknown, label: string) {
  if (typeof hex !== 'string') throw new Error(`Missing ${label} hex`)
  const key = tryCampaignHexKey(hex)
  const resolved = key ? map.canonicalByHex.get(key) : undefined
  if (!resolved) throw new Error(`${label} hex is outside the 01 map: ${hex}`)
  return resolved
}

function markerHex(map: TtwCampaignMapIndex, marker: Record<string, unknown>, label: string) {
  if (typeof marker.hex === 'string') return hexOf(map, marker.hex, label)
  if (marker.at === null || typeof marker.at !== 'object' || Array.isArray(marker.at)) throw new Error(`Missing ${label} hex`)
  const at = record(marker.at)
  return hexOf(map, `${String(at.map)}${String(at.col)}.${String(at.row)}`, label)
}

/** Build a fully populated Scenario 01 opening for local mechanism/first-turn tests. */
export function prepareDnieperBoard(data: DnieperSetupData, date = '1943-09-26'): CampaignMatchOpening {
  const { setup, setupRaw, catalog, map } = data
  const counters: Record<string, CampaignCounter> = {}
  const add = (id: string, counter: CampaignCounter) => {
    if (Object.hasOwn(counters, id)) throw new Error(`Duplicate 01 counter: ${id}`)
    counters[id] = counter
  }

  for (const row of setup.counters) {
    const definition = catalog.definitions.get(row.definition)
    if (!definition) throw new Error(`Unknown 01 setup definition: ${row.definition}`)
    if (row.kind === 'aircraft') {
      add(row.id, { definition: row.definition, kind: 'aircraft', side: row.side,
        location: { kind: 'map', hex: row.hex }, active: true, stepsLost: row.stepsLost })
    } else {
      add(row.id, { ...setupCounter(definition, row.side, row.hex), stepsLost: row.stepsLost })
    }
  }

  const bases: CampaignAirBase[] = []
  for (const marker of rows(setupRaw.markers)) {
    if (typeof marker.ref !== 'string' || !/^Airbase Strength [123]$/.test(marker.ref)) continue
    if (marker.side !== 'axis' && marker.side !== 'soviet') throw new Error('Invalid 01 airbase side')
    const at = record(marker.at)
    const hex = hexOf(map, `${String(at.map)}${String(at.col)}.${String(at.row)}`, 'airbase')
    const level = Number(marker.ref.at(-1))
    bases.push({ hex, side: marker.side, level })
  }
  const bySide = { axis: bases.filter((base) => base.side === 'axis'), soviet: bases.filter((base) => base.side === 'soviet') }
  if (!bySide.axis.length || !bySide.soviet.length) throw new Error('01 setup has no airbase for a side')

  for (const [index, entry] of rows(setupRaw.air).entries()) {
    const ref = entry.ref
    const match = catalog.aliases.get(String(ref))?.find((definition) => definition.kind === 'aircraft')
    if (!match) throw new Error(`Unresolved 01 aircraft: ${String(ref)}`)
    const side = match.source.side
    if (side !== 'axis' && side !== 'soviet') throw new Error('01 aircraft has no side')
    const requested = entry.entry === 'any_airbase' ? undefined : hexOf(map, entry.entry, 'aircraft base')
    const base = requested ?? bySide[side][index % bySide[side].length]!.hex
    add(`01-air:${index + 1}`, { definition: match.key, kind: 'aircraft', side,
      location: { kind: 'map', hex: base }, active: true, stepsLost: entry.reduced === true ? 1 : 0 })
  }

  const supplyDumps: Record<Side, Record<string, number>> = { axis: {}, soviet: {} }
  const initialHedgehogs: Record<string, CampaignHedgehog> = {}
  for (const row of setup.initialHedgehogs) initialHedgehogs[row.hex] = { side: row.side, level: row.level }
  for (const marker of rows(setupRaw.markers)) {
    if (typeof marker.ref !== 'string' || (marker.side !== 'axis' && marker.side !== 'soviet')) continue
    const at = marker.at == null ? undefined : record(marker.at)
    if (!at) continue
    const hex = hexOf(map, `${String(at.map)}${String(at.col)}.${String(at.row)}`, 'marker')
    if (marker.ref === 'Supply Point') {
      supplyDumps[marker.side][hex] = (supplyDumps[marker.side][hex] ?? 0) + 4 * Number(marker.count)
    } else if (/^Supply Ton ([1-3])T$/.test(marker.ref)) {
      supplyDumps[marker.side][hex] = (supplyDumps[marker.side][hex] ?? 0) +
        Number(/^Supply Ton ([1-3])T$/.exec(marker.ref)?.[1]) * Number(marker.count)
    }
  }

  // The scenario text leaves these pools "any"; use real, named hexes and mark them
  // as test placements. They are not a claim about the historical deployment.
  const optionalCities = ['B41.06', 'B42.06', 'B3.24', 'B4.23'].map((hex) => hexOf(map, hex, 'city'))
  // Map B prints the Dnepr as the major river class (D-map uses dnieper); the pool
  // condition is therefore "adjacent to a B-map major-river edge".
  const bMajor = [...map.onMapHexes].filter((hex) => {
    if (!hex.startsWith('B')) return false
    return map.neighbors(hex).some((to) => map.connection(hex, to)?.sourceEdges.some((edge) => edge.river_class === 'major'))
  }).sort()
  const freeMajor = bMajor.filter((hex) => !initialHedgehogs[hex])
  if (freeMajor.length < 6) throw new Error('01 B-map Dnepr pool has fewer than six free test hexes')
  const optionalHedgehogs = freeMajor.slice(0, 5)
  for (const [index, hex] of optionalHedgehogs.entries()) {
    initialHedgehogs[hex] = { side: 'axis', level: 1 }
    if (index === 0) supplyDumps.axis[hex] = (supplyDumps.axis[hex] ?? 0) + 8
  }
  const sovietHq = Object.values(setup.counters).filter((row) => row.side === 'soviet' &&
    ['front', 'army'].includes(catalog.definitions.get(row.definition)?.source.hqKind ?? ''))
    .sort((a, b) => Number(catalog.definitions.get(b.definition)?.source.hqKind === 'front') -
      Number(catalog.definitions.get(a.definition)?.source.hqKind === 'front'))
  if (sovietHq.length < 5) throw new Error('01 has fewer than five Soviet Front/Army HQ supply sites')
  for (const row of sovietHq.slice(0, 5)) {
    supplyDumps.soviet[row.hex] = (supplyDumps.soviet[row.hex] ?? 0) + 4
  }

  const truck = catalog.aliases.get('Axis Truck')?.find((definition) => definition.kind === 'transport')
  const wagon = catalog.aliases.get('Axis Wagon')?.find((definition) => definition.kind === 'transport')
  if (!truck || !wagon) throw new Error('Missing 01 Axis Truck/Wagon definitions')
  for (let index = 0; index < 12; index += 1) {
    add(`01-optional:truck:${index + 1}`, { definition: truck.key, kind: 'transport', side: 'axis',
      location: { kind: 'map', hex: optionalCities[index % optionalCities.length]! }, mode: 'combat', currentRe: 0,
      transportPoints: 1, transportCargoTokens: 0 })
  }
  for (let index = 0; index < 14; index += 1) {
    add(`01-optional:wagon:${index + 1}`, { definition: wagon.key, kind: 'transport', side: 'axis',
      location: { kind: 'map', hex: optionalCities[index % optionalCities.length]! }, mode: 'combat', currentRe: 0,
      transportPoints: 1, transportCargoTokens: 0 })
  }

  const alertPool = rows(record(setupRaw.pools).alert)
  const draws = rows(setupRaw.random_draws)
  for (const [index, draw] of draws.entries()) {
    if (draw.side !== 'axis' || draw.pool !== 'alert') throw new Error('Unexpected 01 setup draw')
    const pool = alertPool[index % alertPool.length]!
    const def = catalog.aliases.get(String(pool.ref))?.find((definition) => definition.kind === 'land')
    if (!def) throw new Error(`Missing 01 Alert definition: ${String(pool.ref)}`)
    add(`01-alert:${index + 1}`, { ...setupCounter(def, 'axis', hexOf(map, draw.hex, 'alert')), definition: def.key })
  }

  const initialRailheadMarkers = rows(setupRaw.markers).filter((marker) => marker.ref === 'Railhead')
    .map((marker) => ({ side: marker.side as Side, hex: markerHex(map, marker, 'railhead') }))
  const fortresses: CampaignFortress[] = [{ city: 'Poltava', hexes: ['B41.06', 'B42.06'].map((hex) => hexOf(map, hex, 'Poltava')),
    sinceTurn: 1 }]
  const rumFortress = catalog.aliases.get('Rum Fortress')?.find((definition) => definition.kind === 'land' &&
    definition.source.side === 'axis')
  if (!rumFortress) throw new Error('Missing 01 Rumanian fortress definition')
  const rumHex = hexOf(map, 'D24.06', 'Rumanian fortress')
  add('01-optional:rum-fortress', setupCounter(rumFortress, 'axis', rumHex))
  fortresses.push({ city: 'Homostayivka', hexes: [rumHex], sinceTurn: 1 })
  const rvgkMarkers: Record<string, string> = {}
  for (const marker of rows(setupRaw.markers)) {
    if (typeof marker.ref !== 'string' || !/^RVGK-[12] Marker$/.test(marker.ref)) continue
    const at = record(marker.at)
    rvgkMarkers[marker.ref.startsWith('RVGK-1') ? 'rvgk-1' : 'rvgk-2'] =
      hexOf(map, `${String(at.map)}${String(at.col)}.${String(at.row)}`, 'RVGK marker')
  }

  return { when: { scenarioId: '01-dnepr-battles', date }, turn: 1,
    opening: { weather: { ground: 'dry', flight: 'normal' }, first: 'soviet' },
    counters, supplyDumps, hedgehogs: initialHedgehogs, airBases: bases, fortresses, rvgkMarkers,
    ...(initialRailheadMarkers.length ? { initialRailheadMarkers } : {}) }
}
