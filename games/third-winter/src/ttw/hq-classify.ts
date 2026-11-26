// TTW HQ 分类（数据驱动）：把 v2 库显式 hq_kind / 拆分库种别映射到战役 HQ 类别，供各绑定钩子消费。
// 取值来自 data/units_hq.json（轴心 army/pz_army/ags/corps/pz_corps/ss_pz_corps/kessel；
// 苏军 front/tank_army/guard_tank_army/guard_army/shock_army）与空军 HQ 拆分库种别。不脑补未列类别。

export type CampaignHqClass =
  | 'army' | 'army-group' | 'corps' | 'kessel'
  | 'front' | 'tank-army' | 'soviet-army'
  | 'luftflotte' | 'air-army'

const HQ_KIND_CLASS: Readonly<Record<string, CampaignHqClass>> = {
  army: 'army', pz_army: 'army',
  ags: 'army-group',
  corps: 'corps', pz_corps: 'corps', ss_pz_corps: 'corps',
  kessel: 'kessel',
  front: 'front',
  tank_army: 'tank-army', guard_tank_army: 'tank-army',
  guard_army: 'soviet-army', shock_army: 'soviet-army',
}

/** hq_kind＋拆分库种别 → 战役 HQ 类别；未列类别返回 undefined（不脑补）。 */
export function campaignHqClass(hqKind: string | undefined, catalogKind?: string): CampaignHqClass | undefined {
  if (catalogKind === 'luftflotte-hq') return 'luftflotte'
  if (catalogKind === 'air-army-hq') return 'air-army'
  return hqKind ? HQ_KIND_CLASS[hqKind] : undefined
}

/** 战斗损失歼灭 VP/免费重建分类（§2.3b E/c G/d、5.0a）：仅轴心 Army/Army Group/Corps；苏军 HQ 不适用。
 *  调用方须另验算子 side==='axis'。 */
export function axisLossHqKind(cls: CampaignHqClass | undefined): 'army' | 'army-group' | 'corps' | undefined {
  return cls === 'army' || cls === 'army-group' || cls === 'corps' ? cls : undefined
}

/** §2.3b/c：轴心 Army/Army Group HQ 仅铁路、各计 1 RE；Army 起/止格不必可卸载，Army Group 仍需。 */
export function axisHqRail(cls: CampaignHqClass | undefined): { railRe: number; waiveDetrainable: boolean } | undefined {
  if (cls === 'army') return { railRe: 1, waiveDetrainable: true }
  if (cls === 'army-group') return { railRe: 1, waiveDetrainable: false }
  return undefined
}
export function axisHqRailOnly(cls: CampaignHqClass | undefined): boolean {
  return cls === 'army' || cls === 'army-group'
}
/** §2.3b D：轴心 Army/Army Group HQ 被迫撤退即毁（铁路炮另由 combat-special.destroyedOnForcedRetreat 计）。 */
export function axisHqDestroyedOnRetreat(cls: CampaignHqClass | undefined): boolean {
  return cls === 'army' || cls === 'army-group'
}
/** §3.5d B：RVGK 释放独立单位须随坦克集团军 HQ（苏军 tank_army/guard_tank_army）。 */
export function isTankArmyHq(cls: CampaignHqClass | undefined): boolean {
  return cls === 'tank-army'
}