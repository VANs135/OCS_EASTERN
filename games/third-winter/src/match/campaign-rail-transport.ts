import { edgeKey } from '@ocs-eastern/series/ground-map'
import { inspectRailRoute, railCapacityCost, transportEquivalentOf } from '@ocs-eastern/series/rail-transport'
import type { RailCargo, RailRouteBoard } from '@ocs-eastern/series/rail-transport'
import type { Side } from '@ocs-eastern/series/state-types'
import { khersonRailFerryHexside } from '../ttw/campaign/kherson-ferry.ts'
import { campaignCounterGroundMode, normalizeCampaignPath } from './campaign-ground-position.ts'
import { khersonFerryLockedSupply, removeKhersonStartingSupply } from './campaign-kherson-ferry.ts'
import { campaignMovementPosition } from './campaign-movement-board.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'
import { campaignDemolishableBridges, reconcileCampaignBridgeRepairs } from './campaign-volga-bridges.ts'

/** Facts for ordinary on-map rail. The work supplies scenario capacity, current gauge and usable facilities. */
export interface CampaignRailBoard {
  capacity(state: Readonly<CampaignTurnState>, side: Side): number | undefined
  ordinaryCargo(state: Readonly<CampaignTurnState>, id: string): boolean
  edge(state: Readonly<CampaignTurnState>, side: Side, from: string, to: string): ReturnType<RailRouteBoard['edge']>
  controlBlocksAt(state: Readonly<CampaignTurnState>, side: Side, hex: string): boolean
  /** Includes source connectivity, control and applicable TTW facilities. Vehicle ZOC is checked separately. */
  detrainable(state: Readonly<CampaignTurnState>, side: Side, hex: string): boolean
  trainbustingAt(state: Readonly<CampaignTurnState>, side: Side, hex: string): boolean
}

export interface TransportCampaignRail {
  type: 'transport-campaign-rail'
  /** Includes both boarding and unloading hexes. */
  path: readonly string[]
  counterIds: readonly string[]
  moveFaceIds?: readonly string[]
  supplyTokens: number
}

const tokensPerSp = 4
const refuse = <Reason extends string>(reason: Reason) => ({ ok: false as const, reason })

function railWindow(state: Readonly<CampaignTurnState>, side: Side, rail?: CampaignRailBoard) {
  if (state.cursor.phase !== 'movement' || state.cursor.phasing !== side || state.movementSegment !== 'movement' || state.groundMovement?.interruption) {
    return refuse('window-closed')
  }
  const capacity = rail?.capacity(state, side)
  if (capacity === undefined || !Number.isFinite(capacity) || capacity < 0) return refuse('rail-capacity-unavailable')
  return { ok: true as const, capacity, remainingCapacity: Math.max(0, capacity - (state.groundMovement?.railCapacitySpent ?? 0)) }
}

export function campaignRailStatus(state: Readonly<CampaignTurnState>, side: Side, rail?: CampaignRailBoard) {
  const window = railWindow(state, side, rail)
  return window.ok ? { capacity: window.capacity, remainingCapacity: window.remainingCapacity } : null
}

function railPosition(state: Readonly<CampaignTurnState>, side: Side, rail?: CampaignRailBoard, ground?: CampaignGroundMovementBoard) {
  const window = railWindow(state, side, rail)
  if (!window.ok) return window
  const position = ground && campaignMovementPosition(state, side, ground)
  if (!rail || !ground || !position) return refuse('board-unavailable')
  return { ...window, rail, ground, position }
}

type OpenRailPosition = Extract<ReturnType<typeof railPosition>, { ok: true }>

function boardingChoice(state: Readonly<CampaignTurnState>, id: string, from: string, { rail, position }: OpenRailPosition) {
  const current = position.friendly.get(id)
  if (current?.hex !== from || !rail.ordinaryCargo(state, id) || position.locked.has(id) ||
    position.ferryPontoons.has(id) || position.engineeringPontoons.has(id)) return undefined
  const counter = state.counters[id]!
  const mode = campaignCounterGroundMode(counter, current.profile.inCombatMode)
  if (mode.marker === 'dg') return undefined
  const needsMoveFace = counter.kind === 'transport' ? mode.marker !== undefined : mode.face !== 'move' || mode.marker !== undefined
  const approach = state.groundMovement?.approachByCounter?.[id]
  if (position.stopped.has(id) && (!approach || needsMoveFace || approach.spent > approach.allowance / 2)) return undefined

  let cargo: RailCargo
  if (counter.kind === 'transport') {
    const size = counter.transportPoints ?? (current.profile.singleTransportPoint ? 1 : 0)
    if (!Number.isFinite(size) || size <= 0) return undefined
    cargo = { kind: 'transportPoint', size }
  } else {
    const { moveMa, moveMobility } = current.profile
    const re = counter.currentRe
    if (!current.profile.combat || re === undefined || !Number.isFinite(re) || re <= 0 || !Number.isFinite(moveMa) || moveMa < 0) return undefined
    cargo = { kind: 'unit', re, mobility: moveMobility, moveMa }
  }
  return { cargo, needsMoveFace }
}

function unlockedSupply(state: Readonly<CampaignTurnState>, side: Side, hex: string) {
  return Math.max(0, (state.supplyDumps[side][hex] ?? 0) - khersonFerryLockedSupply(state, side, hex))
}

function routeBoard(state: Readonly<CampaignTurnState>, side: Side, { rail, ground, position }: OpenRailPosition): RailRouteBoard {
  return {
    edge(from, to) {
      const key = edgeKey(from, to)
      if (key === khersonRailFerryHexside || state.volgaBridgeDecisions?.[key] === 'blown' || !ground.map.neighbors(from).includes(to)) return undefined
      return rail.edge(state, side, from, to)
    },
    rawEnemyZocAt: (hex) => position.enemyZoc.has(hex),
    enemyCombatAt: (hex) => position.enemyCombat.has(hex),
    controlBlocksAt: (hex) => rail.controlBlocksAt(state, side, hex),
    trainbustingAt: (hex) => rail.trainbustingAt(state, side, hex),
  }
}

export function campaignRailLoading(state: Readonly<CampaignTurnState>, side: Side, source: string,
  rail?: CampaignRailBoard, ground?: CampaignGroundMovementBoard) {
  const window = railPosition(state, side, rail, ground)
  if (!window.ok) return window
  const from = window.ground.map.resolveHex(source)
  if (!from) return refuse('outside-play-area')
  const board = routeBoard(state, side, window)
  if (!window.rail.detrainable(state, side, from) || board.rawEnemyZocAt(from) || board.enemyCombatAt(from) ||
    board.controlBlocksAt(from)) return refuse('rail-boarding-unavailable')
  const counters = [...window.position.friendly.keys()].flatMap((id) => {
    const choice = boardingChoice(state, id, from, window)
    return choice ? [{ id, needsMoveFace: choice.needsMoveFace, equivalent: transportEquivalentOf(choice.cargo) }] : []
  })
  return { ok: true as const, from, remainingCapacity: window.remainingCapacity, counters, supplyTokens: unlockedSupply(state, side, from) }
}

function planRailTransport(state: Readonly<CampaignTurnState>, side: Side, action: TransportCampaignRail,
  rail?: CampaignRailBoard, ground?: CampaignGroundMovementBoard) {
  const window = railPosition(state, side, rail, ground)
  if (!window.ok) return window
  const path = normalizeCampaignPath(window.ground.map, action.path)
  if (!path) return refuse('outside-play-area')
  const from = path[0]
  const to = path.at(-1)
  if (!from || !to || from === to) return refuse('rail-route-too-short')
  const route = inspectRailRoute(path, routeBoard(state, side, window))
  if (!route.ok) return route
  if (!window.rail.detrainable(state, side, from)) return refuse('rail-boarding-unavailable')
  if (!window.rail.detrainable(state, side, to)) return refuse('rail-unloading-unavailable')

  const { counterIds, moveFaceIds = [], supplyTokens } = action
  const selected = new Set(counterIds)
  const flips = new Set(moveFaceIds)
  if (!Number.isSafeInteger(supplyTokens) || supplyTokens < 0 || (!counterIds.length && !supplyTokens) ||
    selected.size !== counterIds.length || flips.size !== moveFaceIds.length || moveFaceIds.some((id) => !selected.has(id))) return refuse('invalid-cargo')
  if (supplyTokens > unlockedSupply(state, side, from)) return refuse('rail-supply-unavailable')
  const cargo: RailCargo[] = supplyTokens ? [{ kind: 'sp', amount: supplyTokens / tokensPerSp }] : []
  for (const id of counterIds) {
    const choice = boardingChoice(state, id, from, window)
    if (!choice || choice.needsMoveFace && !flips.has(id)) return refuse('counter-ineligible-for-rail')
    cargo.push(choice.cargo)
  }
  const charge = railCapacityCost(cargo, route)
  if (!Number.isFinite(charge.cost) || charge.cost > window.remainingCapacity) return refuse('rail-capacity-exceeded')

  const other = side === 'axis' ? 'soviet' : 'axis'
  for (const hex of path.slice(1)) {
    if (window.position.enemyNoncombat.has(hex) || (state.supplyDumps[other][hex] ?? 0) > 0 || window.ground.entryRequiresResolution(state, side, hex)) {
      return { ...refuse('rail-entry-unresolved'), hex }
    }
    if (side === 'soviet' && counterIds.some((id) => window.position.friendly.get(id)?.profile.combat &&
      campaignDemolishableBridges(state, window.ground, id, hex).length > 0)) return { ...refuse('rail-bridge-response-unavailable'), hex }
  }

  const counters = { ...state.counters }
  const approachByCounter = { ...state.groundMovement?.approachByCounter }
  const moved = new Set(state.groundMovement?.moved)
  for (const id of counterIds) {
    counters[id] = { ...counters[id]!, mode: 'move', location: { kind: 'map', hex: to } }
    delete approachByCounter[id]
    moved.add(id)
  }
  const dumps = { ...state.supplyDumps[side] }
  if (supplyTokens) {
    const received = (dumps[to] ?? 0) + supplyTokens
    if (!Number.isSafeInteger(received) || received < supplyTokens) return refuse('invalid-rail-supply-total')
    dumps[from] = dumps[from]! - supplyTokens
    if (dumps[from] === 0) delete dumps[from]
    dumps[to] = received
  }
  const remainingCapacity = window.remainingCapacity - charge.cost
  const settled = reconcileCampaignBridgeRepairs({ ...state, counters, supplyDumps: { ...state.supplyDumps, [side]: dumps },
    khersonFerryPhase: removeKhersonStartingSupply(state, side, from, supplyTokens),
    groundMovement: { ...state.groundMovement, moved: [...moved], zocLocks: state.groundMovement?.zocLocks ?? [],
      approachByCounter, railCapacitySpent: (state.groundMovement?.railCapacitySpent ?? 0) + charge.cost },
  }, window.ground)
  return { ok: true as const, from, to, ...charge, remainingCapacity, settled }
}

export function previewCampaignRailTransport(state: Readonly<CampaignTurnState>, side: Side, action: TransportCampaignRail,
  rail?: CampaignRailBoard, ground?: CampaignGroundMovementBoard) {
  const result = planRailTransport(state, side, action, rail, ground)
  if (!result.ok) return result
  const { settled: _settled, ...preview } = result
  return preview
}

export function applyCampaignRailTransport(state: Readonly<CampaignTurnState>, side: Side, action: TransportCampaignRail,
  rail?: CampaignRailBoard, ground?: CampaignGroundMovementBoard) {
  const result = planRailTransport(state, side, action, rail, ground)
  if (!result.ok) throw new Error(`Campaign rail transport: ${result.reason}`)
  return result.settled
}
