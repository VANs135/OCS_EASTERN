// 会话装配层顶层工厂：把 HQ/移动/几何/姿态四个工厂组装成各 context 板片段，
// 调用方把这些片段spread进完整 board（另补 stepsOf/cost/resolveHex 等数据相关字段）即得真实对局 context。
// 这是把已接机制从合成测试注入转向真实 catalog＋地图装配的统一入口。

import { campaignDestroyOnRetreat, campaignHqHooks, type CampaignHqCatalog } from './campaign-hq-boards.ts'
import { campaignEngineeringBoards, type CampaignEngineeringSources } from './campaign-engineering-boards.ts'
import { campaignMovementProfiles, type CampaignMovementCatalog } from './campaign-movement-profiles.ts'
import { campaignGeometryHooks, type CampaignGeometrySource } from './campaign-geometry.ts'
import { campaignPostureHooks, type CampaignPostureSource } from './campaign-posture-boards.ts'
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
}

/** 组装各板片段。combat.losses 已含 HQ 分类钩子；destroyOnRetreat 复用同一损失面。 */
export function campaignSessionHooks(sources: CampaignSessionSources) {
  const hq = campaignHqHooks(sources.hqCatalog)
  const movement = campaignMovementProfiles(sources.movementCatalog)
  const geometry = campaignGeometryHooks(sources.geometry)
  const posture = campaignPostureHooks(sources.posture)
  const losses: CampaignLossBoard = { ...sources.lossBoard, hqKindOf: hq.hqKindOf, isKesselHq: hq.isKesselHq }
  const engineering = sources.engineering ? campaignEngineeringBoards(sources.engineering) : undefined
  return {
    combat: {
      losses,
      retreatDestroyed: hq.retreatDestroyed,
      destroyOnRetreat: campaignDestroyOnRetreat(losses),
      postureBenefitAt: posture.postureBenefitAt,
      frontOfHex: posture.frontOfHex,
    },
    groundMovement: { railOnly: hq.railOnly, profileOf: movement.profileOf, moveProfile: movement.moveProfile },
    railTransport: { hqRail: hq.hqRail },
    luftflottePlacement: { siteFacts: geometry.siteFacts, sovietCombatWithin10: geometry.sovietCombatWithin10 },
    rvgkMarker: { detrainable: geometry.detrainable, routeWithin10AxisCombat: geometry.routeWithin10AxisCombat, mapOf: geometry.mapOf },
    rvgkAxisCombatUnit: (state: Readonly<CampaignTurnState>, id: string) =>
      state.counters[id]?.side === 'axis' && sources.geometry.isCombatUnit(state, id),
    ...(engineering ? { hedgehogWork: engineering.hedgehogWork, airfieldWork: engineering.airfieldWork } : {}),
    ...(sources.specialHedgehog ? { specialHedgehog: sources.specialHedgehog } : {}),
  }
}