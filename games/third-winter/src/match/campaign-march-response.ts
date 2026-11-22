import type { Side } from '@ocs-eastern/series/state-types'
import { campaignMarchPreview, planCampaignGroundMarch, setCampaignMarchInterruption } from './campaign-ground-march.ts'
import type { CampaignGroundMarch } from './campaign-ground-march.ts'
import { normalizeCampaignPath } from './campaign-ground-position.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'
import { recordCampaignBridgeDecisions } from './campaign-volga-bridges.ts'

export type CampaignMarchResponse = { type: 'resolve-campaign-bridge-demolition'; blow: readonly string[] }
  | { type: 'resume-campaign-ground-march'; path: readonly string[]; haltIds?: readonly string[] }

type ResumeMarch = Extract<CampaignMarchResponse, { type: 'resume-campaign-ground-march' }>

function marchResponseAtCursor(state: Readonly<CampaignTurnState>) {
  if (state.cursor.phase === 'movement' && state.cursor.phasing === 'soviet' && state.movementSegment === 'movement') {
    return state.groundMovement?.interruption
  }
}

function planResume(state: Readonly<CampaignTurnState>, board: CampaignGroundMovementBoard, paused: CampaignGroundMarch, action: ResumeMarch) {
  const path = normalizeCampaignPath(board.map, action.path)
  if (!path) return { ok: false as const, reason: 'outside-play-area' }
  const haltIds = new Set(action.haltIds ?? [])
  const { movers } = paused
  if (haltIds.size !== (action.haltIds?.length ?? 0) || [...haltIds].some((id) => !movers.some((mover) => mover.id === id)) ||
    path.length > 0 && haltIds.size === movers.length) return { ok: false as const, reason: 'choose-paused-counters' }
  const march = { started: true, path, movers: movers.map((mover) => ({ ...mover, stepsLeft: haltIds.has(mover.id) ? 0 : path.length })) }
  return planCampaignGroundMarch(setCampaignMarchInterruption(state), 'soviet', board, march)
}

export function previewCampaignMarchResume(state: Readonly<CampaignTurnState>, side: Side, action: ResumeMarch,
  board?: CampaignGroundMovementBoard) {
  const pending = marchResponseAtCursor(state)
  if (side !== 'soviet' || pending?.kind !== 'resume-march' || !board) return { ok: false as const, reason: 'window-closed' }
  return campaignMarchPreview(planResume(state, board, pending.march, action))
}

export function applyCampaignMarchResponse(state: Readonly<CampaignTurnState>, side: Side, action: CampaignMarchResponse,
  board?: CampaignGroundMovementBoard): CampaignTurnState {
  const pending = marchResponseAtCursor(state)
  if (!pending || !board) {
    throw new Error('Campaign ground movement response is unavailable')
  }
  if (action.type === 'resolve-campaign-bridge-demolition') {
    if (side !== 'axis' || pending.kind !== 'volga-bridge-demolition') throw new Error('Only Axis may answer the offered Volga bridges')
    const decided = recordCampaignBridgeDecisions(setCampaignMarchInterruption(state), pending.bridges, action.blow)
    const resumed = planCampaignGroundMarch(decided, 'soviet', board, pending.march)
    if (resumed.ok) return resumed.settled
    const { reason, hex } = resumed
    return setCampaignMarchInterruption(decided, { kind: 'resume-march', hex: pending.hex, refusal: { reason, hex }, march: pending.march })
  }

  if (side !== 'soviet' || pending.kind !== 'resume-march') throw new Error('Only Soviet may resume this paused march')
  const resumed = planResume(state, board, pending.march, action)
  if (!resumed.ok) throw new Error(`Campaign ground movement: ${resumed.reason}`)
  return resumed.settled
}
