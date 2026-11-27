// TTW §5.0a 控制点绑定：最后穿越某 VP/城市格的战斗单位一方“控制”该格。
// 归属随地面移动结算写入（只在正常命令入口），城市控制＝该城全部格同属一方（Kiev 五格等口径同 §5.0a 括号内列法）。
// 哪些格算控制点、城名到格集由地图库/剧本数据注入，不脑补。

import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignPassage { path: readonly string[]; movers: readonly { id: string; combat: boolean; stepsLeft: number }[];
  placements?: readonly { id: string; hex: string }[]; reached?: Readonly<Record<string, number>> }

/** 地面移动后的控制沉降钩子：只有战斗单位实际走过的那一段路径才写归属（按各自实际步数裁剪）。 */
export function campaignControlRecorder(sites: ReadonlySet<string>) {
  return (state: Readonly<CampaignTurnState>, side: Side, move: CampaignPassage): CampaignTurnState => {
    const touched = new Set<string>()
    for (const mover of move.movers) {
      if (!mover.combat) continue
      // 实际步数是裁剪依据：提前停步、MP 耗尽或渡桥中断的单位只记到它真正走过的格。
      let stepped = move.reached?.[mover.id]
      if (stepped === undefined) {
        const placed = move.placements?.find(({ id }) => id === mover.id)
        const counter = state.counters[mover.id]
        const end = placed?.hex ?? (counter?.location.kind === 'map' ? counter.location.hex : undefined)
        if (end !== undefined) {
          const last = move.path.lastIndexOf(end)
          stepped = last < 0 ? 0 : last + 1
        }
      }
      for (const hex of move.path.slice(0, stepped ?? 0)) if (sites.has(hex)) touched.add(hex)
    }
    if (!touched.size) return state
    const hexControl = { ...state.hexControl }
    const controlEvents = [...(state.controlEvents ?? [])]
    for (const hex of touched) {
      if (hexControl[hex] === side) continue
      hexControl[hex] = side
      controlEvents.push({ hex, side, turn: state.turn })
    }
    return { ...state, hexControl, ...(controlEvents.length ? { controlEvents } : {}) }
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
