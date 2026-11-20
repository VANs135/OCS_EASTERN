import type { Side } from '@ocs-eastern/series/state-types'
import { rollFacilityBarrage } from '@ocs-eastern/series/tables/barrage'
import type { BarrageTable } from '@ocs-eastern/series/tables/barrage'
import { activeAirfieldExcess } from './scorpion-air-bases.ts'
import type { ScorpionBarrage } from './scorpion-barrage.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { scorpionRolls } from './scorpion-reroll.ts'
import type { ScorpionRoll } from './scorpion-reroll.ts'

export type AirfieldBarrageResult = ReturnType<typeof rollFacilityBarrage> & {
  aircraft: readonly { id: string; die: number; loss: boolean }[]
}

export interface AirfieldCapacityChoice {
  side: Side
  hex: string
  excess: number
}

export function settleScorpionAirfieldBarrage(state: Readonly<ScorpionInPlay>, barrage: ScorpionBarrage,
  table: BarrageTable, offer?: ScorpionRoll): ScorpionInPlay {
  const rolls = scorpionRolls(state.rng, offer)
  const hex = barrage.target
  const result = rollFacilityBarrage(table, barrage.initialColumn, () => rolls.one({ kind: 'airfield-barrage', hex }))
  const aircraft: { id: string; die: number; loss: boolean }[] = []
  const pieces = state.pieces.map((unit) => {
    if (result.aircraftLossAt === null || unit.kind !== 'aircraft' || unit.side !== barrage.defender ||
      unit.location.kind !== 'hex' || unit.location.hex !== barrage.target) return unit
    const die = rolls.one({ kind: 'airfield-loss', hex, unitId: unit.id })
    const loss = die >= result.aircraftLossAt
    aircraft.push({ id: unit.id, die, loss })
    if (!loss) return unit
    if (unit.reduced) return { ...unit, location: { kind: 'dead-pile' as const }, active: false }
    return { ...unit, reduced: true }
  })
  const airBases = state.airBases.map((base) => base.hex === barrage.target && base.side === barrage.defender && base.level > 0
    ? { ...base, level: Math.max(1, base.level - result.damage) } : base)
  const resolved = { ...state, rng: rolls.rng, pieces, airBases }
  const airfieldCapacityChoice = activeAirfieldExcess(resolved, barrage.defender, { kind: 'hex', hex: barrage.target })
  const { turn, phasing, phase } = state.cursor
  return { ...resolved, airfieldCapacityChoice,
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
