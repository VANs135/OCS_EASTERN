import { edgeKey } from '@ocs-eastern/series/ground-map'
import type { Side } from '@ocs-eastern/series/state-types'
import { khersonRailFerryHexside } from '../ttw/campaign/kherson-ferry.ts'
import { bridgeRepairProgress } from '../ttw/campaign/bridge-repair.ts'
import { campaignCombatPontoon, campaignGroundPosition } from './campaign-ground-position.ts'
import { activeCampaignFerryHex } from './campaign-movement-board.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'
import { finishReadyVolgaBridgeRepairs, reconcileCampaignBridgeRepairs } from './campaign-volga-bridges.ts'

interface PontoonOrder { ferry?: 'deploy' | 'remove'; repair?: string }
export interface CampaignPontoonPhase {
  turn: number
  side: Side
  starts: Readonly<Record<string, { hex: string; enemyAdjacent: boolean }>>
  orders: Readonly<Record<string, PontoonOrder>>
}

export type CampaignPontoonAction = { type: 'deploy-campaign-ferry' | 'remove-campaign-ferry' | 'cancel-campaign-volga-repair'; pontoonId: string }
  | { type: 'repair-campaign-volga-bridge'; pontoonId: string; bridgeId: string }

export function campaignPontoonAtPhase(state: Readonly<CampaignTurnState>, side: Side) {
  const phase = state.pontoonPhase
  return state.cursor.phase === 'movement' && state.cursor.phasing === side && phase?.side === side && phase.turn === state.turn ? phase : undefined
}

/** TTW 1.5b. Finish ready bridges before any action in this side's Movement Phase. */
export function beginCampaignPontoonPhase(state: Readonly<CampaignTurnState>, side: Side, board?: CampaignGroundMovementBoard): CampaignTurnState {
  if (!board?.volgaCrossingAt) return state
  const position = campaignGroundPosition(state, side, board.map, board.profileOf)
  if (!position) return state
  const opened = finishReadyVolgaBridgeRepairs(reconcileCampaignBridgeRepairs(state, board), side)
  const starts = Object.fromEntries([...position.friendly].flatMap(([id, { hex, profile }]) => {
    if (!campaignCombatPontoon(state.counters[id]!, profile)) return []
    const enemyAdjacent = board.map.neighbors(hex).some((near) => position.enemyCombat.has(near))
    return [[id, { hex, enemyAdjacent }] as const]
  }))
  const orders = Object.fromEntries(Object.entries(opened.volgaBridgeRepairs ?? {}).flatMap(([bridge, repair]) => {
    if (repair.side !== side) return []
    const ends = bridge.split('|')
    return (repair.pontoonIds ?? []).flatMap((id) => starts[id] && ends.includes(starts[id].hex) ? [[id, { repair: bridge }] as const] : [])
  }))
  return { ...opened, pontoonPhase: { turn: state.turn, side, starts, orders } }
}

export function campaignPontoonOptions(state: Readonly<CampaignTurnState>, side: Side, board?: CampaignGroundMovementBoard) {
  const phase = campaignPontoonAtPhase(state, side)
  if (!phase || state.movementSegment !== 'movement' || state.groundMovement?.interruption || !board?.volgaCrossingAt) return null
  const position = campaignGroundPosition(state, side, board.map, board.profileOf)
  if (!position) return null
  const moved = new Set(state.groundMovement?.moved)
  return Object.entries(phase.starts).flatMap(([id, start]) => {
    const current = position.friendly.get(id)
    if (!current || start.hex !== current.hex || moved.has(id) || !campaignCombatPontoon(state.counters[id]!, current.profile)) return []
    const { hex } = current
    const neighbors = board.map.neighbors(hex)
    const crossings = neighbors.flatMap((near) => {
      const crossing = board.volgaCrossingAt?.(state, id, hex, near)
      return crossing ? [{ crossing, key: edgeKey(hex, near) }] : []
    })
    const order = phase.orders[id]
    const ferry = state.ferries.find((marker) => marker.pontoonId === id && marker.side === side && activeCampaignFerryHex(state, marker, board.map) === hex)
    const deploy = !order?.ferry && !ferry && !state.weatherHistory.ice && crossings.length > 0
    const remove = !order?.ferry && ferry !== undefined && !state.groundMovement?.usedFerryIds?.includes(ferry.id)
    const repairIds = order?.repair || start.enemyAdjacent || neighbors.some((near) => position.enemyCombat.has(near)) ? []
      : crossings.flatMap(({ key, crossing }) => {
        const repair = state.volgaBridgeRepairs?.[key]
        return key !== khersonRailFerryHexside && crossing.bridge === 'blown' && crossing.routes.length && (!repair || repair.side === side) ? [key] : []
      })
    return [{ id, hex, deploy, remove, repairIds, repair: order?.repair, ferryId: ferry?.id }]
  })
}

export function applyCampaignPontoonAction(state: Readonly<CampaignTurnState>, side: Side, action: CampaignPontoonAction,
  board?: CampaignGroundMovementBoard): CampaignTurnState {
  const phase = campaignPontoonAtPhase(state, side)
  const option = campaignPontoonOptions(state, side, board)?.find(({ id }) => id === action.pontoonId)
  if (!phase || !option) throw new Error('Campaign pontoon engineering is unavailable for this counter')
  const { id, hex } = option
  const orders = { ...phase.orders }
  const order = { ...orders[id] }
  const repairs = { ...state.volgaBridgeRepairs }
  let ferries = state.ferries
  switch (action.type) {
    case 'deploy-campaign-ferry':
      if (!option.deploy) throw new Error('Cannot deploy a ferry in this Movement Phase')
      ferries = [...ferries, { id: `ferry:${id}`, hex, side, pontoonId: id }]
      order.ferry = 'deploy'
      break
    case 'remove-campaign-ferry':
      if (!option.remove) throw new Error('Cannot remove a ferry that is unavailable or used this Movement Phase')
      ferries = ferries.filter((marker) => marker.id !== option.ferryId)
      order.ferry = 'remove'
      break
    case 'repair-campaign-volga-bridge':
      if (!option.repairIds.includes(action.bridgeId)) throw new Error('Choose an eligible blown Volga bridge')
      order.repair = action.bridgeId
      const repair = repairs[action.bridgeId] ?? { side, phases: 0 }
      repairs[action.bridgeId] = { ...repair, pontoonIds: [...new Set([...(repair.pontoonIds ?? []), id])] }
      break
    case 'cancel-campaign-volga-repair': {
      const bridge = order.repair
      if (!bridge) throw new Error('This pontoon has no repair order')
      delete order.repair
      const repair = repairs[bridge]
      if (repair) {
        const pontoonIds = (repair.pontoonIds ?? []).filter((worker) => worker !== id)
        if (repair.phases === 0 && !pontoonIds.length) delete repairs[bridge]
        else repairs[bridge] = { ...repair, pontoonIds }
      }
      break
    }
  }
  if (order.ferry || order.repair) orders[id] = order
  else delete orders[id]
  return { ...state, ferries, volgaBridgeRepairs: repairs, pontoonPhase: { ...phase, orders } }
}

/** Count each bridge at most once, after the entire Movement Phase, including barrage. */
export function closeCampaignPontoonPhase(state: Readonly<CampaignTurnState>, side: Side, board?: CampaignGroundMovementBoard): CampaignTurnState {
  const phase = campaignPontoonAtPhase(state, side)
  if (!phase) return state
  if (!board) throw new Error('Campaign pontoon phase board is unavailable')
  const position = campaignGroundPosition(state, side, board.map, board.profileOf)
  if (!position) throw new Error('Campaign pontoon phase board is unavailable')
  const settled = reconcileCampaignBridgeRepairs(state, board)
  const repairs = { ...settled.volgaBridgeRepairs }
  const worked = new Set<string>()
  const moved = new Set(state.groundMovement?.moved)
  for (const [id, { repair }] of Object.entries(phase.orders)) {
    const current = position.friendly.get(id)
    const start = phase.starts[id]
    if (!repair || !current || !start || start.hex !== current.hex || moved.has(id) || start.enemyAdjacent ||
      !campaignCombatPontoon(state.counters[id]!, current.profile) || board.map.neighbors(current.hex).some((near) => position.enemyCombat.has(near))) continue
    const near = repair.split('|').find((hex) => hex !== current.hex)
    if (near && board.volgaCrossingAt?.(settled, id, current.hex, near)?.bridge === 'blown') worked.add(repair)
  }
  for (const id of worked) {
    const repair = repairs[id]
    if (repair?.side === side) repairs[id] = { ...repair, phases: bridgeRepairProgress({ condition: 'destroyed' }, {
      completedMovementPhases: repair.phases, combatModePontoonAtEndpointThroughout: true,
      enemyCombatAdjacentToPontoon: false, enemyAttackCapableAtEndpoint: false,
    }) }
  }
  for (const [id, repair] of Object.entries(repairs)) if (repair.side === side) {
    const pontoonIds = (repair.pontoonIds ?? []).filter((worker) => phase.orders[worker]?.repair === id &&
      position.friendly.get(worker)?.hex === phase.starts[worker]?.hex)
    if (repair.phases === 0 && !pontoonIds.length) delete repairs[id]
    else repairs[id] = { ...repair, pontoonIds }
  }
  return { ...settled, volgaBridgeRepairs: repairs, pontoonPhase: undefined }
}
