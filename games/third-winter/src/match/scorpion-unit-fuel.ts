import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionSupplyNetwork } from '../ttw/scorpion/supply-trace.ts'
import type { TracePosition } from '../ttw/scorpion/supply-trace.ts'
import { spendScorpionDump } from './scorpion-dumps.ts'
import { applyScorpionGroundMove } from './scorpion-movement.ts'
import type { MoveCommand, MovementBoard } from './scorpion-movement.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { usableDump } from './scorpion-sp-payment.ts'

/** OCS 12.5c(C). One token pays at the instant an eligible single counter moves. */
export function moveScorpionWithFuel(state: Readonly<ScorpionInPlay>, side: Side, action: MoveCommand, dumpId: string,
  rules: MovementBoard, facts: TracePosition): ScorpionInPlay {
  const fueled = fuelScorpionCounter(state, side, action.unitId, dumpId, rules.map, facts)
  return applyScorpionGroundMove(fueled, side, action, rules)
}

export function fuelScorpionCounter(state: Readonly<ScorpionInPlay>, side: Side, unitId: string, dumpId: string,
  map: MovementBoard['map'], facts: TracePosition): ScorpionInPlay {
  const unit = Object.hasOwn(state.units, unitId) ? state.units[unitId] : undefined
  if (!unit?.combat || unit.side !== side || unit.mobility === 'leg' || unit.fueled) {
    throw new Error('This counter does not require a single-unit fuel payment')
  }
  const { dump, hex } = usableDump(state, side, dumpId)
  if (!scorpionSupplyNetwork(map, facts).canUseDump(unit.hex, hex, unit.traceDrawMobility)) {
    throw new Error('The selected fuel dump is outside draw or throw range')
  }
  return { ...state, units: { ...state.units, [unitId]: { ...unit, fueled: true } },
    dumps: { ...state.dumps, [dumpId]: spendScorpionDump(state, dumpId, dump, 1) } }
}
