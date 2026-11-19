import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionHexDistance } from '../import/hex-id.ts'
import type { UnitArrival } from '../import/scorpion-arrivals.ts'
import { scorpionSupplySources } from '../ttw/scorpion/initial-map.ts'
import { scorpionSupplyNetwork } from '../ttw/scorpion/supply-trace.ts'
import { scorpionControlLookup } from './scorpion-hex-control.ts'
import { scorpionPhaseOccupancy } from './scorpion-phase-occupancy.ts'
import type { ReinforcementBoard } from './scorpion-reinforcement-state.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { scorpionEnemyZoc, scorpionSupplyPosition } from './scorpion-supply-position.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

const supplySources = { axis: new Set(scorpionSupplySources.axis), soviet: new Set(scorpionSupplySources.soviet) }
const other = (side: Side): Side => side === 'axis' ? 'soviet' : 'axis'

function onPerimeter(hex: string) {
  const [column, row] = hex.slice(1).split('.').map(Number)
  return column === 1 || column === 22 || row === 1 || row === 17
}

export function scorpionReinforcementBoard(state: Readonly<ScorpionInPlay>, { map, catalog }: ScorpionSetupAssets,
  arrivals: readonly UnitArrival[], rail?: SupplyRailBoard): ReinforcementBoard {
  const occupied = scorpionPhaseOccupancy(state).occupied
  return {
    catalog: arrivals,
    supplySources,
    controlOf: scorpionControlLookup(state, map),
    arrivalDestinations(entry) {
      const enemy = other(entry.side)
      const blocked = new Set<string>([...occupied[enemy], ...supplySources[enemy]])
      const clear = (hex: string) => map.hexes.has(hex) && !blocked.has(hex)
      const printed = entry.destinations.filter(clear)
      // OCS 13.6b. Printed interior sites have no map-edge substitution.
      const atEdge = entry.destinations.filter(onPerimeter)
      if (printed.length || !atEdge.length) return printed
      const nearby = [...map.hexes.keys()].filter((hex) => onPerimeter(hex) && clear(hex))
        .map((hex) => ({ hex, distance: Math.min(...atEdge.map((from) => scorpionHexDistance(from, hex))) }))
      const closest = Math.min(...nearby.map(({ distance }) => distance))
      return nearby.filter(({ distance }) => distance === closest).map(({ hex }) => hex)
    },
    alertDestinations(counter) {
      if (catalog.definitions.get(counter.definition)?.source.side !== 'axis') return []
      const network = scorpionSupplyNetwork(map, scorpionSupplyPosition(state, map, 'axis', rail))
      const enemyZoc = scorpionEnemyZoc(state, map, 'axis')
      const hexes = Object.values(state.units).filter((unit) => {
        if (unit.side !== 'axis' || !unit.headquarters || !catalog.definitions.get(unit.definition)?.source.name.startsWith('Ge HQ ')) return false
        // TTW 1.7a, 2.3a and 2.4b. Alert battalions also have the Kessel placement exception.
        return unit.headquarters.kessel || (!unit.moveMode && !unit.reserve && !enemyZoc.has(unit.hex) &&
          network.trace(unit.hex, unit.traceDrawMobility).length > 0)
      }).map(({ hex }) => hex)
      return [...new Set(hexes)]
    },
  }
}
