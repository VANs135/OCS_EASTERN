import type { Side } from '@ocs-eastern/series/state-types'
import { deployScorpionGroundCounter } from '../import/scorpion-deployment.ts'
import { scorpionHexId } from '../import/hex-id.ts'
import { canPlaceKessel, kesselReturnAfterRemoval } from '../ttw/axis/kessel.ts'
import { assertScorpionStacking } from './scorpion-retreat.ts'
import type { ScorpionInPlay, ScorpionSession } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'

// Scenario 8, p.55: the 1st Corps is in the setup snapshot and the 4th Corps starts available.
const slots = [
  { definition: 'hq:id:4150', originalId: 'setup:hq:id:4150:1' },
  { definition: 'hq:id:4151', originalId: 'kessel:hq:id:4151' },
] as const

export type ScorpionKesselAction = { type: 'place-kessel-hq'; definition: string; hex: string }
  | { type: 'remove-kessel-hq'; unitId: string }

export function scorpionKesselSlots(state: Readonly<ScorpionSession>, catalog: ScorpionSetupAssets['catalog']) {
  const board = state.kind === 'playing' ? state : state.opening
  const turn = state.kind === 'playing' ? state.turn.number : 1
  return slots.flatMap(({ definition, originalId }, index) => {
    const counter = catalog.definitions.get(definition)
    if (!counter?.source.abilities?.includes('kessel_supply')) return []
    const id = Object.keys(board.units).find((key) => board.units[key]?.definition === definition)
    const dead = board.pieces.some((piece) => piece.definition === definition && piece.location.kind === 'dead-pile')
    const availableFromTurn = state.kind === 'playing' ? state.kesselReturns?.[definition] ?? 1 : 1
    return [{ definition, originalId, name: counter.source.name, asset: counter.source.faces.combat?.asset,
      id, index, dead, availableFromTurn, ready: !id && !dead && availableFromTurn <= turn }]
  })
}

export function scorpionKesselWindow(state: Readonly<ScorpionInPlay>, side: Side) {
  return side === 'axis' && state.cursor.phasing === side && state.cursor.phase === 'reinforcement' &&
    state.turn.step.kind === 'player-turn' && !state.combat
}

export function scorpionKesselTargets(state: Readonly<ScorpionInPlay>) {
  return [...new Set(Object.values(state.units).filter((unit) => unit.side === 'axis' && unit.combat)
    .map(({ hex }) => hex))]
}

export function applyScorpionKessel(state: Readonly<ScorpionInPlay>, side: Side, action: ScorpionKesselAction,
  { map, catalog }: ScorpionSetupAssets): ScorpionInPlay {
  if (!scorpionKesselWindow(state, side)) throw new Error('Kessel HQ placement or removal requires Axis Reinforcement')
  const slots = scorpionKesselSlots(state, catalog)
  if (action.type === 'remove-kessel-hq') {
    const slot = slots.find(({ id }) => id === action.unitId)
    if (!slot) throw new Error('Choose a Kessel HQ on the map')
    const units = { ...state.units }
    delete units[action.unitId]
    return { ...state, units, kesselReturns: recordKesselReturn(state, slot.definition) }
  }
  const slot = slots.find(({ definition }) => definition === action.definition)
  const hex = scorpionHexId(action.hex)
  if (!slot?.ready || !map.hexes.has(hex) ||
    !canPlaceKessel(slot, state.turn.number, scorpionKesselTargets(state).includes(hex))) {
    throw new Error('Choose an available Kessel HQ and a hex with a friendly combat unit')
  }
  const deployment = deployScorpionGroundCounter(catalog.definitions.get(slot.definition)!, hex, 0)
  const kesselReturns = { ...state.kesselReturns }
  delete kesselReturns[slot.definition]
  const next = { ...state, units: { ...state.units, [slot.originalId]: deployment }, kesselReturns }
  assertScorpionStacking(next, hex)
  return next
}

function recordKesselReturn(state: Readonly<ScorpionInPlay>, definition: string) {
  return { ...state.kesselReturns, [definition]: kesselReturnAfterRemoval(state.turn.number).availableFromTurn }
}
