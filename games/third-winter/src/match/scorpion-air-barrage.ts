import type { Side } from '@ocs-eastern/series/state-types'
import { barrageColumn } from '@ocs-eastern/series/tables/barrage'
import type { BarrageTable } from '@ocs-eastern/series/tables/barrage'
import { scorpionHexDistance } from '../import/hex-id.ts'
import { aircraftProfile } from './scorpion-air-bases.ts'
import type { ScorpionAirBase } from './scorpion-air-bases.ts'
import { settleScorpionAirfieldBarrage } from './scorpion-airfield-barrage.ts'
import { hasScorpionBarrageSpotter, targetUnits } from './scorpion-barrage.ts'
import type { ScorpionBarrage } from './scorpion-barrage.ts'
import type { ScorpionBoxPiece } from './scorpion-box-pieces.ts'
import { assertScorpionReserveAtMovementEnd } from './scorpion-reserves.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'

export type AirBarrageTarget = 'units' | 'air-base'
export interface ScorpionAirBarrageBoard {
  barrage?: BarrageTable
  facilityBarrage?: BarrageTable
  hedgehogAt?: (hex: string) => number
}
export interface ScorpionAirBarragePlan {
  targetKind: AirBarrageTarget
  hipShoot: boolean
  tankBuster: boolean
  hedgehog: number
}

function requiredTable(board: ScorpionAirBarrageBoard, target: AirBarrageTarget) {
  const table = target === 'air-base' ? board.facilityBarrage : board.barrage
  if (!table) throw new Error('Air barrage requires the appropriate OCS v4.3 barrage table')
  return table
}

export function prepareScorpionAirBarrage(state: Readonly<ScorpionInPlay>, actor: Side, defender: Side, target: string,
  targetKind: AirBarrageTarget, hipShoot: boolean, profiles: readonly ReturnType<typeof aircraftProfile>[],
  assets: ScorpionSetupAssets, board: ScorpionAirBarrageBoard): ScorpionAirBarragePlan {
  if (targetKind !== 'units' && targetKind !== 'air-base') throw new Error('Invalid air barrage target kind')
  const targetExists = targetKind === 'air-base' ? state.airBases.some((base) => base.side === defender && base.hex === target)
    : targetUnits(state, defender, target).length > 0
  if (!assets.map.hexes.has(target) || !targetExists) throw new Error('Choose an enemy air barrage target')
  requiredTable(board, targetKind)
  const tankBuster = profiles.some((profile) => profile.tankBuster)
  if (hipShoot && (profiles.length !== 1 || !profiles[0]!.hipShoot)) {
    throw new Error('Hip Shoot requires a single Axis Ju.87 or Hs.129')
  }
  if (tankBuster && targetKind !== 'units') throw new Error('Tank-busters can only barrage eligible ground units')
  if (!profiles.some((profile) => profile.bombing >= 1 && (!tankBuster || profile.tankBuster))) {
    throw new Error('An air barrage needs at least one barrage point')
  }
  if ((hipShoot || tankBuster) && !hasScorpionBarrageSpotter(state, actor, target, assets.map)) {
    throw new Error('This air barrage requires an adjacent friendly combat spotter')
  }
  if (!hipShoot) assertScorpionReserveAtMovementEnd(state, actor, board.hedgehogAt)
  const hedgehog = targetKind === 'units' ? board.hedgehogAt?.(target) ?? 0 : 0
  if (!Number.isInteger(hedgehog) || hedgehog < 0 || hedgehog > 4) throw new Error('Invalid hedgehog level')
  return { targetKind, hipShoot, tankBuster, hedgehog }
}

export function executeScorpionAirBarrage(state: Readonly<ScorpionInPlay>, plan: ScorpionAirBarragePlan, defender: Side,
  target: string, flights: readonly { piece: ScorpionBoxPiece; origin: ScorpionAirBase }[],
  assets: ScorpionSetupAssets, board: ScorpionAirBarrageBoard): ScorpionInPlay {
  const planes = flights.map((flight) => ({ ...flight, profile: aircraftProfile(flight.piece, assets) }))
  const strength = planes.reduce((total, { profile }) => total + (plan.tankBuster && !profile.tankBuster ? 0 : profile.bombing), 0)
  if (strength < 1 || (plan.tankBuster && !targetUnits(state, defender, target)
    .some(([, unit]) => unit.combatClass !== 'other'))) return state
  const table = requiredTable(board, plan.targetKind)
  const shortRange = planes.every(({ origin }) => origin.kind === 'hex' && scorpionHexDistance(origin.hex, target) <= 10)
  const { initialColumn } = barrageColumn(table, strength)
  const barrage: ScorpionBarrage = { target, defender, batteries: [], strength, initialColumn, cost: 0,
    hedgehog: plan.hedgehog, air: { hipShoot: plan.hipShoot, tankBuster: plan.tankBuster, shortRange } }
  return plan.targetKind === 'air-base' ? settleScorpionAirfieldBarrage(state, barrage, table) : { ...state, barrage }
}
