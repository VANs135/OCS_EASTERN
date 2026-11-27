import type { BarrageTable } from '@ocs-eastern/series/tables/barrage'
import type { Side } from '@ocs-eastern/series/state-types'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { Definition } from '../import/unit-catalog.ts'
import type { CampaignAirStrikeBoard, CampaignAirStrikeProfile } from './campaign-air-strike.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

/** The scenario map also exposes its in-play hex set; range is measured against that set. */
type ScenarioMap = CampaignGroundMap & { availableHexes?: ReadonlySet<string> }

export interface KirovogradAirStrikeSource {
  map: ScenarioMap
  table: BarrageTable
  definitions: ReadonlyMap<string, Definition<BackupUnit>>
}

function numberStat(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function mapDistance(map: CampaignGroundMap, from: string, to: string): number {
  if (from === to) return 0
  if (!map.resolveHex(from) || !map.resolveHex(to)) return Number.POSITIVE_INFINITY
  const queue = [from]
  const seen = new Set(queue)
  let distance = 0
  while (queue.length) {
    distance++
    const width = queue.length
    for (let index = 0; index < width; index++) {
      const hex = queue.shift()!
      for (const next of map.neighbors(hex)) {
        if (next === to) return distance
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return Number.POSITIVE_INFINITY
}

/** Scenario 9 AA units: only one Flak DRM per hex, and only while in Combat Mode. */
function aaDrm(definition: Definition<BackupUnit> | undefined): number {
  const value = definition?.source.faces.combat?.stats.aaMod
  if (typeof value !== 'string') return 0
  const parsed = Number(value.replace(/^\+/, ''))
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

function airProfile(state: Readonly<CampaignTurnState>, id: string, source: KirovogradAirStrikeSource):
CampaignAirStrikeProfile | undefined {
  const counter = Object.hasOwn(state.counters, id) ? state.counters[id] : undefined
  if (!counter || counter.kind !== 'aircraft' || counter.location.kind === 'dead-pile') return undefined
  const definition = source.definitions.get(counter.definition)
  if (!definition) return undefined
  const reduced = (counter.stepsLost ?? 0) > 0
  const face = reduced ? definition.source.faces.move ?? definition.source.faces.combat : definition.source.faces.combat
  const stats = face?.stats
  const airCombat = numberStat(stats?.airCombat)
  const bombing = numberStat(stats?.bombing)
  if (airCombat === undefined || bombing === undefined) return undefined
  return {
    rangeHexes: numberStat(stats?.range) ?? 0,
    printedSteps: definition.source.faces.move ? 2 : 1,
    airCombat,
    bombing,
    fighter: definition.source.abilities?.includes('interception') === true,
    // TTW §2.2a: only Ju.87D has Hip Shoots in 1943-44; Ju.87G is the tank-buster variant.
    hipShoot: counter.side === 'axis' && /Ju\.87D\b/.test(definition.source.name),
    tankBuster: counter.side === 'axis' && /Ju\.87G\b/.test(definition.source.name),
  }
}

/** Bind Scenario 9's actual aircraft definitions, off-map range, AA DRMs and on-map distances. */
export function kirovogradAirStrikeBoard(source: KirovogradAirStrikeSource): CampaignAirStrikeBoard {
  return {
    map: source.map,
    table: source.table,
    distance: (from, to) => mapDistance(source.map, from, to),
    airProfileOf: (state, id) => airProfile(state, id, source),
    // p.62: off-map aircraft can reach every hex on the scenario map.
    rangeHexes: () => source.map.availableHexes?.size ?? Number.MAX_SAFE_INTEGER,
    flakValueAt: (state, hex, side?: Side) => {
      let highest = 0
      for (const counter of Object.values(state.counters)) {
        if ((side && counter.side !== side) || counter.location.kind !== 'map' || counter.location.hex !== hex ||
          counter.mode && counter.mode !== 'combat') continue
        highest = Math.max(highest, aaDrm(source.definitions.get(counter.definition)))
      }
      return highest || undefined
    },
    hedgehogAt: (state, hex) => state.hedgehogs?.[hex]?.level ?? 0,
  }
}
