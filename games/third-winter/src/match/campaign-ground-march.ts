import { evaluateGroundStep } from '@ocs-eastern/series/ground-movement'
import type { GroundMoveUnit, GroundStep } from '@ocs-eastern/series/ground-movement'
import type { Side } from '@ocs-eastern/series/state-types'
import { campaignCrossingUsage } from './campaign-crossing-usage.ts'
import { campaignMovementPosition } from './campaign-movement-board.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'
import { campaignDemolishableBridges, reconcileCampaignBridgeRepairs } from './campaign-volga-bridges.ts'
import type { CampaignVolgaBridge } from './campaign-volga-bridges.ts'

export interface CampaignMarchMover {
  id: string
  combat: boolean
  unit: GroundMoveUnit
  progress: GroundStep
  stepsLeft: number
  ownBridgeDeparture?: string
}

export interface CampaignGroundMarch {
  movers: readonly CampaignMarchMover[]
  path: readonly string[]
  started: boolean
}

export type CampaignMarchInterruption = { kind: 'volga-bridge-demolition'; hex: string; bridges: readonly CampaignVolgaBridge[]; march: CampaignGroundMarch }
  | { kind: 'resume-march'; hex: string; refusal: { reason: string; hex?: string }; march: CampaignGroundMarch }

export function campaignGroundMovementActor(pending: CampaignMarchInterruption): Side {
  return pending.kind === 'volga-bridge-demolition' ? 'axis' : 'soviet'
}

const refused = (reason: string, hex?: string) => ({ ok: false as const, reason, ...(hex === undefined ? {} : { hex }) })

export function normalizeCampaignMarchPath(board: CampaignGroundMovementBoard, raw: readonly string[]) {
  const path: string[] = []
  for (const printed of raw) {
    const hex = board.map.resolveHex(printed)
    if (!hex) return undefined
    path.push(hex)
  }
  return path
}

export function setCampaignMarchInterruption(state: Readonly<CampaignTurnState>, interruption?: CampaignMarchInterruption): CampaignTurnState {
  const { moved = [], zocLocks = [] } = state.groundMovement ?? {}
  return { ...state, groundMovement: { ...state.groundMovement, moved, zocLocks, interruption } }
}

/** Execute one march in a private board. An unanswered entry commits only its legal prefix. */
export function planCampaignGroundMarch(state: Readonly<CampaignTurnState>, side: Side, board: CampaignGroundMovementBoard,
  march: CampaignGroundMarch) {
  let current = state
  let movers = march.movers
  const placements = new Map(movers.map(({ id, progress }) => [id, { id, ...progress }]))

  for (let index = 0; ; index++) {
    const finished = movers.filter(({ stepsLeft }) => stepsLeft === 0)
    if (finished.length) {
      const untraced = finished.find(({ id, unit, progress }) => unit.strategic && board.inTrace(current, id, progress.hex) !== true)
      if (untraced) return refused('strategic-end-needs-trace', untraced.progress.hex)
      current = { ...current, groundMovement: { ...current.groundMovement, zocLocks: current.groundMovement?.zocLocks ?? [],
        moved: [...(current.groundMovement?.moved ?? []), ...finished.map(({ id }) => id)] } }
      movers = movers.filter(({ stepsLeft }) => stepsLeft > 0)
    }
    const to = march.path[index]
    if (to === undefined) return { ok: true as const, placements: [...placements.values()], settled: current }

    const position = campaignMovementPosition(current, side, board)
    if (!position) return refused('board-unavailable')
    const usage = campaignCrossingUsage(current, board)
    const usedFerries = new Set(current.groundMovement?.usedFerryIds)
    const counters = { ...current.counters }
    const entered: CampaignMarchMover[] = []
    for (const mover of movers) {
      const { id, unit, progress, stepsLeft } = mover
      const stepBoard = position.stepBoard(id, unit.mobility, current, usage.stepRefusal(id), mover.ownBridgeDeparture)
      const result = evaluateGroundStep(stepBoard, unit, progress, to, !march.started && index === 0)
      if (!result.ok) return refused(result.reason, to)
      const { step } = result
      if (step.stop && stepsLeft > 1) return refused('must-stop', march.path[index + 1])
      const crossingRefusal = usage.reserveStep(id, progress.hex, to)
      if (crossingRefusal) return refused(crossingRefusal, to)
      const ferry = board.ferryUsedForStep?.(current, id, progress.hex, to, unit.mobility)
      if (ferry !== undefined) usedFerries.add(ferry)
      entered.push({ ...mover, progress: step, stepsLeft: stepsLeft - 1 })
      counters[id] = { ...counters[id]!, location: { kind: 'map', hex: to } }
      placements.set(id, { id, ...step })
    }
    current = { ...current, counters, groundMovement: { ...current.groundMovement,
      moved: current.groundMovement?.moved ?? [], zocLocks: current.groundMovement?.zocLocks ?? [], crossedReByHexside: usage.settled(),
      usedFerryIds: [...usedFerries] } }
    current = reconcileCampaignBridgeRepairs(current, board)
    const firstCombat = side === 'soviet' && entered.find(({ combat }) => combat)
    const bridges = firstCombat ? campaignDemolishableBridges(current, board, firstCombat.id, to) : []
    if (bridges.length) {
      const interruption = { kind: 'volga-bridge-demolition' as const, hex: to, bridges,
        march: { movers: entered, path: march.path.slice(index + 1), started: true } }
      return { ok: true as const, placements: [...placements.values()], settled: setCampaignMarchInterruption(current, interruption) }
    }
    movers = entered
  }
}

export function campaignMarchPreview(result: ReturnType<typeof planCampaignGroundMarch>) {
  if (!result.ok) return result
  const pause = result.settled.groundMovement?.interruption
  return { ok: true as const, placements: result.placements, ...(pause ? { pause: { kind: pause.kind, hex: pause.hex } } : {}) }
}
