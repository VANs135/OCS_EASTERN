import { airTransportModes } from '@ocs-eastern/series/air-transport'
import type { Side } from '@ocs-eastern/series/state-types'
import { rollParachuteDrop } from '@ocs-eastern/series/tables/air-drop'
import { mayPlanTtwCombatAirDrop } from '../ttw/air/airdrop-eligibility.ts'
import { scorpionAxisSources, scorpionSovietSources } from '../ttw/scorpion/initial-map.ts'
import { atAirBase } from './scorpion-air-bases.ts'
import type { ScorpionAirBase } from './scorpion-air-bases.ts'
import { scorpionAirliftCapacity, scorpionAirliftMode } from './scorpion-airlift.ts'
import type { ScorpionAirlift } from './scorpion-airlift.ts'
import { scorpionCaptureAt, resolveScorpionEntry } from './scorpion-capture.ts'
import type { ScorpionCapturePolicy } from './scorpion-capture.ts'
import { creditScorpionUnloadedSupply } from './scorpion-dumps.ts'
import { scorpionGroundActivity } from './scorpion-ground-activity.ts'
import { unloadScorpionGroundAirlift } from './scorpion-ground-airlift.ts'
import { scorpionKnownPhaseOccupancy } from './scorpion-phase-occupancy.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'

type HexTarget = Extract<ScorpionAirBase, { kind: 'hex' }>
type DropRoll = Omit<ReturnType<typeof rollParachuteDrop>, 'rng'> & { unitId?: string; landed: boolean }
export type DropUnitDisposition = 'drop' | 'abort' | 'lose'
export interface ScorpionAirdrop {
  friendly: boolean
  clear: boolean
  result?: {
    rolls: readonly DropRoll[]
    landedTokens: number
    abortedTokens: number
    lostTokens: number
    unit?: { id: string; outcome: 'landed' | 'aborted' | 'lost' }
  }
}

/** OCS 14.10b–d. Use terrain and friendly occupancy from the success table. */
export function prepareScorpionAirdrop(state: Readonly<ScorpionInPlay>, side: Side, target: HexTarget,
  units: readonly string[], assets: ScorpionSetupAssets): ScorpionAirdrop {
  const terrain = assets.map?.hexes.get(target.hex)
  const enemySources: readonly string[] = side === 'soviet' ? scorpionAxisSources : scorpionSovietSources
  if (!terrain || enemySources.includes(target.hex)) throw new Error('Choose a legal on-map drop hex')
  if (units.length) {
    const plan = state.dropPlan
    const unit = plan && state.units[plan.unitId]
    if (side !== 'soviet' || state.cursor.phase !== 'movement' || !plan || units.length !== 1 || units[0] !== plan.unitId ||
      plan.turn !== state.cursor.turn || plan.target !== target.hex || !unit || state.moved.includes(plan.unitId) ||
      scorpionGroundActivity(state).airlifted.includes(plan.unitId) ||
      !mayPlanTtwCombatAirDrop(assets.catalog.definitions.get(unit.definition))) {
      throw new Error('Ground air drop requires the eligible unmoved brigade, at its planned hex and turn in Movement')
    }
  }
  const occupancy = scorpionKnownPhaseOccupancy(state)
  if (!occupancy) throw new Error('This save has no phase-start occupancy for a drop. Continue to the next eligible phase')
  return { friendly: occupancy.occupied[side].includes(target.hex),
    clear: terrain.terrains.some((kind) => kind === 'Open' || kind === 'Village') || state.airBases.some((base) => base.hex === target.hex) }
}

/** OCS 14.4g and the player's ruling. Recompute the capacity left to drop or to carry cargo back. */
export function settleScorpionAirdrop(state: Readonly<ScorpionInPlay>, side: Side, target: HexTarget,
  drop: ScorpionAirdrop, airlift: ScorpionAirlift, assets: ScorpionSetupAssets,
  policy: ScorpionCapturePolicy, disposition?: DropUnitDisposition) {
  let active = 0
  let aborted = 0
  for (const plane of state.pieces) {
    if (!airlift.carriers.includes(plane.id) || !atAirBase(plane.location, target)) continue
    const capacity = scorpionAirliftCapacity(airlift, plane, assets)
    if (plane.active) active += capacity
    else aborted += capacity
  }
  const ground = airlift.ground?.[0]
  const total = Math.ceil(active + aborted)
  const allocations = (['drop', 'abort', 'lose'] as const).flatMap((choice) => {
    const cost = choice === 'lose' ? 0 : (ground?.tokens ?? 0)
    const dropCost = choice === 'drop' ? cost : 0
    const abortCost = choice === 'abort' ? cost : 0
    const dropCapacity = Math.ceil(active) - dropCost
    const abortCapacity = Math.ceil(aborted) - abortCost
    if (dropCapacity < 0 || abortCapacity < 0 || cost > total || (!ground && choice !== 'lose')) return []
    const attempts = Math.min(airlift.tokens, Math.floor(dropCapacity), Math.floor(total - cost))
    const saved = Math.min(airlift.tokens - attempts, Math.floor(abortCapacity), Math.floor(total - cost - attempts))
    return [{ choice, attempts, saved }]
  })
  const keepingUnit = allocations.filter(({ choice }) => choice !== 'lose')
  const options = allocations.filter(({ choice, attempts, saved }) => choice !== 'lose' ||
    !keepingUnit.some((kept) => kept.attempts + kept.saved >= attempts + saved))
  if (options.length > 1 && !disposition) return { kind: 'choose-cargo' as const, options, unitId: ground!.id }
  const cargo = disposition ? options.find(({ choice }) => choice === disposition) : options[0]
  if (!cargo) throw new Error('Choose an offered disposition for the airborne unit and remaining supply')

  const enemyCombat = Object.values(state.units).some((unit) => unit.side !== side && unit.hex === target.hex && unit.combat)
  const enemy = scorpionCaptureAt(state, side, target.hex)
  const enemyStores = Boolean(enemy.dump?.tokens || enemy.airBase || enemy.aircraft.length || enemy.transports.length || enemy.hedgehog)
  let rng = state.rng
  const roll = () => {
    const { rng: next, ...result } = rollParachuteDrop(rng, drop.friendly, drop.clear, side === 'soviet')
    rng = next
    return result
  }
  const rolls: DropRoll[] = []
  let landedId: string | undefined
  if (ground && cargo.choice === 'drop') {
    const result = roll()
    const landed = result.success && !enemyCombat && (!enemyStores || state.units[ground.id]!.attackCapable)
    if (landed) landedId = ground.id
    rolls.push({ ...result, unitId: ground.id, landed })
  }
  for (let i = 0; i < cargo.attempts; i++) {
    const result = roll()
    rolls.push({ ...result, landed: result.success && !enemyCombat && (!enemyStores || !!landedId) })
  }
  const landedTokens = rolls.filter((result) => !result.unitId && result.landed).length
  const friendlyBase = state.airBases.some((base) => base.side === side && base.hex === target.hex)
  const abortBase = friendlyBase ? target : airlift.source!
  const abortedId = cargo.choice === 'abort' ? ground?.id : undefined
  const lostIds = ground && !landedId && !abortedId ? [ground.id] : []
  const unitsAtTarget = [...(landedId ? [landedId] : []), ...(friendlyBase && abortedId ? [abortedId] : [])]
  const pieces = friendlyBase ? state.pieces.map((plane) => plane.active && atAirBase(plane.location, target) &&
    airlift.flightModes?.some(({ id }) => id === plane.id && airTransportModes[scorpionAirliftMode(airlift, id)].stay)
    ? { ...plane, active: false } : plane) : state.pieces
  let resolved = unloadScorpionGroundAirlift({ ...state, rng, pieces }, side, target.hex, unitsAtTarget, lostIds, assets, policy.supplyRail)
  if (landedId) {
    resolved = { ...resolved, moved: [...resolved.moved, landedId], dropTrace: { unitId: landedId, turn: state.cursor.turn },
      units: { ...resolved.units, [landedId]: { ...resolved.units[landedId]!, outOfSupply: false } } }
    if (enemyStores) resolved = resolveScorpionEntry(resolved, side, target.hex, [landedId], assets, false, policy)
  }
  resolved = { ...resolved, dumps: creditScorpionUnloadedSupply(resolved, side, abortBase, cargo.saved) }
  resolved = { ...resolved, dumps: creditScorpionUnloadedSupply(resolved, side, target, landedTokens) }
  if (ground && !abortedId) resolved = { ...resolved, dropPlan: null }
  return { kind: 'settled' as const, state: resolved, drop: { ...drop, result: { rolls, landedTokens, abortedTokens: cargo.saved,
    lostTokens: airlift.tokens - landedTokens - cargo.saved,
    ...(ground ? { unit: { id: ground.id, outcome: landedId ? 'landed' as const : abortedId ? 'aborted' as const : 'lost' as const } } : {}),
  } } }
}
