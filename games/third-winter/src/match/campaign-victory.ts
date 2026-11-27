// 战役级胜负的单一状态出口：剧本结束清算时写入，供客户端读取，不再散落各剧本。
// 具体 VP 口径由剧本模块计算；本类型只承载结果，避免把某一剧本的字段塞进通用回合状态。

import type { Side } from '@ocs-eastern/series/state-types'

export interface CampaignScenarioVictory {
  scenarioId: string
  outcome: Side | 'draw'
  level: 'major' | 'minor'
  net: number
  soviet: number
  axis: number
}
