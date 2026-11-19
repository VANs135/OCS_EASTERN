import { airbaseActiveCapacity, airbaseRefitCapacity } from '@ocs-eastern/series/airbase'
import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionHexId } from '../import/hex-id.ts'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import type { ScorpionBoxPiece } from './scorpion-box-pieces.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { scorpionSpPayment } from './scorpion-sp-payment.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

export interface RefitScorpionAircraft {
  type: 'refit-aircraft'
  base: { kind: 'hex'; hex: string; dumpId: string } | { kind: 'off-map-air' }
  unitIds: readonly string[]
}

export function refitScorpionAircraft(state: Readonly<ScorpionInPlay>, actor: Side, action: RefitScorpionAircraft,
  map: ScorpionMap, rail?: SupplyRailBoard): ScorpionInPlay {
  if (state.cursor.phase !== 'aircraft-refit' || state.cursor.phasing !== actor || state.turn.step.kind !== 'player-turn') {
    throw new Error('Only the phasing side may refit aircraft in its Aircraft Refit Phase')
  }
  const selected = new Set(action.unitIds)
  if (!selected.size || selected.size !== action.unitIds.length) throw new Error('Choose distinct aircraft to refit')
  const { base } = action
  const hex = base.kind === 'hex' ? scorpionHexId(base.hex) : undefined
  const atBase = (piece: ScorpionBoxPiece) => piece.kind === 'aircraft' && piece.side === actor &&
    (base.kind === 'off-map-air' ? piece.location.kind === 'off-map-air'
      : piece.location.kind === 'hex' && piece.location.hex === hex)
  const based = state.pieces.filter(atBase)
  const inactive = new Set(based.filter((piece) => !piece.active).map(({ id }) => id))
  if (action.unitIds.some((id) => !inactive.has(id))) throw new Error('Choose only inactive friendly aircraft at this base')
  const pieces = state.pieces.map((piece) => selected.has(piece.id) ? { ...piece, active: true } : piece)
  if (base.kind === 'off-map-air') return { ...state, pieces }

  const field = state.airBases.find((candidate) => candidate.side === actor && candidate.hex === hex)
  if (!field || !map.hexes.has(field.hex)) throw new Error('Choose a friendly air base')
  if (state.refittedAirbases?.includes(field.hex)) throw new Error('This air base has already refitted in this phase')
  const rate = airbaseRefitCapacity(field.level) / (state.turn.weather.ground === 'thaw' ? 2 : 1)
  if (selected.size > rate ||
    based.length - inactive.size + selected.size > airbaseActiveCapacity(field.level)) {
    throw new Error('Selection exceeds the air base refit or active stacking capacity')
  }
  const ledger = scorpionSpPayment(state, actor, map, rail)
  if (ledger.position.unnegatedEnemyZoc.has(field.hex)) throw new Error('An air base in unnegated enemy ZOC cannot refit')
  ledger.spend([{ dumpId: base.dumpId, tokens: 1 }], ({ dumpId }) => {
    const { hex: from, truck } = ledger.source(dumpId)
    return !truck?.organicTruck && ledger.network.canUseDump(field.hex, from)
  })
  return { ...state, pieces, ...ledger.settle(), refittedAirbases: [...(state.refittedAirbases ?? []), field.hex] }
}
