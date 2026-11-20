import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionHexDistance } from '../import/hex-id.ts'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import { scorpionStepCost } from '../ttw/scorpion/terrain-cost.ts'
import { scorpionGroundActivity } from './scorpion-ground-activity.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'

export function scorpionStationaryCombatWorker(state: Readonly<ScorpionInPlay>, side: Side, id: string) {
  const unit = Object.hasOwn(state.units, id) ? state.units[id] : undefined
  if (unit?.combat && unit.side === side && !unit.moveMode && !unit.reserve && !unit.exploit &&
    !state.moved.includes(id) && !scorpionGroundActivity(state).airlifted.includes(id)) return unit
}

/** OCS 13.8d. Scorpion has regular engineer-capable HQs; Kessel HQs are excluded by TTW 2.3a. */
export function scorpionCanEngineerAt(state: Readonly<ScorpionInPlay>, side: Side, id: string, hex: string, map: ScorpionMap) {
  const worker = scorpionStationaryCombatWorker(state, side, id)
  if (!worker?.headquarters || worker.headquarters.kessel || scorpionHexDistance(worker.hex, hex) > 2) return false
  if (worker.hex === hex) return true
  const weather = state.turn.weather.ground === 'freeze' ? 'freeze' : 'dry'
  const passable = (from: string, to: string) => scorpionStepCost(map, from, to, 'leg', weather) !== null
  const blocked = new Set(Object.values(state.units).filter((unit) => unit.side !== side).map((unit) => unit.hex))
  return passable(worker.hex, hex) ||
    map.neighbors(worker.hex).some((near) => !blocked.has(near) && passable(worker.hex, near) && passable(near, hex))
}
