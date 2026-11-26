// TTW §5.0a 控制点绑定：最后穿越某 VP/城市格的战斗单位一方“控制”该格。
// 归属随地面移动结算写入（只在正常命令入口），城市控制＝该城全部格同属一方（Kiev 五格等口径同 §5.0a 括号内列法）。
// 哪些格算控制点、城名到格集由地图库/剧本数据注入，不脑补。

import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignPassage { path: readonly string[]; movers: readonly { id: string; combat: boolean; stepsLeft: number }[] }

/** 地面移动后的控制沉降钩子：有战斗单位随行时，把经过的控制点写到该方名下。 */
export function campaignControlRecorder(sites: ReadonlySet<string>) {
  return (state: Readonly<CampaignTurnState>, side: Side, move: CampaignPassage): CampaignTurnState => {
    if (!move.movers.some((mover) => mover.combat)) return state
    const touched = move.path.filter((hex) => sites.has(hex))
    if (!touched.length) return state
    const hexControl = { ...state.hexControl }
    for (const hex of touched) hexControl[hex] = side
    return { ...state, hexControl }
  }
}

/** 城市归属：该城全部格均归同一方才算控制（缺任一格记录即未控制）。 */
export function campaignCityControl(state: Readonly<CampaignTurnState>, cityHexes: readonly string[]): Side | null {
  if (!cityHexes.length) return null
  const sides = cityHexes.map((hex) => state.hexControl?.[hex])
  const first = sides[0]
  return first !== undefined && sides.every((side) => side === first) ? first : null
}

/** UI 只读投影：各控制点当前归属（未记录为 null）。 */
export function campaignControlOptions(state: Readonly<CampaignTurnState>, sites: readonly string[]) {
  return sites.map((hex) => ({ hex, side: state.hexControl?.[hex] ?? null }))
}
