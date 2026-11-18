import type { Side } from '@ocs-eastern/series/state-types'
import { aircraftProfile, atAirBase } from './scorpion-air-bases.ts'
import type { ScorpionAirBase } from './scorpion-air-bases.ts'
import { scorpionPhaseAirMissions } from './scorpion-barrage-timing.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'

type Airfield = Extract<ScorpionAirBase, { kind: 'hex' }>

export interface ScorpionSupplyAirlift {
  tokens: number
  carriers: readonly string[]
  unloading?: { delivered: number; lost: number; capacityUsed: number }
}

/** TTW Scenarios p.53 and OCS 14.9. Supply is loaded together in the side's off-map box at doubled capacity. */
export function loadScorpionSupplyAirlift(state: Readonly<ScorpionInPlay>, side: Side, tokens: number | undefined,
  flights: readonly { id: string; origin: ScorpionAirBase }[], profiles: readonly ReturnType<typeof aircraftProfile>[]) {
  const carriers = flights.flatMap((flight, index) => flight.origin.kind === 'off-map-air' && profiles[index]!.transport > 0
    ? [{ id: flight.id, capacity: profiles[index]!.transport * 2 }] : [])
  const key = `${side}:air-box`
  const supply = state.dumps[key]
  if (!Number.isSafeInteger(tokens) || tokens === undefined || tokens < 1 || supply?.side !== side ||
    supply.location !== 'off-map' || supply.tokens < tokens) throw new Error('Load whole supply tokens available in the friendly off-map air box')
  if (tokens > carriers.reduce((total, { capacity }) => total + capacity, 0)) {
    throw new Error('The airlift exceeds the doubled capacity of its off-map transports')
  }
  const airlift: ScorpionSupplyAirlift = { tokens, carriers: carriers.map(({ id }) => id) }
  return { airlift, dumps: { ...state.dumps, [key]: { ...supply, tokens: supply.tokens - tokens } } }
}

/** OCS 14.4g, 14.9f and player ruling. Surviving transports that abort at the target may unload. */
export function settleScorpionSupplyAirlift(state: Readonly<ScorpionInPlay>, side: Side, target: Airfield,
  airlift: ScorpionSupplyAirlift, assets: ScorpionSetupAssets, stay?: readonly string[]) {
  const atDestination = state.pieces.filter((plane) => airlift.carriers.includes(plane.id) && atAirBase(plane.location, target))
    .map((plane) => ({ plane, capacity: aircraftProfile(plane, assets).transport * 2 }))
  const choices = atDestination.filter(({ plane, capacity }) => plane.active && capacity > 0).map(({ plane }) => plane.id)
  const selected = new Set(stay)
  if (stay && (selected.size !== stay.length || stay.some((id) => !choices.includes(id)))) {
    throw new Error('Choose distinct surviving transport aircraft at the destination')
  }
  const survivingCapacity = atDestination.reduce((total, { capacity }) => total + capacity, 0)
  const delivered = Math.min(airlift.tokens, Math.ceil(survivingCapacity))
  const alreadyUsed = scorpionPhaseAirMissions(state).filter((mission) => atAirBase(mission.target, target))
    .reduce((total, mission) => total + (mission.airlift?.unloading?.capacityUsed ?? 0), 0)
  const level = state.airBases.find((base) => base.side === side && base.hex === target.hex)!.level
  const remaining = Math.max(0, level * 2 - alreadyUsed)
  const stayingCapacity = atDestination.reduce((total, { plane, capacity }) =>
    !plane.active || selected.has(plane.id) ? total + capacity : total, 0)
  const capacityUsed = Math.max(0, delivered - Math.ceil(stayingCapacity))
  if (capacityUsed > remaining) {
    if (stay) throw new Error('Leave enough cargo aircraft inactive at the destination to unload within capacity')
    return { kind: 'choose-landing' as const, candidates: choices, delivered, remaining }
  }
  const pieces = state.pieces.map((plane) => selected.has(plane.id) ? { ...plane, active: false } : plane)
  const id = `${side}:hex:${target.hex}`
  const dumps = delivered ? { ...state.dumps, [id]: { side, location: 'on-map' as const,
    tokens: (state.dumps[id]?.tokens ?? 0) + delivered } } : state.dumps
  return { kind: 'unloaded' as const, state: { ...state, pieces, dumps },
    airlift: { ...airlift, unloading: { delivered, lost: airlift.tokens - delivered, capacityUsed } } }
}
