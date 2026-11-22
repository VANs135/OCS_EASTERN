import { edgeKey } from '@ocs-eastern/series/ground-map'
import type { Side } from '@ocs-eastern/series/state-types'
import { khersonFerryBanks } from '../ttw/campaign/kherson-ferry.ts'
import { volgaHexsidePhaseLimitRe } from '../ttw/campaign/volga-movement.ts'
import { campaignCounterGroundMode } from './campaign-ground-position.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import { campaignMovementPosition } from './campaign-movement-board.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'
import { reconcileCampaignBridgeRepairs } from './campaign-volga-bridges.ts'

export interface CampaignKhersonFerryPhase {
  turn: number
  side: Side
  starts: Readonly<Record<string, string>>
  startingSupply: Readonly<Record<string, number>>
  sentSupply: Readonly<Record<string, number>>
  removedStartingSupply?: Readonly<Record<string, number>>
}

export interface UseCampaignKhersonFerry {
  type: 'use-campaign-kherson-ferry'
  from: string
  unitIds: readonly string[]
  /** An explicit free switch to the move face before ferrying. */
  moveFaceIds?: readonly string[]
  supplyTokens: number
}

const tokensPerSp = 4
const refuse = <Reason extends string>(reason: Reason) => ({ ok: false as const, reason })

export function khersonFerryLockedSupply(state: Readonly<CampaignTurnState>, side: Side, hex: string) {
  const phase = state.khersonFerryPhase
  if (!phase || phase.turn !== state.turn || phase.side !== side) return 0
  const departureBank = Object.keys(phase.startingSupply).find((bank) => bank !== hex)
  return Object.hasOwn(phase.startingSupply, hex) && departureBank ? phase.sentSupply[departureBank] ?? 0 : 0
}

/** Other transport removes the original, unlocked stock before any later arrivals at this bank. */
export function removeKhersonStartingSupply(state: Readonly<CampaignTurnState>, side: Side, hex: string, tokens: number) {
  const phase = state.khersonFerryPhase
  if (!tokens || !phase || phase.turn !== state.turn || phase.side !== side || !Object.hasOwn(phase.startingSupply, hex)) return phase
  const removed = Math.min((phase.startingSupply[hex] ?? 0) - (phase.sentSupply[hex] ?? 0),
    (phase.removedStartingSupply?.[hex] ?? 0) + tokens)
  return { ...phase, removedStartingSupply: { ...phase.removedStartingSupply, [hex]: removed } }
}

/** TTW 1.4d. Record the actual phase start, before breakout or any other movement. */
export function beginCampaignKhersonFerryPhase(state: Readonly<CampaignTurnState>, side: Side, map?: CampaignGroundMap): CampaignTurnState {
  const banks = map && khersonFerryBanks((hex) => map.resolveHex(hex))
  if (!map || !banks) return state.khersonFerryPhase ? { ...state, khersonFerryPhase: undefined } : state
  const safeBanks = new Set(banks)
  const starts = Object.fromEntries(Object.entries(state.counters).flatMap(([id, unit]) => {
    if (unit.side !== side || unit.kind === 'aircraft' || unit.location.kind !== 'map') return []
    const hex = map.resolveHex(unit.location.hex)
    return hex && safeBanks.has(hex) ? [[id, hex]] : []
  }))
  const startingSupply = Object.fromEntries(banks.map((hex) => [hex, state.supplyDumps[side][hex] ?? 0]))
  return { ...state, khersonFerryPhase: { turn: state.turn, side, starts, startingSupply, sentSupply: {} } }
}

function inspectFerry(state: Readonly<CampaignTurnState>, side: Side, board?: CampaignGroundMovementBoard) {
  if (state.cursor.phase !== 'movement' || state.cursor.phasing !== side || state.movementSegment !== 'movement' || state.groundMovement?.interruption) {
    return refuse('window-closed')
  }
  const banks = board && khersonFerryBanks((hex) => board.map.resolveHex(hex))
  if (!board || !banks) return refuse('ferry-outside-play-area')
  if (state.weatherHistory.ice || !state.weather || state.weather.ground === 'thaw') return refuse('river-not-normal')
  const phase = state.khersonFerryPhase
  if (!phase || phase.side !== side || phase.turn !== state.turn) return refuse('phase-start-unavailable')
  const position = campaignMovementPosition(state, side, board)
  if (!position) return refuse('board-unavailable')
  if (banks.some((hex) => position.enemyZoc.has(hex))) return refuse('enemy-zoc-at-ferry')
  const other = side === 'axis' ? 'soviet' : 'axis'
  if (banks.some((hex) => position.enemyCombat.has(hex) || position.enemyNoncombat.has(hex) ||
    (state.supplyDumps[other][hex] ?? 0) > 0 || board.entryRequiresResolution(state, side, hex))) return refuse('ferry-entry-unresolved')
  const key = edgeKey(...banks)
  const usedRe = state.groundMovement?.crossedReByHexside?.[key] ?? 0
  const remainingRe = volgaHexsidePhaseLimitRe - usedRe
  if (remainingRe <= 0) return refuse('crossing-capacity')
  return { ok: true as const, board, phase, position, banks, key, remainingRe }
}

type FerryWindow = Extract<ReturnType<typeof inspectFerry>, { ok: true }>

function ferryLoadingOptions(state: Readonly<CampaignTurnState>, side: Side, window: FerryWindow, from: string) {
  const { position, phase, banks, remainingRe } = window
  const to = from === banks[0] ? banks[1] : banks[0]
  const units = [...position.friendly].flatMap(([id, { hex, profile }]) => {
    if (hex !== from || phase.starts[id] !== from || position.stopped.has(id) || position.locked.has(id) || state.groundMovement?.railRepairRides?.[id] ||
      position.ferryPontoons.has(id) || position.engineeringPontoons.has(id)) return []
    const counter = state.counters[id]!
    const mode = campaignCounterGroundMode(counter, profile.inCombatMode)
    if (mode.marker === 'dg') return []
    const re = counter.kind === 'transport' ? counter.transportPoints ?? (profile.singleTransportPoint ? 1 : undefined)
      : profile.combat ? counter.currentRe : undefined
    if (re === undefined || !Number.isFinite(re) || re <= 0 || re > remainingRe) return []
    const needsMoveFace = mode.face !== 'move' || mode.marker !== undefined
    if (needsMoveFace && (!Number.isFinite(profile.moveMa) || profile.moveMa < 0)) return []
    return [{ id, re, needsMoveFace }]
  })
  const original = (phase.startingSupply[from] ?? 0) - (phase.sentSupply[from] ?? 0) - (phase.removedStartingSupply?.[from] ?? 0)
  const onHand = (state.supplyDumps[side][from] ?? 0) - (phase.sentSupply[to] ?? 0)
  const supplyTokens = Math.max(0, Math.min(original, onHand, Math.floor(remainingRe * tokensPerSp)))
  return { from, to, units, supplyTokens }
}

export function campaignKhersonFerryOptions(state: Readonly<CampaignTurnState>, side: Side, board?: CampaignGroundMovementBoard) {
  const window = inspectFerry(state, side, board)
  if (!window.ok) return window.reason === 'window-closed' || window.reason === 'ferry-outside-play-area' ? null : window
  return { ok: true as const, remainingRe: window.remainingRe, banks: window.banks.map((hex) => ferryLoadingOptions(state, side, window, hex)) }
}

function planKhersonFerry(state: Readonly<CampaignTurnState>, side: Side, action: UseCampaignKhersonFerry, board?: CampaignGroundMovementBoard) {
  const window = inspectFerry(state, side, board)
  if (!window.ok) return window
  const from = window.board.map.resolveHex(action.from)
  if (!from || !window.banks.includes(from)) return refuse('choose-ferry-bank')
  const { unitIds, supplyTokens, moveFaceIds = [] } = action
  const selected = new Set(unitIds)
  const flips = new Set(moveFaceIds)
  if (!Number.isSafeInteger(supplyTokens) || supplyTokens < 0 || (!unitIds.length && supplyTokens === 0) || selected.size !== unitIds.length ||
    flips.size !== moveFaceIds.length || moveFaceIds.some((id) => !selected.has(id))) return refuse('invalid-cargo')
  const loading = ferryLoadingOptions(state, side, window, from)
  if (supplyTokens > loading.supplyTokens) return refuse('ferry-supply-unavailable')
  let re = supplyTokens / tokensPerSp
  for (const id of unitIds) {
    const unit = loading.units.find((candidate) => candidate.id === id)
    if (!unit || unit.needsMoveFace && !flips.has(id)) return refuse('counter-ineligible-for-ferry')
    re += unit.re
  }
  if (re > window.remainingRe) return refuse('crossing-capacity')
  const { to } = loading
  const remainingRe = window.remainingRe - re
  const counters = { ...state.counters }
  for (const id of unitIds) counters[id] = { ...counters[id]!, mode: 'move', location: { kind: 'map', hex: to } }
  const dumps = { ...state.supplyDumps[side] }
  if (supplyTokens) {
    const received = (dumps[to] ?? 0) + supplyTokens
    if (!Number.isSafeInteger(received) || received < supplyTokens) return refuse('invalid-ferry-supply-total')
    dumps[from] = dumps[from]! - supplyTokens
    if (dumps[from] === 0) delete dumps[from]
    dumps[to] = received
  }
  const settled = reconcileCampaignBridgeRepairs({ ...state, counters, supplyDumps: { ...state.supplyDumps, [side]: dumps },
    groundMovement: { ...state.groundMovement, zocLocks: state.groundMovement?.zocLocks ?? [], moved: [...(state.groundMovement?.moved ?? []), ...unitIds],
      crossedReByHexside: { ...state.groundMovement?.crossedReByHexside, [window.key]: volgaHexsidePhaseLimitRe - remainingRe } },
    khersonFerryPhase: { ...window.phase, sentSupply: { ...window.phase.sentSupply, [from]: (window.phase.sentSupply[from] ?? 0) + supplyTokens } },
  }, window.board)
  return { ok: true as const, from, to, re, remainingRe, settled }
}

export function previewCampaignKhersonFerry(state: Readonly<CampaignTurnState>, side: Side, action: UseCampaignKhersonFerry, board?: CampaignGroundMovementBoard) {
  const result = planKhersonFerry(state, side, action, board)
  if (!result.ok) return result
  const { from, to, re, remainingRe } = result
  return { ok: true as const, from, to, re, remainingRe }
}

export function applyCampaignKhersonFerry(state: Readonly<CampaignTurnState>, side: Side, action: UseCampaignKhersonFerry, board?: CampaignGroundMovementBoard) {
  const result = planKhersonFerry(state, side, action, board)
  if (!result.ok) throw new Error(`Kherson rail ferry: ${result.reason}`)
  return result.settled
}
