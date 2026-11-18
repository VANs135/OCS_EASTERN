import { airTransportModes } from '@ocs-eastern/series/air-transport'
import type { AirTransportMode } from '@ocs-eastern/series/air-transport'
import type { Side } from '@ocs-eastern/series/state-types'
import { aircraftProfile, atAirBase, inScorpionAirRange } from './scorpion-air-bases.ts'
import type { ScorpionAirBase } from './scorpion-air-bases.ts'
import { scorpionPhaseAirMissions } from './scorpion-barrage-timing.ts'
import { creditScorpionUnloadedSupply, scorpionUnloadedTokens } from './scorpion-dumps.ts'
import { prepareScorpionGroundAirlift, unloadScorpionGroundAirlift } from './scorpion-ground-airlift.ts'
import type { GroundAirliftCargo } from './scorpion-ground-airlift.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

type Airfield = Extract<ScorpionAirBase, { kind: 'hex' }>
export type AirliftFlightMode = { id: string; mode: AirTransportMode }
export type AirliftCargoSelection = { unitIds: readonly string[]; tokens: number }
export type AirliftDecision = { stay?: readonly string[]; cargo?: AirliftCargoSelection; railroad?: SupplyRailBoard }

export interface ScorpionAirlift {
  tokens: number
  carriers: readonly string[]
  source?: ScorpionAirBase
  flightModes?: readonly AirliftFlightMode[]
  ground?: readonly GroundAirliftCargo[]
  unloading?: { delivered: number; lost: number; capacityUsed: number; deliveredUnits?: readonly string[]; lostUnits?: readonly string[] }
}

export function scorpionAirliftMode(airlift: ScorpionAirlift | undefined, id: string): AirTransportMode {
  if (airlift?.flightModes) return airlift.flightModes.find((flight) => flight.id === id)?.mode ?? 'normal'
  return airlift?.carriers.includes(id) ? 'double-capacity' : 'normal'
}

export function scorpionAirliftCapacity(airlift: ScorpionAirlift, plane: ScorpionInPlay['pieces'][number], assets: ScorpionSetupAssets) {
  return aircraftProfile(plane, assets).transport * airTransportModes[scorpionAirliftMode(airlift, plane.id)].capacity
}

/** TTW Scenarios p.53 and OCS 14.9a/e. Cargo capacity pools across transports at the declared source. */
export function loadScorpionAirlift(state: Readonly<ScorpionInPlay>, side: Side, target: ScorpionAirBase,
  order: { tokens: number; source: ScorpionAirBase; modes: readonly AirliftFlightMode[]; unitIds: readonly string[] },
  flights: readonly { id: string; origin: ScorpionAirBase }[], profiles: readonly ReturnType<typeof aircraftProfile>[],
  assets: ScorpionSetupAssets) {
  const { tokens, source, modes, unitIds } = order
  const key = source.kind === 'hex' ? `${side}:hex:${source.hex}` : `${side}:air-box`
  const supply = state.dumps[key]
  const location = source.kind === 'hex' ? 'on-map' : 'off-map'
  if (!Number.isSafeInteger(tokens) || tokens < 0 || (!tokens && !unitIds.length) ||
    (tokens > 0 && (supply?.side !== side || supply.location !== location || supply.tokens < tokens))) {
    throw new Error('Choose cargo and load only whole supply tokens available at the departure base')
  }
  if (tokens > 0 && supply && tokens > supply.tokens - scorpionUnloadedTokens(state, key, supply)) {
    throw new Error('Supply unloaded in this phase cannot be transported again')
  }
  const ground = prepareScorpionGroundAirlift(state, side, source, unitIds, assets)
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
  if (tokens + ground.cargo.reduce((total, item) => total + item.tokens, 0) > capacity) {
    throw new Error('The load exceeds the transport capacity at the departure base for the selected modes')
  }
  const airlift: ScorpionAirlift = { tokens, source, carriers, flightModes, ...(ground.cargo.length ? { ground: ground.cargo } : {}) }
  return { airlift, units: ground.units,
    dumps: tokens > 0 && supply ? { ...state.dumps, [key]: { ...supply, tokens: supply.tokens - tokens } } : state.dumps }
}

/** OCS 14.4g, 14.9f and player ruling. Surviving transports that abort at the target may unload. */
export function settleScorpionAirlift(state: Readonly<ScorpionInPlay>, side: Side, target: Airfield,
  airlift: ScorpionAirlift, assets: ScorpionSetupAssets, decision: AirliftDecision) {
  const { stay, cargo, railroad } = decision
  const extended = new Set(airlift.flightModes?.filter(({ mode }) => airTransportModes[mode].stay).map(({ id }) => id))
  const atDestination = state.pieces.filter((plane) => airlift.carriers.includes(plane.id) && atAirBase(plane.location, target))
    .map((plane) => ({ plane, capacity: scorpionAirliftCapacity(airlift, plane, assets) }))
  const choices = atDestination.filter(({ plane, capacity }) => plane.active && !extended.has(plane.id) && capacity > 0).map(({ plane }) => plane.id)
  const selected = new Set(stay)
  if (stay && (selected.size !== stay.length || stay.some((id) => !choices.includes(id)))) {
    throw new Error('Choose distinct surviving transport aircraft at the destination')
  }
  const survivingCapacity = atDestination.reduce((total, { capacity }) => total + capacity, 0)
  const ground = airlift.ground ?? []
  const totalCargo = airlift.tokens + ground.reduce((total, item) => total + item.tokens, 0)
  const capacity = survivingCapacity < totalCargo ? Math.ceil(survivingCapacity) : survivingCapacity
  if (ground.length && capacity > 0 && totalCargo > capacity && !cargo) {
    return { kind: 'choose-cargo' as const, capacity, unitIds: ground.map(({ id }) => id), tokens: airlift.tokens }
  }
  const kept = cargo ?? { unitIds: capacity >= totalCargo ? ground.map(({ id }) => id) : [],
    tokens: Math.min(airlift.tokens, Math.floor(capacity)) }
  const retained = new Set(kept.unitIds)
  const lost = ground.filter(({ id }) => !retained.has(id))
  const keptCost = kept.tokens + ground.reduce((sum, item) => retained.has(item.id) ? sum + item.tokens : sum, 0)
  if (!Number.isSafeInteger(kept.tokens) || kept.tokens < 0 || kept.tokens > airlift.tokens ||
    retained.size !== kept.unitIds.length || kept.unitIds.some((id) => !ground.some((item) => item.id === id)) ||
    keptCost > capacity || lost.some(({ tokens }) => keptCost + tokens <= capacity) ||
    (kept.tokens < airlift.tokens && keptCost + 1 <= capacity)) {
    throw new Error('Keep all cargo that fits the surviving transport capacity')
  }
  const alreadyUsed = scorpionPhaseAirMissions(state).filter((mission) => atAirBase(mission.target, target))
    .reduce((total, mission) => total + (mission.airlift?.unloading?.capacityUsed ?? 0), 0)
  const level = state.airBases.find((base) => base.side === side && base.hex === target.hex)!.level
  const remaining = Math.max(0, level * 2 - alreadyUsed)
  const stayingCapacity = atDestination.reduce((total, { plane, capacity }) =>
    !plane.active || extended.has(plane.id) || selected.has(plane.id) ? total + capacity : total, 0)
  const survivalBonus = Math.max(0, keptCost - survivingCapacity)
  const capacityUsed = Math.max(0, keptCost - stayingCapacity - (stayingCapacity > 0 ? survivalBonus : 0))
  if (capacityUsed > remaining) {
    if (stay) throw new Error('Leave enough cargo aircraft inactive at the destination to unload within capacity')
    return { kind: 'choose-landing' as const, candidates: choices, delivered: keptCost, remaining, cargo: kept }
  }
  const pieces = state.pieces.map((plane) => selected.has(plane.id) || (extended.has(plane.id) && atAirBase(plane.location, target))
    ? { ...plane, active: false } : plane)
  const delivered = kept.tokens
  const dumps = creditScorpionUnloadedSupply(state, side, target, delivered)
  const lostUnits = lost.map(({ id }) => id)
  const landed = unloadScorpionGroundAirlift({ ...state, pieces, dumps }, side, target.hex, kept.unitIds, lostUnits, assets, railroad)
  return { kind: 'unloaded' as const, state: landed,
    airlift: { ...airlift, unloading: { delivered, lost: airlift.tokens - delivered, capacityUsed,
      ...(ground.length ? { deliveredUnits: kept.unitIds, lostUnits } : {}) } } }
}
