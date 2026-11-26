import { evaluateGroundStep, reachableGroundHexes } from '@ocs-eastern/series/ground-movement'
import type { GroundMoveUnit, GroundStep } from '@ocs-eastern/series/ground-movement'
import type { Side } from '@ocs-eastern/series/state-types'
import { campaignCrossingUsage } from './campaign-crossing-usage.ts'
import { campaignMovementPosition } from './campaign-movement-board.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import { planCampaignRailConversion } from './campaign-rail-conversion.ts'
import { displaceCampaignSte } from './campaign-special-truck-extender.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'
import { campaignDemolishableBridges, reconcileCampaignBridgeRepairs } from './campaign-volga-bridges.ts'
import type { CampaignVolgaBridge } from './campaign-volga-bridges.ts'

export interface CampaignMarchMover {
  id: string
  combat: boolean
  unit: GroundMoveUnit
  progress: GroundStep
  stepsLeft: number
  stepsDone?: number
  railWork?: readonly (readonly [step: number, connections: readonly string[]])[]
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

export function setCampaignMarchInterruption(state: Readonly<CampaignTurnState>, interruption?: CampaignMarchInterruption): CampaignTurnState {
  const { moved = [], zocLocks = [] } = state.groundMovement ?? {}
  return { ...state, groundMovement: { ...state.groundMovement, moved, zocLocks, interruption } }
}

function canFinishMarch(state: Readonly<CampaignTurnState>, board: CampaignGroundMovementBoard, { id, unit, progress }: CampaignMarchMover) {
  return !unit.strategic || board.inTrace(state, id, progress.hex) === true
}

function prepareMarchStep(state: Readonly<CampaignTurnState>, side: Side, board: CampaignGroundMovementBoard) {
  const position = campaignMovementPosition(state, side, board)
  if (!position) return undefined
  return (movers: readonly CampaignMarchMover[], to: string, first: boolean, next?: string) => {
    const displaceSte = position.enemySte.has(to) && side === 'axis' && movers.some(({ combat }) => combat)
    if (!displaceSte && position.enemySte.has(to)) return refused('entry-unresolved', to)
    const usage = campaignCrossingUsage(state, board)
    const usedFerries = new Set(state.groundMovement?.usedFerryIds)
    const counters = { ...state.counters }
    const entered: CampaignMarchMover[] = []
    for (const mover of movers) {
      const { id, unit, progress, stepsLeft } = mover
      const stepBoard = position.stepBoard(id, unit.mobility, state, usage.stepRefusal(id), mover.ownBridgeDeparture)
      const result = evaluateGroundStep(stepBoard, unit, progress, to, first && progress.spent === 0)
      if (!result.ok) return refused(result.reason, to)
      const { step } = result
      if (step.stop && stepsLeft > 1) return refused('must-stop', next)
      const crossingRefusal = usage.reserveStep(id, progress.hex, to)
      if (crossingRefusal) return refused(crossingRefusal, to)
      const ferry = board.ferryUsedForStep?.(state, id, progress.hex, to, unit.mobility)
      if (ferry !== undefined) usedFerries.add(ferry)
      entered.push({ ...mover, progress: step, stepsLeft: stepsLeft - 1, stepsDone: (mover.stepsDone ?? 0) + 1 })
      counters[id] = { ...counters[id]!, location: { kind: 'map', hex: to } }
    }
    let afterEntry = reconcileCampaignBridgeRepairs({ ...state, counters, groundMovement: { ...state.groundMovement,
      moved: state.groundMovement?.moved ?? [], zocLocks: state.groundMovement?.zocLocks ?? [], crossedReByHexside: usage.settled(),
      usedFerryIds: [...usedFerries] } }, board)
    if (displaceSte) afterEntry = displaceCampaignSte(afterEntry, board.map, to)
    const firstCombat = side === 'soviet' && entered.find(({ combat }) => combat)
    const bridges = firstCombat ? campaignDemolishableBridges(afterEntry, board, firstCombat.id, to) : []
    for (const { id, unit, stepsDone, railWork } of entered) {
      const work = railWork?.find(([step]) => step === stepsDone)
      if (!work) continue
      const conversion = planCampaignRailConversion(afterEntry, side, board, id, to, work[1], position.enemyZoc.has(to), unit.allowance)
      if (!conversion.ok) return conversion
      afterEntry = conversion.settled
    }
    return { ok: true as const, entered, afterEntry, bridges }
  }
}

/** Distinguish private boards whose previous route might affect the next move. */
function campaignTransitKey(hex: string, state: Readonly<CampaignTurnState>, steIds: readonly string[]) {
  const movedSte = steIds.filter((id) => state.counters[id]?.location.kind === 'box')
  return JSON.stringify([hex, Object.entries(state.groundMovement?.crossedReByHexside ?? {}).sort(),
    [...(state.groundMovement?.usedFerryIds ?? [])].sort(), Object.keys(state.volgaBridgeRepairs ?? {}).sort(), movedSte])
}

export function campaignMarchDestinations(state: Readonly<CampaignTurnState>, side: Side, board: CampaignGroundMovementBoard,
  mover: Omit<CampaignMarchMover, 'stepsLeft'>) {
  const steIds = Object.keys(state.counters).filter((id) => state.counters[id]?.specialTruckExtender)
  return reachableGroundHexes<Readonly<CampaignTurnState>>(mover.progress, state, function* (progress, current, first) {
    const enter = prepareMarchStep(current, side, board)
    if (!enter) return
    for (const to of board.map.neighbors(progress.hex)) {
      const entry = enter([{ ...mover, progress, stepsLeft: 1 }], to, first)
      if (!entry.ok) continue
      const { afterEntry, entered: [arrived], bridges } = entry
      const paused = bridges.length > 0
      yield { step: arrived!.progress, context: afterEntry, key: campaignTransitKey(to, afterEntry, steIds),
        paused, canFinish: paused || canFinishMarch(afterEntry, board, arrived!) }
    }
  }).map(({ paused, ...destination }) => paused ? { ...destination, pause: 'volga-bridge-demolition' as const } : destination)
}

/** Execute one march in a private board. An unanswered entry commits only its legal prefix. */
export function planCampaignGroundMarch(state: Readonly<CampaignTurnState>, side: Side, board: CampaignGroundMovementBoard,
  march: CampaignGroundMarch) {
  let current = state
  let movers = march.movers
  const placements = new Map(movers.map(({ id, progress }) => [id, { id, ...progress }]))
  // 各 mover 实际进入的步数（含渡桥中断时的步数），供结算后按真实轨迹记账。
  const reached = new Map(movers.map(({ id }) => [id, 0]))

  for (let index = 0; ; index++) {
    const finished = movers.filter(({ stepsLeft }) => stepsLeft === 0)
    if (finished.length) {
      const untraced = finished.find((mover) => !canFinishMarch(current, board, mover))
      if (untraced) return refused('strategic-end-needs-trace', untraced.progress.hex)
      const approachByCounter = { ...current.groundMovement?.approachByCounter }
      for (const { id, progress, unit } of finished) approachByCounter[id] = { spent: progress.spent, allowance: unit.allowance }
      current = { ...current, groundMovement: { ...current.groundMovement, zocLocks: current.groundMovement?.zocLocks ?? [],
        moved: [...(current.groundMovement?.moved ?? []), ...finished.map(({ id }) => id)], approachByCounter } }
      movers = movers.filter(({ stepsLeft }) => stepsLeft > 0)
    }
    const to = march.path[index]
    if (to === undefined) return { ok: true as const, placements: [...placements.values()], reached: { ...Object.fromEntries(reached) }, settled: current }

    const enter = prepareMarchStep(current, side, board)
    if (!enter) return refused('board-unavailable')
    const result = enter(movers, to, !march.started && index === 0, march.path[index + 1])
    if (!result.ok) return result
    const { afterEntry, entered, bridges } = result
    current = afterEntry
    for (const { id, progress } of entered) { placements.set(id, { id, ...progress }); reached.set(id, index + 1) }
    if (bridges.length) {
      const interruption = { kind: 'volga-bridge-demolition' as const, hex: to, bridges,
        march: { movers: entered, path: march.path.slice(index + 1), started: true } }
      return { ok: true as const, placements: [...placements.values()], reached: { ...Object.fromEntries(reached) },
        settled: setCampaignMarchInterruption(current, interruption) }
    }
    movers = entered
  }
}

export function campaignMarchPreview(result: ReturnType<typeof planCampaignGroundMarch>, before: Readonly<CampaignTurnState>) {
  if (!result.ok) return result
  const pause = result.settled.groundMovement?.interruption
  const changes = Object.entries(result.settled.railGaugeByEdge ?? {}).flatMap(([edge, gauge]) =>
    before.railGaugeByEdge?.[edge] !== gauge ? [{ edge, gauge }] : [])
  return { ok: true as const, placements: result.placements, ...(pause ? { pause: { kind: pause.kind, hex: pause.hex } } : {}),
    ...(changes.length ? { railGaugeChanges: changes } : {}) }
}
