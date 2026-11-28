// 会话装配层顶层工厂：把 HQ/移动/几何/姿态四个工厂组装成各 context 板片段，
// 调用方把这些片段spread进完整 board（另补 stepsOf/cost/resolveHex 等数据相关字段）即得真实对局 context。
// 这是把已接机制从合成测试注入转向真实 catalog＋地图装配的统一入口。

import { campaignDestroyOnRetreat, campaignHqHooks, type CampaignHqCatalog } from './campaign-hq-boards.ts'
import { campaignEngineeringBoards, type CampaignEngineeringSources } from './campaign-engineering-boards.ts'
import { campaignMovementProfiles, type CampaignMovementCatalog } from './campaign-movement-profiles.ts'
import { campaignGeometryHooks, type CampaignGeometrySource } from './campaign-geometry.ts'
import { campaignPostureHooks, type CampaignPostureSource } from './campaign-posture-boards.ts'
import { campaignControlRecorder, campaignCityControl } from './campaign-control.ts'
import { resolveCampaignEntryCapture } from './campaign-entry-capture.ts'
import { campaignFortressBoards, type CampaignFortressSource } from './campaign-fortress-board.ts'
import { settleCampaignFortressStatus } from './campaign-fortress.ts'
import type { CampaignLossBoard } from './campaign-combat-losses.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignSessionSources {
  hqCatalog: CampaignHqCatalog
  movementCatalog: CampaignMovementCatalog
  geometry: CampaignGeometrySource
  posture: CampaignPostureSource
  /** 损失数据面（stepsOf/reAfterLoss）；hqKindOf/isKesselHq 由本工厂经 HQ 分类器补入。 */
  lossBoard: Pick<CampaignLossBoard, 'stepsOf' | 'reAfterLoss'> & Partial<Pick<CampaignLossBoard, 'remnant'>>
  /** 工事/机场施工数据面（工程能力/RE/池/付款可达）；缺省不提供这两块 board。 */
  engineering?: CampaignEngineeringSources
  /** TTW §1.7b "HH" 的 trace 判定（缺省不提供 specialHedgehog board）。 */
  specialHedgehog?: import('./campaign-special-hedgehog.ts').CampaignSpecialHedgehogBoard
  /** TTW §5.0a：VP/城市控制点格集（缺省不写控制点归属）。 */
  controlSites?: ReadonlySet<string>
  /** TTW §2.4a 要塞数据面（城市格集/剧本要塞池/罗马尼亚边界）；缺省不提供 fortress board。 */
  fortress?: Omit<CampaignFortressSource, 'map' | 'isCombatUnit'>
}

/** 组装各板片段。combat.losses 已含 HQ 分类钩子；destroyOnRetreat 复用同一损失面。 */
export function campaignSessionHooks(sources: CampaignSessionSources) {
  const hq = campaignHqHooks(sources.hqCatalog)
  const movement = campaignMovementProfiles(sources.movementCatalog)
  const geometry = campaignGeometryHooks(sources.geometry)
  const posture = campaignPostureHooks(sources.posture)
  const losses: CampaignLossBoard = { ...sources.lossBoard, hqKindOf: hq.hqKindOf, isKesselHq: hq.isKesselHq }
  const engineering = sources.engineering ? campaignEngineeringBoards(sources.engineering) : undefined
  const fortress = sources.fortress
    ? campaignFortressBoards({ ...sources.fortress, map: sources.geometry.map, isCombatUnit: sources.geometry.isCombatUnit })
    : undefined
  const control = sources.controlSites ? campaignControlRecorder(sources.controlSites) : undefined
  const afterMove = control || fortress
    ? (state: Readonly<CampaignTurnState>, side: 'axis' | 'soviet', move: Parameters<ReturnType<typeof campaignControlRecorder>>[2]) => {
      const recorded = control ? control(state, side, move) : state
      if (!fortress) return recorded
      // §2.4a：城市每格均苏控时要塞状态终止（控制点在本次移动后已更新）。
      return settleCampaignFortressStatus(recorded, (hex) => {
        const site = fortress.cityOf(recorded, hex)
        return site ? campaignCityControl(recorded, site.hexes) === 'soviet' : false
      })
    }
    : undefined
  return {
    combat: {
      losses,
      retreatDestroyed: hq.retreatDestroyed,
      destroyOnRetreat: campaignDestroyOnRetreat(losses),
      postureBenefitAt: posture.postureBenefitAt,
      frontOfHex: posture.frontOfHex,
      // 9.14b/9.14e 的非交互进格夺取；9.14c/9.14f 仍需各自的交互窗口。
      resolveEntry: (state: Readonly<CampaignTurnState>, side: 'axis' | 'soviet', hex: string, ids: readonly string[],
        afterCombat = false) =>
        resolveCampaignEntryCapture(state, side, hex, ids, { attackCapable: sources.geometry.isCombatUnit }, afterCombat),
      ...(fortress ? { fortressExitRefusal: fortress.exitRefusal } : {}),
    },
    groundMovement: { railOnly: hq.railOnly, profileOf: movement.profileOf, moveProfile: movement.moveProfile,
      ...(fortress ? { exitRefusal: fortress.exitRefusal } : {}),
      ...(afterMove ? { afterMove } : {}) },
    railTransport: { hqRail: hq.hqRail, ...(fortress ? { exitRefusal: fortress.exitRefusal } : {}) },
    ...(fortress ? { fortressBoard: fortress } : {}),
    luftflottePlacement: { siteFacts: geometry.siteFacts, sovietCombatWithin10: geometry.sovietCombatWithin10 },
    rvgkMarker: { detrainable: geometry.detrainable, routeWithin10AxisCombat: geometry.routeWithin10AxisCombat, mapOf: geometry.mapOf },
    rvgkAxisCombatUnit: (state: Readonly<CampaignTurnState>, id: string) =>
      state.counters[id]?.side === 'axis' && sources.geometry.isCombatUnit(state, id),
    ...(engineering ? { hedgehogWork: engineering.hedgehogWork, airfieldWork: engineering.airfieldWork } : {}),
    ...(sources.specialHedgehog ? { specialHedgehog: sources.specialHedgehog } : {}),
  }
}