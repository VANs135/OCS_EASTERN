import type { Side } from '@ocs-eastern/series/state-types'
import type { ScorpionArrival } from '../ttw/scorpion/arrival.ts'
import type { Definition } from './unit-catalog.ts'

export interface ArrivalBlock {
  turn: number
  phase: string
  side: Side
  entries: readonly { ref: string; entry: string | readonly string[]; face?: string; vp_cost?: number; note?: string }[]
}

export interface UnitArrival extends ScorpionArrival {
  definition: string
  face?: string
  note?: string
  organicTruck?: 'full' | 'empty'
}

export const scorpionFixedSupply = [
  { turn: 1, side: 'soviet', sp: 2, destinations: ['s22.02'], page: 55 },
  { turn: 3, side: 'axis', sp: 2, destinations: ['s1.03', 's1.06', 's7.01'], page: 56 },
] as const

const optionalTrucks = [
  { turn: 2, side: 'soviet', ref: 'Sov 5.Gd Cav Truck', entry: 's22.09', load: 'empty' },
  { turn: 4, side: 'axis', ref: 'Ge 24.Pz Truck', entry: 's15.01', load: 'full' },
] as const

/** Read the published list and resolve the legacy JSON's unit references through TTW's catalog. */
export function scorpionArrivalCatalog(
  blocks: readonly ArrivalBlock[],
  aliases: ReadonlyMap<string, readonly Definition[]>,
): UnitArrival[] {
  const arrivals: UnitArrival[] = []
  const ids = new Set<string>()
  const optionalBySide = { axis: 'axis-24-panzer', soviet: 'soviet-5-guards-cavalry' } as const

  function add(side: Side, turn: number, row: ArrivalBlock['entries'][number], organicTruck?: 'full' | 'empty') {
    const matches = aliases.get(row.ref)
    const definition = matches?.length === 1 ? matches[0] : undefined
    if (!definition) throw new Error(`Scorpion arrival reference does not resolve: ${row.ref}`)
    const destinations = typeof row.entry === 'string' ? [row.entry] : row.entry
    if (destinations.length === 0 || destinations.some((hex) => !/^s\d+\.\d{2}$/.test(hex))) {
      throw new Error(`Invalid entry location for ${row.ref}`)
    }
    if (row.vp_cost !== undefined && row.vp_cost !== 5) throw new Error(`Invalid VP cost for ${row.ref}`)
    const id = `${turn}:${side}:${definition.key}`
    if (ids.has(id)) throw new Error(`Duplicate Scorpion arrival: ${row.ref}`)
    ids.add(id)
    arrivals.push({
      id, side, turn, destinations, definition: definition.key, face: row.face, note: row.note, organicTruck,
      optionalForce: row.vp_cost === 5 ? optionalBySide[side] : undefined,
    })
  }

  for (const block of blocks) {
    if (block.phase !== 'reinforce' || !Number.isInteger(block.turn) || block.turn < 1 || block.turn > 8) {
      throw new Error('Invalid Scorpion reinforcement block')
    }
    for (const row of block.entries) {
      const truck = optionalTrucks.find(({ side, turn, ref }) =>
        side === block.side && turn === block.turn && ref === row.ref,
      )
      add(block.side, block.turn, truck ? { ...row, vp_cost: 5 } : row, truck?.load)
    }
  }
  // Scenario Book pp.55–56. The old export may omit the trucks from these two forces.
  for (const truck of optionalTrucks) {
    const alreadyListed = blocks.some((block) =>
      block.turn === truck.turn && block.side === truck.side &&
      block.entries.some((entry) => entry.ref === truck.ref),
    )
    if (!alreadyListed) add(truck.side, truck.turn, { ...truck, vp_cost: 5 }, truck.load)
  }
  return arrivals
}
