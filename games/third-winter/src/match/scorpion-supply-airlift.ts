import { airTransportModes } from '@ocs-eastern/series/air-transport'
import type { AirTransportMode } from '@ocs-eastern/series/air-transport'
import type { Side } from '@ocs-eastern/series/state-types'
import { aircraftProfile, atAirBase, inScorpionAirRange } from './scorpion-air-bases.ts'
import type { ScorpionAirBase } from './scorpion-air-bases.ts'
import { scorpionPhaseAirMissions } from './scorpion-barrage-timing.ts'
import { scorpionUnloadedTokens } from './scorpion-dumps.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'

type Airfield = Extract<ScorpionAirBase, { kind: 'hex' }>
export type AirliftFlightMode = { id: string; mode: AirTransportMode }

export interface ScorpionSupplyAirlift {
  tokens: number
  carriers: readonly string[]
  source?: ScorpionAirBase
  flightModes?: readonly AirliftFlightMode[]
  unloading?: { delivered: number; lost: number; capacityUsed: number }
}

export function scorpionAirliftMode(airlift: ScorpionSupplyAirlift | undefined, id: string): AirTransportMode {
  if (airlift?.flightModes) return airlift.flightModes.find((flight) => flight.id === id)?.mode ?? 'normal'
  return airlift?.carriers.includes(id) ? 'double-capacity' : 'normal'
}

/** TTW Scenarios p.53 and OCS 14.9a/e. Cargo capacity pools across transports at the declared source. */
export function loadScorpionSupplyAirlift(state: Readonly<ScorpionInPlay>, side: Side, target: ScorpionAirBase,
  order: { tokens: number | undefined; source: ScorpionAirBase; modes: readonly AirliftFlightMode[] },
  flights: readonly { id: string; origin: ScorpionAirBase }[], profiles: readonly ReturnType<typeof aircraftProfile>[]) {
  const { tokens, source, modes } = order
  const key = source.kind === 'hex' ? `${side}:hex:${source.hex}` : `${side}:air-box`
  const supply = state.dumps[key]
  const location = source.kind === 'hex' ? 'on-map' : 'off-map'
  if (!Number.isSafeInteger(tokens) || tokens === undefined || tokens < 1 || supply?.side !== side ||
    supply.location !== location || supply.tokens < tokens) throw new Error('Load whole supply tokens available at the friendly departure base')
  if (tokens > supply.tokens - scorpionUnloadedTokens(state, key, supply)) {
    throw new Error('Supply unloaded in this phase cannot be transported again')
  }
  const selected = new Map(modes.map(({ id, mode }) => [id, mode]))
  if (selected.size !== modes.length || modes.some(({ id, mode }) =>
    !Object.hasOwn(airTransportModes, mode) || !flights.some((flight) => flight.id === id))) {
    throw new Error('Choose at most one valid transport range mode per mission aircraft')
  }
  let capacity = 0
  const carriers: string[] = []
  const flightModes = flights.map(({ id, origin }, index) => {
    const { range, transport } = profiles[index]!
    const loading = atAirBase(origin, source) && transport > 0
    const mode = selected.get(id) ?? (loading && origin.kind === 'off-map-air' ? 'double-capacity' : 'normal')
    const limits = airTransportModes[mode]
    if (!inScorpionAirRange(origin, target, range * limits.range)) throw new Error('Air transport exceeds the selected range')
    if (loading) {
      carriers.push(id)
      capacity += transport * limits.capacity
    }
    return { id, mode }
  })
  if (tokens > capacity) throw new Error('The load exceeds the transport capacity at the departure base for the selected modes')
  const airlift: ScorpionSupplyAirlift = { tokens, source, carriers, flightModes }
  return { airlift, dumps: { ...state.dumps, [key]: { ...supply, tokens: supply.tokens - tokens } } }
}

/** OCS 14.4g, 14.9f and player ruling. Surviving transports that abort at the target may unload. */
export function settleScorpionSupplyAirlift(state: Readonly<ScorpionInPlay>, side: Side, target: Airfield,
  airlift: ScorpionSupplyAirlift, assets: ScorpionSetupAssets, stay?: readonly string[]) {
  const extended = new Set(airlift.flightModes?.filter(({ mode }) => airTransportModes[mode].stay).map(({ id }) => id))
  const atDestination = state.pieces.filter((plane) => airlift.carriers.includes(plane.id) && atAirBase(plane.location, target))
    .map((plane) => ({ plane, capacity: aircraftProfile(plane, assets).transport * airTransportModes[scorpionAirliftMode(airlift, plane.id)].capacity }))
  const choices = atDestination.filter(({ plane, capacity }) => plane.active && !extended.has(plane.id) && capacity > 0).map(({ plane }) => plane.id)
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
    !plane.active || extended.has(plane.id) || selected.has(plane.id) ? total + capacity : total, 0)
  const survivalBonus = Math.max(0, delivered - survivingCapacity)
  const capacityUsed = Math.max(0, delivered - stayingCapacity - (stayingCapacity > 0 ? survivalBonus : 0))
  if (capacityUsed > remaining) {
    if (stay) throw new Error('Leave enough cargo aircraft inactive at the destination to unload within capacity')
    return { kind: 'choose-landing' as const, candidates: choices, delivered, remaining }
  }
  const pieces = state.pieces.map((plane) => selected.has(plane.id) || (extended.has(plane.id) && atAirBase(plane.location, target))
    ? { ...plane, active: false } : plane)
  const id = `${side}:hex:${target.hex}`
  const dump = state.dumps[id]
  const unloaded = (dump ? scorpionUnloadedTokens(state, id, dump) : 0) + delivered
  const { turn, phasing, phase } = state.cursor
  const dumps = delivered ? { ...state.dumps, [id]: { side, location: 'on-map' as const,
    tokens: (dump?.tokens ?? 0) + delivered, unloaded: { turn, phasing, phase, tokens: unloaded } } } : state.dumps
  return { kind: 'unloaded' as const, state: { ...state, pieces, dumps },
    airlift: { ...airlift, unloading: { delivered, lost: airlift.tokens - delivered, capacityUsed } } }
}
