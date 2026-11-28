// 剧本 01 初设盘面：固定初设逐条拷贝；原文写"任意"的池子变成显式选择。
// 默认选择是复核过的一键预设，玩家仍可按同一候选集改放，预设不是历史唯一解。
// 这里不启动整局 63 回合，只给 P2/P3 局部/首回合夹具一块真实盘面。

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
import {
  buildCampaignOpeningChoices,
  resolveCampaignOpeningChoices,
} from './campaign-opening-choices.ts'
import type { CampaignOpeningChoice, CampaignOpeningChoicePlacements } from './campaign-opening-choices.ts'

interface DnieperSetupData {
  setup: ReturnType<typeof import('../import/campaign-setup.ts').prepareCampaignSetup>
  setupRaw: Record<string, unknown>
  catalog: Awaited<ReturnType<typeof import('../import/unit-v2.ts').loadThirdWinterV2Units>>
  map: TtwCampaignMapIndex
  playable?: { availableHexes: ReadonlySet<string> }
}

export interface DnieperOpeningOptions {
  date?: string
  /** Omit any choice to keep its reviewed preset; submit only the ones the player changes. */
  placements?: CampaignOpeningChoicePlacements
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

function transportDefinition(catalog: DnieperSetupData['catalog'], side: Side, ref: string) {
  const sourceId = ref === 'Truck Points'
    ? (side === 'soviet' ? 'tp_013' : 'tp_003')
    : (side === 'soviet' ? 'tp_011' : 'tp_001')
  const definition = [...catalog.definitions.values()].find((candidate) =>
    candidate.kind === 'transport' && candidate.sourceId === sourceId)
  if (!definition || definition.source.side !== side) throw new Error(`Missing 01 fixed transport definition: ${ref}`)
  return definition
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

/** The player-facing choice list; preset is one-click, candidates are the legal set. */
export function dnieperOpeningChoices(data: DnieperSetupData): CampaignOpeningChoice[] {
  const { setup, setupRaw, catalog, map } = data
  const rumKey = tryCampaignHexKey('D24.06')
  const rumHex = rumKey ? map.canonicalByHex.get(rumKey) : undefined
  const transportCities = ['B41.06', 'B42.06', 'B3.24', 'B4.23'].map((hex) => hexOf(map, hex, 'transport city'))
  return buildCampaignOpeningChoices(record(setupRaw.pools), {
    aliases: catalog.aliases,
    definitions: catalog.definitions,
    map,
    availableHexes: data.playable?.availableHexes,
    fixedCounters: setup.counters.map(({ side, definition, hex }) => ({ side, definition, hex })),
    fixedHedgehogs: new Set(setup.initialHedgehogs.map(({ hex }) => hex)),
    preferredPreset: {
      ...(rumHex ? { 'setup:fortress:1': [rumHex] } : {}),
      'setup:transport:1': transportCities,
      'setup:transport:2': transportCities,
    },
  })
}

/** Build a fully populated Scenario 01 opening. With no placements this is the reviewed preset. */
export function prepareDnieperBoard(
  data: DnieperSetupData,
  dateOrOptions: string | DnieperOpeningOptions = '1943-09-26',
): CampaignMatchOpening {
  const { setup, setupRaw, catalog, map } = data
  const options: DnieperOpeningOptions = typeof dateOrOptions === 'string'
    ? { date: dateOrOptions } : dateOrOptions
  const date = options.date ?? '1943-09-26'
  const choices = dnieperOpeningChoices(data)
  const placements = resolveCampaignOpeningChoices(choices, options.placements)
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
  let fixedTransportIndex = 0
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
    } else if (marker.ref === 'Truck Points' || marker.ref === 'Wagon Points') {
      const count = Number(marker.count)
      if (!Number.isSafeInteger(count) || count <= 0) throw new Error(`Invalid 01 transport marker count: ${marker.ref}`)
      const definition = transportDefinition(catalog, marker.side, marker.ref)
      for (let copy = 1; copy <= count; copy += 1) {
        fixedTransportIndex += 1
        add(`01-fixed-transport:${fixedTransportIndex}`, { definition: definition.key, kind: 'transport',
          side: marker.side, location: { kind: 'map', hex }, stepsLost: 0, currentRe: 0, mode: 'combat',
          transportPoints: 1, transportCargoTokens: 0 })
      }
    }
  }

  const fortresses: CampaignFortress[] = [{ city: 'Poltava', hexes: ['B41.06', 'B42.06'].map((hex) => hexOf(map, hex, 'Poltava')),
    sinceTurn: 1 }]

  // Apply the resolved choices. A choice is either a token/marker copy, a
  // transport counter group, or a fortress/unit counter plus its city site.
  for (const choice of choices) {
    const hexes = placements[choice.id]!
    if (choice.kind === 'supply') {
      const tokens = choice.tokensPerPlacement ?? 0
      if (tokens < 1) throw new Error(`01 supply choice has no token value: ${choice.id}`)
      for (const hex of hexes) supplyDumps[choice.side][hex] = (supplyDumps[choice.side][hex] ?? 0) + tokens
    } else if (choice.kind === 'hedgehog') {
      for (const hex of hexes) {
        if (initialHedgehogs[hex]) throw new Error(`01 hedgehog choice overlaps a fixed hedgehog: ${hex}`)
        initialHedgehogs[hex] = { side: choice.side, level: choice.level ?? 1 }
      }
    } else {
      const definition = choice.definition ? catalog.definitions.get(choice.definition) : undefined
      if (!definition) throw new Error(`Missing 01 choice definition: ${choice.id}`)
      for (const [index, hex] of hexes.entries()) {
        if (choice.kind === 'transport') {
          if (definition.kind !== 'transport' || definition.source.side !== choice.side) {
            throw new Error(`Invalid 01 transport definition: ${choice.id}`)
          }
          add(`01-optional:${choice.id}:${index + 1}`, { definition: definition.key, kind: 'transport', side: choice.side,
            location: { kind: 'map', hex }, stepsLost: 0, currentRe: 0, mode: 'combat',
            transportPoints: 1, transportCargoTokens: 0 })
        } else {
          add(`01-optional:${choice.id}:${index + 1}`, setupCounter(definition, choice.side, hex))
          if (choice.kind === 'fortress') {
            const city = map.cityOf(hex)
            if (!city) throw new Error(`01 fortress choice is not on a city: ${hex}`)
            fortresses.push({ city: city.city, hexes: [hex], sinceTurn: 1 })
          }
        }
      }
    }
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
