// TTW §1.7b、通规 OCS 16.0：特殊替换 "HH" —— 在任意处于 trace supply 的格放一枚 Level-1 工事；
// 不得提高已有工事的等级（任何 ≥1 级工事格都不合法）。消耗该结果并把放置记入窗口。
// trace 判定属补给盘面，由注入的 board 提供（campaignTraceSupply → hasTrace）。

import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignReinforcementWindow } from './campaign-reinforcement-state.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignSpecialHedgehogBoard {
  map: CampaignGroundMap
  /** 该格是否在该侧的 trace supply 之内（由追溯盘面注入）。 */
  traceAt(state: Readonly<CampaignTurnState>, side: Side, hex: string): boolean
}

export type PlaceCampaignSpecialHedgehog = { type: 'place-campaign-special-hedgehog'; index: number; hex: string }

export interface CampaignSpecialHedgehogResult { index: number; hex: string }

function rebuildWindow(state: Readonly<CampaignTurnState>): CampaignReinforcementWindow | undefined {
  const { cursor, reinforcement } = state
  if (cursor.phase !== 'reinforcement' || reinforcement?.stage !== 'ordinary') return undefined
  return reinforcement.window.segment === 'rebuild-consolidate' ? reinforcement.window : undefined
}

/** UI 只读投影：本窗口已掷出的特殊替换结果与其中可由 "HH" 结清的项。 */
export function campaignSpecialHedgehogOptions(state: Readonly<CampaignTurnState>, side: Side) {
  const { cursor, reinforcement } = state
  if (cursor.phase !== 'reinforcement' || cursor.phasing !== side || reinforcement?.stage !== 'ordinary') return null
  return { results: (reinforcement.window.specialReplacements ?? []).map((category, index) => ({ index, category })),
    last: reinforcement.window.lastSpecialHedgehog ?? null }
}

/** TTW §1.7b：把一条 "HH" 特殊替换结果落成一枚 Level-1 工事（单一状态写入入口）。 */
export function placeCampaignSpecialHedgehog(state: Readonly<CampaignTurnState>, actor: Side,
  action: PlaceCampaignSpecialHedgehog, board: CampaignSpecialHedgehogBoard): CampaignTurnState {
  const window = rebuildWindow(state)
  const cursor = state.cursor
  if (!window || !('phasing' in cursor) || cursor.phasing !== actor) {
    throw new Error('Special replacement hedgehogs are placed in your rebuild window')
  }
  const results = window.specialReplacements ?? []
  if (!Number.isSafeInteger(action.index) || action.index < 0 || action.index >= results.length) {
    throw new Error('Campaign special replacement: invalid-result-index')
  }
  if (results[action.index] !== 'hedgehog') throw new Error('Campaign special replacement: result-is-not-HH')
  const hex = board.map.resolveHex(action.hex)
  if (!hex) throw new Error('Campaign special replacement: choose-an-on-map-hex')
  const existing = state.hedgehogs && Object.hasOwn(state.hedgehogs, hex) ? state.hedgehogs[hex] : null
  if (existing !== null && existing !== undefined) throw new Error('Campaign special replacement: cannot-increase-existing-hedgehog')
  if (!board.traceAt(state, actor, hex)) throw new Error('Campaign special replacement: hex-not-in-trace-supply')

  const lastSpecialHedgehog: CampaignSpecialHedgehogResult = { index: action.index, hex }
  return { ...state,
    hedgehogs: { ...state.hedgehogs, [hex]: { side: actor, level: 1 } },
    reinforcement: { stage: 'ordinary', window: { ...window,
      specialReplacements: results.filter((_, at) => at !== action.index), lastSpecialHedgehog } } }
}
