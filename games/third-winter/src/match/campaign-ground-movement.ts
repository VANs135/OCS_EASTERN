import { canMoveInPhase, canReleaseReserve, groundModeMovementFactor, type MovementSegmentPhase } from '@ocs-eastern/series/modes'
import type { Side } from '@ocs-eastern/series/state-types'
import { actingSide } from '@ocs-eastern/series/turn'
import { zocAffectsAction } from '@ocs-eastern/series/zoc'
import { campaignMarchDestinations, campaignMarchPreview, planCampaignGroundMarch } from './campaign-ground-march.ts'
import type { CampaignMarchInterruption, CampaignMarchMover } from './campaign-ground-march.ts'
import { campaignCombatPontoon, campaignCounterGroundMode, normalizeCampaignPath } from './campaign-ground-position.ts'
import type { CampaignGroundProfile } from './campaign-ground-position.ts'
import { campaignMovementPosition } from './campaign-movement-board.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import type { CampaignRailWork } from './campaign-rail-conversion.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignGroundMovementProgress {
  moved: readonly string[]
  zocLocks: readonly string[]
  approachByCounter?: Readonly<Record<string, { spent: number; allowance: number }>>
  railCapacitySpent?: number
  railConversionCount?: Readonly<Record<string, number>>
  railConvertedHexes?: readonly string[]
  railRepairRides?: Readonly<Record<string, { spent: number; usedNewTrack: boolean }>>
  crossedReByHexside?: Readonly<Record<string, number>>
  usedFerryIds?: readonly string[]
  interruption?: CampaignMarchInterruption
}

export interface CampaignGroundMover {
  id: string
  mode?: 'combat' | 'move' | 'strat'
  /** Leave the marching stack at this one-based step, or follow the whole route. */
  stopAfter?: number
  railWork?: readonly CampaignRailWork[]
}

export interface MoveCampaignGround {
  type: 'move-campaign-ground'
  movers: readonly CampaignGroundMover[]
  path: readonly string[]
}

export type CampaignGroundMovementAction = MoveCampaignGround | { type: 'hold-campaign-ground-zoc'; counterId: string }
  | { type: 'complete-campaign-ground-movement' } | { type: 'release-campaign-reserve'; counterId: string }

type Position = NonNullable<ReturnType<typeof campaignMovementPosition>>

/** 通规 2.2/6.0/6.3a/11.0a：移动窗在移动阶段（阶段玩家）、反应阶段（非阶段玩家的释放预备）、进击阶段（阶段玩家的进击/释放预备）开放。 */
function movementSegmentPhase(state: Readonly<CampaignTurnState>, side: Side): MovementSegmentPhase | null {
  const cursor = state.cursor
  if (!('phasing' in cursor)) return null
  if (cursor.phase === 'movement') {
    return state.movementSegment === 'movement' && cursor.phasing === side ? 'movement' : null
  }
  if (cursor.phase === 'reaction' || cursor.phase === 'exploitation') {
    if (state.lateTurnSegment !== 'movement') return null
    return actingSide(cursor.phasing, cursor.phase) === side ? cursor.phase : null
  }
  return null
}

function movementOpen(state: Readonly<CampaignTurnState>, side: Side) {
  return movementSegmentPhase(state, side) !== null
}

const refuse = <Reason extends string>(reason: Reason) => ({ ok: false as const, reason })

function inspect(state: Readonly<CampaignTurnState>, side: Side, board?: CampaignGroundMovementBoard) {
  if (!movementOpen(state, side)) return refuse('window-closed')
  if (state.groundMovement?.interruption) return refuse('movement-awaits-response')
  const position = board && campaignMovementPosition(state, side, board)
  return position && board ? { ok: true as const, position, board } : refuse('board-unavailable')
}

function proposeMode(state: Readonly<CampaignTurnState>, position: Position, { id, mode }: CampaignGroundMover,
  phase: MovementSegmentPhase) {
  const current = position.friendly.get(id)
  if (!current) return refuse('choose-friendly-counter')
  if (state.counters[id]?.held) return refuse('counter-held')
  if (position.stopped.has(id) || position.locked.has(id)) return refuse('counter-cannot-spend-mp')
  if (position.ferryPontoons.has(id)) return refuse('pontoon-has-active-ferry')
  if (position.engineeringPontoons.has(id)) return refuse('pontoon-committed-to-engineering')
  const counter = state.counters[id]!
  if (mode === undefined || mode === counter.mode) return { ok: true as const, counter, ...current }
  // 通规 5.4：主动模式切换只在移动阶段；反应/进击阶段不得借移动切模式。
  if (phase !== 'movement') return refuse('mode-switch-only-in-movement')
  if (state.groundMovement?.railRepairRides?.[id]) return refuse('cannot-change-mode-after-rail')
  if (mode !== 'combat' && mode !== 'move' && mode !== 'strat') return refuse('invalid-mode')
  if (counter.kind === 'transport' && mode !== 'move') return refuse('transport-mode')
  if (mode === 'strat' && (counter.disorganized || zocAffectsAction('stratMode', position.enemyZoc.has(current.hex), false))) {
    return refuse('strategic-mode-unavailable')
  }
  return { ok: true as const, counter: { ...counter, mode }, ...current }
}

function movementUnit(board: CampaignGroundMovementBoard, proposed: Readonly<CampaignTurnState>, id: string, combatFace: boolean,
  side: Side, phase: MovementSegmentPhase) {
  if (board.railOnly?.(proposed, id)) return refuse('hq-rail-only')
  const profile = board.moveProfile(proposed, id)
  if (!profile || !Number.isFinite(profile.ma) || profile.ma <= 0) return refuse('no-movement-allowance')
  // 通规 12.5 燃料支付只适用于机械化/轮式/履带单位；步行单位不需要燃料标记。
  if (!profile.fuelReady && profile.mobility !== 'leg') return refuse('needs-fuel')
  const mode = campaignCounterGroundMode(proposed.counters[id]!, combatFace)
  const activeSide = 'phasing' in proposed.cursor ? proposed.cursor.phasing : side
  if (!canMoveInPhase({ state: mode, side, activeSide }, phase).ok) return refuse('unit-cannot-move-in-phase')
  return { ok: true as const, unit: { mobility: profile.mobility,
    allowance: profile.ma * groundModeMovementFactor(mode, phase), strategic: mode.marker === 'strat' } }
}

function formerPontoonBridge(state: Readonly<CampaignTurnState>, proposed: Readonly<CampaignTurnState>, id: string, hex: string,
  profile: CampaignGroundProfile) {
  if (campaignCombatPontoon(state.counters[id]!, profile) && !campaignCombatPontoon(proposed.counters[id]!, profile)) return hex
}

function planMove(state: Readonly<CampaignTurnState>, side: Side, action: MoveCampaignGround, config?: CampaignGroundMovementBoard) {
  const inspected = inspect(state, side, config)
  if (!inspected.ok) return inspected
  const { board, position } = inspected
  const phase = movementSegmentPhase(state, side)!
  const { movers, path } = action
  if (!path.length || !movers.length || new Set(movers.map(({ id }) => id)).size !== movers.length ||
    movers.some(({ stopAfter }) => stopAfter !== undefined && (!Number.isSafeInteger(stopAfter) || stopAfter < 1 || stopAfter > path.length)) ||
    !movers.some(({ stopAfter }) => stopAfter === undefined || stopAfter === path.length)) return refuse('invalid-route')
  const route = normalizeCampaignPath(board.map, path)
  if (!route) return refuse('outside-play-area')
  // §2.4a：城内轴心地面单位不得自愿走出城市（按各 mover 自己的前进段逐步校验）。
  for (const { id, stopAfter } of movers) {
    const origin = position.friendly.get(id)?.hex
    if (!origin) return refuse('invalid-route')
    let from = origin
    for (let step = 0; step < Math.min(stopAfter ?? route.length, route.length); step++) {
      const refusal = config?.exitRefusal?.(state, id, from, route[step]!)
      if (refusal) return refuse(refusal)
      from = route[step]!
    }
  }
  const proposed = { ...state, counters: { ...state.counters } }
  let origin: string | undefined
  for (const mover of movers) {
    const choice = proposeMode(state, position, mover, phase)
    if (!choice.ok) return choice
    if (origin && origin !== choice.hex) return refuse('stack-not-co-located')
    origin = choice.hex
    proposed.counters[mover.id] = choice.counter
  }
  const members: CampaignMarchMover[] = []
  for (const { id, stopAfter, railWork = [] } of movers) {
    const { hex, profile } = position.friendly.get(id)!
    const prepared = movementUnit(board, proposed, id, profile.inCombatMode, side, phase)
    if (!prepared.ok) return prepared
    // OCS 8.1 突袭返回移动：仅突袭参与方可续走， allowance 取突袭余量 MP。
    const march = state.overrunMarch
    if (march?.enteredHex) {
      if (!Object.hasOwn(march.remaining, id)) return refuse('overrun-march-pending')
      prepared.unit.allowance = march.remaining[id]!
    }
    const stepsLeft = stopAfter ?? route.length
    if (new Set(railWork.map(({ step }) => step)).size !== railWork.length) return refuse('invalid-rail-work')
    const work = new Map<number, readonly string[]>()
    for (const { step, connections } of railWork) {
      const normalized = normalizeCampaignPath(board.map, connections)
      if (!Number.isSafeInteger(step) || step < 1 || step > stepsLeft || !normalized?.length ||
        new Set(normalized).size !== normalized.length) return refuse('invalid-rail-work')
      work.set(step, normalized)
    }
    const spent = state.groundMovement?.railRepairRides?.[id]?.spent ?? 0
    if (spent >= prepared.unit.allowance) return refuse('no-movement-allowance')
    members.push({ id, combat: profile.combat, unit: prepared.unit, progress: { hex, spent, stop: null },
      stepsLeft, railWork: work.size ? [...work.entries()] : undefined,
      ownBridgeDeparture: formerPontoonBridge(state, proposed, id, hex, profile) })
  }
  const march = planCampaignGroundMarch(proposed, side, board, { movers: members, path: route, started: false })
  if (!march.ok) return march
  let settled = march.settled
  if (state.overrunMarch?.enteredHex) {
    const remaining = { ...state.overrunMarch.remaining }
    for (const placement of march.placements) {
      if (Object.hasOwn(remaining, placement.id)) remaining[placement.id] = remaining[placement.id]! - placement.spent
    }
    settled = { ...settled, overrunMarch: { remaining, enteredHex: true },
      groundMovement: { ...settled.groundMovement, zocLocks: settled.groundMovement?.zocLocks ?? [],
        moved: [...new Set([...(settled.groundMovement?.moved ?? []), ...members.map(({ id }) => id)])] } }
  }
  // The route and the kind of each mover are kept for the scenario rules that settle after the move.
  return { ...march, settled, route, movers: members.map(({ id, combat, stepsLeft }) => ({ id, combat, stepsLeft })) }
}

/** Drop the scenario hold of the released counters. A release lasts for the rest of the game. */
export function releaseCampaignCounters(state: Readonly<CampaignTurnState>, released: readonly string[]) {
  if (!released.length) return state
  const counters = { ...state.counters }
  for (const id of released) {
    if (!counters[id]?.held) continue
    const counter = { ...counters[id]! }
    delete counter.held
    counters[id] = counter
  }
  return { ...state, counters }
}

/** 通规 5.7b：换阶段/换段即清除「本阶段刚释放」时点事实（释放本身已永久摘掉预备标记）。 */
export function clearCampaignReserveRelease(state: Readonly<CampaignTurnState>): CampaignTurnState {
  let changed = false
  const counters = { ...state.counters }
  for (const [id, counter] of Object.entries(counters)) {
    if (counter.released === true) { counters[id] = { ...counter, released: false }; changed = true }
  }
  return changed ? { ...state, counters } : state
}

export function campaignGroundMovementOptions(state: Readonly<CampaignTurnState>, side: Side, config?: CampaignGroundMovementBoard) {
  if (!movementOpen(state, side) || state.groundMovement?.interruption) return null
  const inspected = inspect(state, side, config)
  if (!inspected.ok) return { configured: false, availableIds: [], zocHoldIds: [], heldIds: [], endBlockers: null, crossedReByHexside: {} }
  const { position } = inspected
  const heldIds = [...position.friendly.keys()].filter((id) => Boolean(state.counters[id]?.held))
  const held = new Set(heldIds)
  const uncommitted = [...position.friendly].filter(([id]) => !position.stopped.has(id) && !position.locked.has(id) && !held.has(id))
  const phase = movementSegmentPhase(state, side)!
  const activeSide = 'phasing' in state.cursor ? state.cursor.phasing : side
  const availableIds = uncommitted.flatMap(([id, { profile }]) => {
    if (position.ferryPontoons.has(id) || position.engineeringPontoons.has(id) || config?.railOnly?.(state, id)) return []
    const mode = campaignCounterGroundMode(state.counters[id]!, profile.inCombatMode)
    return canMoveInPhase({ state: mode, side, activeSide }, phase).ok ? [id] : []
  })
  const zocHoldIds = uncommitted.flatMap(([id, { hex, profile }]) => profile.combat && position.enemyZoc.has(hex) ? [id] : [])
  return { configured: true, availableIds, zocHoldIds, heldIds, endBlockers: config?.endBlockers?.(state, side)?.slice() ?? null,
    crossedReByHexside: { ...state.groundMovement?.crossedReByHexside } }
}

export function previewCampaignGroundMove(state: Readonly<CampaignTurnState>, side: Side, action: MoveCampaignGround,
  config?: CampaignGroundMovementBoard) {
  return campaignMarchPreview(planMove(state, side, action, config), state)
}

export function campaignGroundDestinations(state: Readonly<CampaignTurnState>, side: Side, mover: CampaignGroundMover,
  config?: CampaignGroundMovementBoard) {
  const inspected = inspect(state, side, config)
  if (!inspected.ok) return inspected
  const { position, board } = inspected
  const phase = movementSegmentPhase(state, side)!
  const choice = proposeMode(state, position, mover, phase)
  if (!choice.ok) return choice
  const { id } = mover
  const proposed = { ...state, counters: { ...state.counters, [id]: choice.counter } }
  const prepared = movementUnit(board, proposed, id, choice.profile.inCombatMode, side, phase)
  if (!prepared.ok) return prepared
  if (state.overrunMarch?.enteredHex) {
    if (!Object.hasOwn(state.overrunMarch.remaining, id)) return refuse('overrun-march-pending')
    prepared.unit.allowance = state.overrunMarch.remaining[id]!
  }
  const spent = state.groundMovement?.railRepairRides?.[id]?.spent ?? 0
  if (spent >= prepared.unit.allowance) return refuse('no-movement-allowance')
  const destinations = campaignMarchDestinations(proposed, side, board, { id, combat: choice.profile.combat, unit: prepared.unit,
    progress: { hex: choice.hex, spent, stop: null }, ownBridgeDeparture: formerPontoonBridge(state, proposed, id, choice.hex, choice.profile) })
  return { ok: true as const, destinations }
}

export function applyCampaignGroundMovement(state: Readonly<CampaignTurnState>, side: Side,
  action: CampaignGroundMovementAction, config?: CampaignGroundMovementBoard): CampaignTurnState {
  if (action.type === 'release-campaign-reserve') {
    const phase = movementSegmentPhase(state, side)
    if (phase !== 'reaction' && phase !== 'exploitation') throw new Error('Campaign ground movement: reserve release only in reaction/exploitation')
    const counter = state.counters[action.counterId]
    if (!counter || counter.side !== side || counter.location.kind !== 'map') throw new Error('Campaign ground movement: choose a friendly on-map counter')
    const activeSide = 'phasing' in state.cursor ? state.cursor.phasing : side
    const verdict = canReleaseReserve({ state: campaignCounterGroundMode(counter, false), side, activeSide, phase })
    if (!verdict.ok) throw new Error(`Campaign ground movement: ${verdict.reason}`)
    return { ...state, counters: { ...state.counters, [action.counterId]: { ...counter, released: true } } }
  }
  if (action.type === 'move-campaign-ground') {
    const planned = planMove(state, side, action, config)
    if (!planned.ok) throw new Error(`Campaign ground movement: ${planned.reason}`)
    const settled = config?.afterMove?.(planned.settled, side,
      { path: planned.route, movers: planned.movers, placements: planned.placements, reached: planned.reached }) ?? planned.settled
    return releaseCampaignCounters(settled, config?.releases?.(settled, side,
      { path: planned.route, movers: planned.movers, placements: planned.placements, reached: planned.reached }) ?? [])
  }
  if (action.type === 'complete-campaign-ground-movement') {
    if (state.cursor.phase !== 'movement') throw new Error('Campaign ground movement: complete reaction/exploitation via the phase segment')
    const inspected = inspect(state, side, config)
    if (!inspected.ok) throw new Error(`Campaign ground movement: ${inspected.reason}`)
    const blockers = inspected.board.endBlockers?.(state, side)
    if (!blockers) throw new Error('Campaign ground movement: end-rules-unavailable')
    if (blockers.length) throw new Error(`Campaign ground movement: ${blockers.join(', ')}`)
    // A German unit may have come within range by rail, breakout or ferry earlier in the segment; settle proximity at its end.
    const settled = releaseCampaignCounters(state, config?.releases?.(state, side, { path: [], movers: [] }) ?? [])
    return { ...settled, movementSegment: 'barrage', overrunMarch: null }
  }
  const options = campaignGroundMovementOptions(state, side, config)
  if (!options?.zocHoldIds.includes(action.counterId)) throw new Error('Campaign ground movement: cannot-hold-zoc')
  return { ...state, groundMovement: { ...state.groundMovement, moved: state.groundMovement?.moved ?? [],
    zocLocks: [...(state.groundMovement?.zocLocks ?? []), action.counterId] } }
}
