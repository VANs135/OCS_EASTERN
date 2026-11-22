import type { Side } from '@ocs-eastern/series/state-types'
import { kirovogradDates, kirovogradOpening, kirovogradRadiusCenters, kirovogradScenario } from '../ttw/campaign/kirovograd.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../ttw/campaign/play-area.ts'
import { indexTtwCampaignMap } from './campaign-map-index.ts'
import { prepareCampaignReinforcements } from './campaign-reinforcements.ts'
import { resolveCampaignReference } from './campaign-reference.ts'
import { prepareCampaignSetup } from './campaign-setup.ts'
import { campaignTerrain } from './campaign-terrain.ts'
import { loadThirdWinterV2Units } from './unit-v2.ts'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Kirovograd scenario row')
  return value as Record<string, unknown>
}

function rows(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Missing Kirovograd scenario rows')
  return value.map(record)
}

/** Prepare the current scenario files without making player setup choices or changing sources. */
export async function loadKirovogradScenario(read: (...parts: string[]) => Promise<unknown>) {
  const [hexes, edges, catalog, rawSetup, arrivals, rawObjectives] = await Promise.all([
    read('地图数据库', 'map_hexes.json'), read('地图数据库', 'map_edges.json'), loadThirdWinterV2Units((file) => read('data', file)),
    read('scenarios', kirovogradScenario, 'setup.json'), read('scenarios', kirovogradScenario, 'reinforcements.json'),
    read('scenarios', kirovogradScenario, 'objectives.json'),
  ])
  const data = record(rawSetup)
  if (record(data.meta).id !== 9) throw new Error('Expected TTW scenario 09 setup')
  const geometry = indexTtwCampaignMap(hexes, edges)
  const map = campaignMapInPlayArea(geometry, ttwCampaignPlayArea(kirovogradScenario)!)
  const terrain = campaignTerrain(map)
  const setup = prepareCampaignSetup(data, catalog.aliases, geometry, map)
  const reinforcement = prepareCampaignReinforcements(arrivals, catalog.aliases, geometry, map)
  if (reinforcement.entries.some(({ turn, date }) => kirovogradDates[turn - 1] !== date)) throw new Error('Kirovograd reinforcement date disagrees with its turn')
  const placements = setup.counters.flatMap(({ id, printedHex, hex, side }) => side === 'axis' && kirovogradRadiusCenters.has(printedHex)
    ? [{ id, center: hex, choices: [hex, ...map.neighbors(hex)] }] : [])

  const supplyDumps: Record<Side, Record<string, number>> = { axis: {}, soviet: {} }
  const otherMarkers = []
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
      reduced: entry.reduced === true, availableThrough: side === 'axis' ? 5 : 3 }
  })

  const alertPool = rows(record(data.pools).alert).map(({ ref, count }) => {
    if (typeof ref !== 'string' || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid Kirovograd alert pool')
    const match = resolveCampaignReference(catalog.aliases, ref, 'axis')
    if (!('definition' in match) || !match.definition.source.abilities?.includes('alert_battalion')) throw new Error(`Unresolved Kirovograd alert: ${ref}`)
    return { ref, definition: match.definition.key, count }
  })
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
  return { map, terrain, opening: kirovogradOpening, dates: kirovogradDates, catalog, setup, placements, supplyDumps, otherMarkers,
    aircraft, alertPool, reinforcement, victory, diagnostics: { missingTerrain, unresolvedCrossings: [...unresolvedCrossings],
      provisionalRivers: [...provisionalRivers] } }
}
