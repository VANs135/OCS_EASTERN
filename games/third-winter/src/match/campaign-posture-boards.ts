// 会话装配层：由方面军边界几何＋收益资格谓词派生姿态钩子（替代合成测试注入）。
// §3.3d B：Regrouping 收益仅给苏军单位，须格在方面军边界内、该方面军处 Regrouping 姿态、
// 且能从指挥半径内已编属 Army HQ 获得 trace 补给（边界/trace 几何由绑定层注入）。

import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignPostureSource {
  /** 格所属方面军（边界几何，剧本数据/Q07 注入）；不在任何边界返回 undefined。 */
  frontOfHex(hex: string): string | undefined
  /** §3.3d B 收益资格：在边界内＋能从指挥半径内已编属 Army HQ 获得 trace 补给（绑定层注入）。 */
  benefitEligible(state: Readonly<CampaignTurnState>, hex: string, front: string): boolean
}

export interface CampaignPostureHooks {
  frontOfHex(hex: string): string | undefined
  postureBenefitAt(state: Readonly<CampaignTurnState>, hex: string, side: Side): boolean
}

/** 由边界几何＋收益资格派生姿态钩子。姿态模式读 state.frontPostures。 */
export function campaignPostureHooks(source: CampaignPostureSource): CampaignPostureHooks {
  return {
    frontOfHex: source.frontOfHex,
    postureBenefitAt: (state, hex, side) => {
      if (side !== 'soviet') return false
      const front = source.frontOfHex(hex)
      if (!front) return false
      if (state.frontPostures?.[front]?.mode !== 'regrouping') return false
      return source.benefitEligible(state, hex, front)
    },
  }
}