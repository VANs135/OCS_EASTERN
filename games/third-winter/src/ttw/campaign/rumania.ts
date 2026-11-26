// TTW 随机事件「罗马尼亚投降」与盟国限制（专规）。随机事件骰表为剧本数据；本模块表达投降前提与效果口径。

/** 投降前提：须 1944 年且罗马尼亚尚未投降（1943 或已投降视为「无事件」）。 */
export function rumaniaSurrenderEligible(facts: { year: number; alreadySurrendered: boolean }): boolean {
  return facts.year >= 1944 && !facts.alreadySurrendered
}
/** 效果：罗马尼亚航空单位立即移除；地面单位回合末移除——本回合不得移动/攻击/炮击，但被攻时正常防御。 */
export function rumaniaSurrenderEffects(): {
  removeAirImmediately: boolean
  removeGroundEndOfTurn: boolean
  mayMove: boolean
  mayAttack: boolean
  mayBarrage: boolean
  mayDefend: boolean
  sovietVp: number
} {
  return {
    removeAirImmediately: true,
    removeGroundEndOfTurn: true,
    mayMove: false,
    mayAttack: false,
    mayBarrage: false,
    mayDefend: true,
    sovietVp: 2,
  }
}