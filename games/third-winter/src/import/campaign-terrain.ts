import type { campaignMapInPlayArea } from '../ttw/campaign/play-area.ts'
import type { TtwVolgaCrossing } from '../ttw/campaign/volga-movement.ts'
import type { TtwOrdinaryCrossing } from '../ttw/ground-terrain.ts'

type PlayableMap = ReturnType<typeof campaignMapInPlayArea>
type DnieperClass = 'major' | 'volga'

/** Normalize printed cell and hexside facts for the movement board. Gauge comes from the scenario. */
export function campaignTerrain(map: PlayableMap, dnieperClass?: (a: string, b: string) => DnieperClass | undefined) {
  function edge(from: string, to: string) {
    const entry = map.connection(from, to)
    return entry?.disputedFields.length === 0 ? entry.sourceEdges[0] : undefined
  }
  function railAt(from: string, to: string) {
    const source = edge(from, to)
    return source?.rail_present && (source.rail_class === 'single' || source.rail_class === 'double') ? source.rail_class : undefined
  }
  function crossingAt(from: string, to: string): TtwOrdinaryCrossing | TtwVolgaCrossing | undefined {
    const source = edge(from, to)
    if (!source || source.river_pending) return undefined
    const rail = railAt(from, to)
    if (source.rail_present && !rail) return undefined
    const routes: ('road' | 'track' | 'rail')[] = rail ? ['rail'] : []
    if (source.road_present) {
      if (source.road_subclass === 'Track') routes.push('track')
      else if (source.road_subclass === 'Secondary Road' || source.road_subclass === 'Primary Road') routes.push('road')
      else return undefined
    }
    if (source.edge_terrain === 'lake' || source.lake_edge === true || source.blocked_kind === 'lake' || source.blocked_kind === 'sea') {
      return { barrier: 'blocked', routes: source.bridge === true ? routes : [] }
    }
    if (source.edge_terrain === 'none' && source.river_class == null) return { barrier: 'none', routes }
    if (source.edge_terrain !== 'river') return undefined
    const river = source.river_class === 'dnieper' ? dnieperClass?.(from, to) : source.river_class
    const crossings = source.bridge === true ? routes : []
    if (river === 'volga') return { barrier: 'volga', bridge: crossings.length ? 'intact' : 'none', routes: crossings }
    if (river === 'minor' || river === 'major') return { barrier: river, routes: crossings }
    return undefined
  }
  return { terrainAt: map.terrainAt, crossingAt, railAt, riverStatus: (from: string, to: string) => edge(from, to)?.river_class_status ?? null }
}
