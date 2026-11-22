import { groundModeMovementFactor } from '@ocs-eastern/series/modes'
import type { Side } from '@ocs-eastern/series/state-types'
import { zocAffectsAction } from '@ocs-eastern/series/zoc'
import { campaignMarchDestinations, campaignMarchPreview, normalizeCampaignMarchPath, planCampaignGroundMarch } from './campaign-ground-march.ts'
import type { CampaignMarchInterruption, CampaignMarchMover } from './campaign-ground-march.ts'
import { campaignCombatPontoon, campaignCounterGroundMode } from './campaign-ground-position.ts'
import type { CampaignGroundProfile } from './campaign-ground-position.ts'
import { campaignMovementPosition } from './campaign-movement-board.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignGroundMovementProgress {
  moved: readonly string[]
  zocLocks: readonly string[]
  crossedReByHexside?: Readonly<Record<string, number>>
  usedFerryIds?: readonly string[]
  interruption?: CampaignMarchInterruption
}

export interface CampaignGroundMover {
  id: string
  mode?: 'combat' | 'move' | 'strat'
  /** Leave the marching stack at this one-based step, or follow the whole route. */
  stopAfter?: number
}

export interface MoveCampaignGround {
  type: 'move-campaign-ground'
  movers: readonly CampaignGroundMover[]
  path: readonly string[]
}

export type CampaignGroundMovementAction = MoveCampaignGround | { type: 'hold-campaign-ground-zoc'; counterId: string }
  | { type: 'complete-campaign-ground-movement' }

type Position = NonNullable<ReturnType<typeof campaignMovementPosition>>

function movementOpen(state: Readonly<CampaignTurnState>, side: Side) {
  return state.cursor.phase === 'movement' && state.cursor.phasing === side && state.movementSegment === 'movement'
}

const refuse = <Reason extends string>(reason: Reason) => ({ ok: false as const, reason })

function inspect(state: Readonly<CampaignTurnState>, side: Side, board?: CampaignGroundMovementBoard) {
  if (!movementOpen(state, side)) return refuse('window-closed')
  if (state.groundMovement?.interruption) return refuse('movement-awaits-response')
  const position = board && campaignMovementPosition(state, side, board)
  return position && board ? { ok: true as const, position, board } : refuse('board-unavailable')
}

function proposeMode(state: Readonly<CampaignTurnState>, position: Position, { id, mode }: CampaignGroundMover) {
  const current = position.friendly.get(id)
  if (!current) return refuse('choose-friendly-counter')
  if (position.stopped.has(id) || position.locked.has(id)) return refuse('counter-cannot-spend-mp')
  if (position.ferryPontoons.has(id)) return refuse('pontoon-has-active-ferry')
  if (position.engineeringPontoons.has(id)) return refuse('pontoon-committed-to-engineering')
  const counter = state.counters[id]!
  if (mode === undefined || mode === counter.mode) return { ok: true as const, counter, ...current }
  if (mode !== 'combat' && mode !== 'move' && mode !== 'strat') return refuse('invalid-mode')
  if (counter.kind === 'transport' && mode !== 'move') return refuse('transport-mode')
  if (mode === 'strat' && (counter.disorganized || zocAffectsAction('stratMode', position.enemyZoc.has(current.hex), false))) {
    return refuse('strategic-mode-unavailable')
  }
  return { ok: true as const, counter: { ...counter, mode }, ...current }
}

function movementUnit(board: CampaignGroundMovementBoard, proposed: Readonly<CampaignTurnState>, id: string, combatFace: boolean) {
  const profile = board.moveProfile(proposed, id)
  if (!profile || !Number.isFinite(profile.ma) || profile.ma <= 0) return refuse('no-movement-allowance')
  if (!profile.fuelReady) return refuse('needs-fuel')
  const mode = campaignCounterGroundMode(proposed.counters[id]!, combatFace)
  return { ok: true as const, unit: { mobility: profile.mobility,
    allowance: profile.ma * groundModeMovementFactor(mode, 'movement'), strategic: mode.marker === 'strat' } }
}

function formerPontoonBridge(state: Readonly<CampaignTurnState>, proposed: Readonly<CampaignTurnState>, id: string, hex: string,
  profile: CampaignGroundProfile) {
  if (campaignCombatPontoon(state.counters[id]!, profile) && !campaignCombatPontoon(proposed.counters[id]!, profile)) return hex
}

function planMove(state: Readonly<CampaignTurnState>, side: Side, action: MoveCampaignGround, config?: CampaignGroundMovementBoard) {
  const inspected = inspect(state, side, config)
  if (!inspected.ok) return inspected
  const { board, position } = inspected
  const { movers, path } = action
  if (!path.length || !movers.length || new Set(movers.map(({ id }) => id)).size !== movers.length ||
    movers.some(({ stopAfter }) => stopAfter !== undefined && (!Number.isSafeInteger(stopAfter) || stopAfter < 1 || stopAfter > path.length)) ||
    !movers.some(({ stopAfter }) => stopAfter === undefined || stopAfter === path.length)) return refuse('invalid-route')
  const route = normalizeCampaignMarchPath(board, path)
  if (!route) return refuse('outside-play-area')
  const proposed = { ...state, counters: { ...state.counters } }
  let origin: string | undefined
  for (const mover of movers) {
    const choice = proposeMode(state, position, mover)
    if (!choice.ok) return choice
    if (origin && origin !== choice.hex) return refuse('stack-not-co-located')
    origin = choice.hex
    proposed.counters[mover.id] = choice.counter
  }
  const members: CampaignMarchMover[] = []
  for (const { id, stopAfter } of movers) {
    const { hex, profile } = position.friendly.get(id)!
    const prepared = movementUnit(board, proposed, id, profile.inCombatMode)
    if (!prepared.ok) return prepared
    members.push({ id, combat: profile.combat, unit: prepared.unit, progress: { hex, spent: 0, stop: null },
      stepsLeft: stopAfter ?? route.length, ownBridgeDeparture: formerPontoonBridge(state, proposed, id, hex, profile) })
  }
  return planCampaignGroundMarch(proposed, side, board, { movers: members, path: route, started: false })
}

export function campaignGroundMovementOptions(state: Readonly<CampaignTurnState>, side: Side, config?: CampaignGroundMovementBoard) {
  if (!movementOpen(state, side) || state.groundMovement?.interruption) return null
  const inspected = inspect(state, side, config)
  if (!inspected.ok) return { configured: false, availableIds: [], zocHoldIds: [], endBlockers: null, crossedReByHexside: {} }
  const { position } = inspected
  const uncommitted = [...position.friendly].filter(([id]) => !position.stopped.has(id) && !position.locked.has(id))
  const availableIds = uncommitted.flatMap(([id]) => position.ferryPontoons.has(id) || position.engineeringPontoons.has(id) ? [] : [id])
  const zocHoldIds = uncommitted.flatMap(([id, { hex, profile }]) => profile.combat && position.enemyZoc.has(hex) ? [id] : [])
  return { configured: true, availableIds, zocHoldIds, endBlockers: config?.endBlockers?.(state, side)?.slice() ?? null,
    crossedReByHexside: { ...state.groundMovement?.crossedReByHexside } }
}

export function previewCampaignGroundMove(state: Readonly<CampaignTurnState>, side: Side, action: MoveCampaignGround,
  config?: CampaignGroundMovementBoard) {
  return campaignMarchPreview(planMove(state, side, action, config))
}

export function campaignGroundDestinations(state: Readonly<CampaignTurnState>, side: Side, mover: CampaignGroundMover,
  config?: CampaignGroundMovementBoard) {
  const inspected = inspect(state, side, config)
  if (!inspected.ok) return inspected
  const { position, board } = inspected
  const choice = proposeMode(state, position, mover)
  if (!choice.ok) return choice
  const { id } = mover
  const proposed = { ...state, counters: { ...state.counters, [id]: choice.counter } }
  const prepared = movementUnit(board, proposed, id, choice.profile.inCombatMode)
  if (!prepared.ok) return prepared
  const destinations = campaignMarchDestinations(proposed, side, board, { id, combat: choice.profile.combat, unit: prepared.unit,
    progress: { hex: choice.hex, spent: 0, stop: null }, ownBridgeDeparture: formerPontoonBridge(state, proposed, id, choice.hex, choice.profile) })
  return { ok: true as const, destinations }
}

export function applyCampaignGroundMovement(state: Readonly<CampaignTurnState>, side: Side,
  action: CampaignGroundMovementAction, config?: CampaignGroundMovementBoard): CampaignTurnState {
  if (action.type === 'move-campaign-ground') {
    const planned = planMove(state, side, action, config)
    if (!planned.ok) throw new Error(`Campaign ground movement: ${planned.reason}`)
    return planned.settled
  }
  if (action.type === 'complete-campaign-ground-movement') {
    const inspected = inspect(state, side, config)
    if (!inspected.ok) throw new Error(`Campaign ground movement: ${inspected.reason}`)
    const blockers = inspected.board.endBlockers?.(state, side)
    if (!blockers) throw new Error('Campaign ground movement: end-rules-unavailable')
    if (blockers.length) throw new Error(`Campaign ground movement: ${blockers.join(', ')}`)
    return { ...state, movementSegment: 'barrage' }
  }
  const options = campaignGroundMovementOptions(state, side, config)
  if (!options?.zocHoldIds.includes(action.counterId)) throw new Error('Campaign ground movement: cannot-hold-zoc')
  return { ...state, groundMovement: { ...state.groundMovement, moved: state.groundMovement?.moved ?? [],
    zocLocks: [...(state.groundMovement?.zocLocks ?? []), action.counterId] } }
}
