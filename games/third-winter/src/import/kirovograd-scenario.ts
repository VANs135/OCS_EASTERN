import type { Side } from '@ocs-eastern/series/state-types'
import { kirovogradAircraftThrough, kirovogradCityName, kirovogradDates, kirovogradOpening, kirovogradRadiusCenters,
  kirovogradScenario } from '../ttw/campaign/kirovograd.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../ttw/campaign/play-area.ts'
import { indexTtwCampaignMap } from './campaign-map-index.ts'
import { prepareCampaignReinforcements } from './campaign-reinforcements.ts'
import { resolveCampaignReference } from './campaign-reference.ts'
import { prepareCampaignSetup } from './campaign-setup.ts'
import { campaignTerrain } from './campaign-terrain.ts'
import { campaignHexKey } from './hex-id.ts'
import { loadThirdWinterV2Units } from './unit-v2.ts'
import { readCounterPoolRows } from './counter-pool-rows.ts'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Kirovograd scenario row')
  return value as Record<string, unknown>
}

function rows(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Missing Kirovograd scenario rows')
  return value.map(record)
}

/** The scenario names its city. The map database must print that name on exactly one hex. */
function cityHex(hexTable: unknown, name: string) {
  const items = record(hexTable).items
  if (!Array.isArray(items)) throw new Error('Missing campaign hex table')
  const found: string[] = []
  for (const value of items) {
    const hex = record(value)
    if (hex.city_name === name) {
      if (typeof hex.hex_id !== 'string') throw new Error(`Invalid printed hex for ${name}`)
      found.push(campaignHexKey(hex.hex_id))
    }
  }
  if (found.length !== 1) throw new Error(`Expected one ${name} hex in the map database, found ${found.length}`)
  return found[0]!
}

/** Prepare the current scenario files without making player setup choices or changing sources. */
export async function loadKirovogradScenario(read: (...parts: string[]) => Promise<unknown>) {
  const [hexes, edges, catalog, rawSetup, arrivals, rawObjectives] = await Promise.all([
    read('地图数据库', 'map_hexes.json'), read('地图数据库', 'map_edges.json'), loadThirdWinterV2Units((file) => read('data', file)),
    read('scenarios', kirovogradScenario, 'setup.json'), read('scenarios', kirovogradScenario, 'reinforcements.json'),
    read('scenarios', kirovogradScenario, 'objectives.json'),
  ])
  const data = record(rawSetup)
  const meta = record(data.meta)
  if (meta.id !== 9) throw new Error('Expected TTW scenario 09 setup')
  if (meta.setup_order !== 'axis' && meta.setup_order !== 'soviet') throw new Error('Missing Kirovograd setup order')
  const setupOrder: readonly Side[] = [meta.setup_order, meta.setup_order === 'axis' ? 'soviet' : 'axis']
  const geometry = indexTtwCampaignMap(hexes, edges)
  const map = campaignMapInPlayArea(geometry, ttwCampaignPlayArea(kirovogradScenario)!)
  const kirovogradHex = cityHex(hexes, kirovogradCityName)
  if (!map.resolveHex(kirovogradHex)) throw new Error(`Kirovograd city hex outside scenario area: ${kirovogradHex}`)
  const terrain = campaignTerrain(map)
  const setup = prepareCampaignSetup(data, catalog.aliases, geometry, map)
  const reinforcement = prepareCampaignReinforcements(arrivals, catalog.aliases, geometry, map)
  if (reinforcement.entries.some(({ turn, date }) => kirovogradDates[turn - 1] !== date)) throw new Error('Kirovograd reinforcement date disagrees with its turn')
  const placements = setup.counters.flatMap(({ id, printedHex, hex, side }) => side === 'axis' && kirovogradRadiusCenters.has(printedHex)
    ? [{ id, center: hex, choices: [hex, ...map.neighbors(hex)] }] : [])

  const supplyDumps: Record<Side, Record<string, number>> = { axis: {}, soviet: {} }
  const otherMarkers: { ref: string; side: Side; count: number; hex: string | undefined }[] = []
  for (const entry of rows(data.markers)) {
    const { ref, side, count } = entry
    if (typeof ref !== 'string' || (side !== 'axis' && side !== 'soviet') || typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) {
      throw new Error('Invalid Kirovograd setup marker')
    }
    const at = entry.at == null ? undefined : record(entry.at)
    const hex = at ? map.resolveHex(`${at.map}${at.col}.${at.row}`) : undefined
    if (at && !hex) throw new Error(`Kirovograd marker outside scenario area: ${ref}`)
    const perCounter = ref === 'Supply Point' ? 4 : /^Supply Ton ([1-3])T$/.exec(ref)?.[1]
    if (perCounter !== undefined) {
      if (!hex) throw new Error(`Missing Kirovograd supply hex: ${ref}`)
      supplyDumps[side][hex] = (supplyDumps[side][hex] ?? 0) + Number(perCounter) * count
    } else otherMarkers.push({ ref, side, count, hex })
  }

  // The scenario seats aircraft off-map (p.62). The source entry string is generic.
  const aircraft = rows(data.air).map((entry, index) => {
    const candidates = typeof entry.ref === 'string' ? catalog.aliases.get(entry.ref) ?? [] : []
    const definitions = candidates.filter(({ kind }) => kind === 'aircraft')
    const definition = definitions[0]
    if (definitions.length !== 1 || !definition?.source.side) throw new Error(`Unresolved Kirovograd aircraft at row ${index + 1}`)
    const side = definition.source.side
    return { id: `09-air:${index + 1}`, definition: definition.key, side, entry: 'scenario-off-map' as const,
      reduced: entry.reduced === true, availableThrough: kirovogradAircraftThrough[side] }
  })

  const alertPool = readCounterPoolRows(record(data.pools).alert, (ref) => {
    const match = resolveCampaignReference(catalog.aliases, ref, 'axis')
    if ('definition' in match && match.definition.source.abilities?.includes('alert_battalion')) return match.definition.key
  }, 'Kirovograd alert pool')
  const objectives = record(rawObjectives)
  const terminal = record(objectives.terminal)
  if (objectives.scenario !== '09' || terminal.turn !== kirovogradDates.length) throw new Error('Invalid Kirovograd objective dates')
  const victory = { sources: rows(objectives.vpSources), bands: rows(terminal.bands) }

  const missingTerrain = [...map.availableHexes].filter((hex) => !terrain.terrainAt(hex))
  const unresolvedCrossings = new Set<string>()
  const provisionalRivers = new Set<string>()
  for (const from of map.availableHexes) for (const to of map.neighbors(from)) {
    if (from >= to) continue
    const key = `${from}|${to}`
    if (!terrain.crossingAt(from, to)) unresolvedCrossings.add(key)
    if (terrain.riverStatus(from, to) === 'auto_pending_visual') provisionalRivers.add(key)
  }
  return { map, terrain, opening: kirovogradOpening, dates: kirovogradDates, setupOrder, catalog, setup, placements, supplyDumps, otherMarkers,
    aircraft, alertPool, reinforcement, victory, kirovogradHex, diagnostics: { missingTerrain, unresolvedCrossings: [...unresolvedCrossings],
      provisionalRivers: [...provisionalRivers] } }
}
