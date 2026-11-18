import { rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import { rollFacilityBarrage } from '@ocs-eastern/series/tables/barrage'
import type { BarrageTable } from '@ocs-eastern/series/tables/barrage'
import type { ScorpionBarrage } from './scorpion-barrage.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'

export type AirfieldBarrageResult = ReturnType<typeof rollFacilityBarrage> & {
  aircraft: readonly { id: string; die: number; loss: boolean }[]
}

export interface AirfieldCapacityChoice {
  side: Side
  hex: string
  excess: number
}

export function settleScorpionAirfieldBarrage(state: Readonly<ScorpionInPlay>, barrage: ScorpionBarrage,
  table: BarrageTable): ScorpionInPlay {
  let rng = state.rng
  const roll = () => {
    const draw = rollDie(rng)
    rng = draw.rng
    return draw.value
  }
  const result = rollFacilityBarrage(table, barrage.initialColumn, roll)
  const aircraft: { id: string; die: number; loss: boolean }[] = []
  const pieces = state.pieces.map((unit) => {
    if (result.aircraftLossAt === null || unit.kind !== 'aircraft' || unit.side !== barrage.defender ||
      unit.location.kind !== 'hex' || unit.location.hex !== barrage.target) return unit
    const die = roll()
    const loss = die >= result.aircraftLossAt
    aircraft.push({ id: unit.id, die, loss })
    if (!loss) return unit
    if (unit.reduced) return { ...unit, location: { kind: 'dead-pile' as const }, active: false }
    return { ...unit, reduced: true }
  })
  const airBases = state.airBases.map((base) => base.hex === barrage.target && base.side === barrage.defender
    ? { ...base, level: Math.max(1, base.level - result.damage) } : base)
  const airfield = airBases.find((base) => base.hex === barrage.target && base.side === barrage.defender)!
  const atBase = { side: barrage.defender, hex: barrage.target }
  const excess = pieces.filter((unit) => activeAt(unit, atBase)).length - airbaseActiveCapacity(airfield.level)
  const { turn, phasing, phase } = state.cursor
  return { ...state, rng, pieces, airBases, airfieldCapacityChoice: excess > 0 ? { ...atBase, excess } : null,
    barrageHistory: [...(state.barrageHistory ?? []),
    { ...barrage, turn, phasing, phase, facilityRoll: { ...result, aircraft } }] }
}

export function settleScorpionAirfieldCapacity(state: Readonly<ScorpionInPlay>, actor: Side,
  unitIds: readonly string[]): ScorpionInPlay {
  const choice = state.airfieldCapacityChoice
  if (!choice || choice.side !== actor || new Set(unitIds).size !== choice.excess || unitIds.length !== choice.excess) {
    throw new Error('Choose the required number of excess active aircraft')
  }
  const eligible = new Set(state.pieces.filter((unit) => activeAt(unit, choice)).map(({ id }) => id))
  if (unitIds.some((id) => !eligible.has(id))) throw new Error('Choose active friendly aircraft at the affected air base')
  const pieces = state.pieces.map((unit) => unitIds.includes(unit.id) ? { ...unit, active: false } : unit)
  return { ...state, pieces, airfieldCapacityChoice: null }
}

function activeAt(unit: ScorpionInPlay['pieces'][number], base: { side: Side; hex: string }) {
  return unit.kind === 'aircraft' && unit.side === base.side && unit.active &&
    unit.location.kind === 'hex' && unit.location.hex === base.hex
}
import { airbaseActiveCapacity } from '@ocs-eastern/series/airbase'
