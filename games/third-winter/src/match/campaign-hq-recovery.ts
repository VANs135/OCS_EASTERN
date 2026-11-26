import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignHqRecovery } from './campaign-combat-losses.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

/**
 * TTW 2.3b E/c G/d 被毁 HQ 的免费重建落点事实，由绑定层注入：
 * army＝任意集团军 HQ 所在格；army-group＝任意友方大/小城市格；
 * corps＝任意集团军 HQ 或集团军群 HQ 所在格。本模块不读作品数据。
 */
export interface CampaignHqRecoveryBoard {
  resolveHex(hex: string): string | undefined
  destinations(state: Readonly<CampaignTurnState>, recovery: CampaignHqRecovery): readonly string[]
  printedStepsOf(state: Readonly<CampaignTurnState>, id: string): number
}

export type PlaceCampaignHqRecovery = { type: 'place-campaign-hq-recovery'; recoveryId: string; hex: string }

/**
 * 轴心增援重建窗口消费一条 free-rebuild 恢复记录：死堆算子满步战斗面落位，记录移出。
 * Corps 4–6（dead-pile）不在此免费重建。校验失败不改局面。
 */
export function placeCampaignHqRecovery(state: Readonly<CampaignTurnState>, actor: Side,
  action: PlaceCampaignHqRecovery, board: CampaignHqRecoveryBoard | undefined): CampaignTurnState {
  if (!board) throw new Error('Campaign HQ recovery rules are not configured')
  const { cursor, reinforcement } = state
  if (cursor.phase !== 'reinforcement' || cursor.phasing !== 'axis' || actor !== 'axis' ||
    reinforcement?.stage !== 'ordinary' || reinforcement.window.segment !== 'rebuild-consolidate') {
    throw new Error('HQ free rebuild is only open in the Axis rebuild and consolidation window')
  }
  const recovery = (state.hqRecoveries ?? []).find((entry) => entry.id === action.recoveryId && entry.result === 'free-rebuild')
  if (!recovery) throw new Error('No free HQ rebuild is pending for this counter')
  if (state.turn < recovery.availableTurn) throw new Error('HQ free rebuild is not due until the next Axis reinforcement phase')
  const counter = Object.hasOwn(state.counters, recovery.id) ? state.counters[recovery.id] : undefined
  if (!counter || counter.side !== 'axis' || counter.location.kind !== 'dead-pile') {
    throw new Error('HQ free rebuild requires the destroyed Axis counter in the dead pile')
  }
  const hex = board.resolveHex(action.hex)
  if (!hex || !board.destinations(state, recovery).some((site) => board.resolveHex(site) === hex)) {
    throw new Error('HQ free rebuild: illegal-destination')
  }
  const printedSteps = board.printedStepsOf(state, recovery.id)
  if (!Number.isSafeInteger(printedSteps) || printedSteps < 1) throw new Error('HQ free rebuild: printed-steps-unavailable')
  const updated = { ...counter, location: { kind: 'map' as const, hex }, currentRe: printedSteps, stepsLost: 0,
    mode: 'combat' as const, disorganized: false, internalStocks: undefined }
  return { ...state, counters: { ...state.counters, [recovery.id]: updated },
    hqRecoveries: (state.hqRecoveries ?? []).filter((entry) => entry !== recovery) }
}