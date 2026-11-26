// TTW §5.0 战役胜利条件（专规）。VP 城市格集/计时检查点为剧本数据；本模块表达胜负判定、突然死亡与 VP 来源口径。
// 控制判定：最后移动战斗单位穿过 VP 格的一方控制该格（绑定层据进格记录结算）。

export type CampaignVictor = 'soviet' | 'axis' | 'draw'
/** §5.0：苏军 VP≥12 胜，轴心 VP≤6 胜，其余平局。 */
export function campaignVictoryOutcome(vp: number): CampaignVictor {
  if (vp >= 12) return 'soviet'
  if (vp <= 6) return 'axis'
  return 'draw'
}
/** §5.0b 突然死亡：VP≤-2 轴心提前胜，VP≥16 苏军提前胜。 */
export function campaignSuddenDeath(vp: number): 'soviet' | 'axis' | null {
  if (vp <= -2) return 'axis'
  if (vp >= 16) return 'soviet'
  return null
}

/** §5.0a：游戏结束控制城市 VP（各 +2，格集为剧本数据）。 */
export const VICTORY_CITY_VP = 2
export const VICTORY_CITIES = ['kiev', 'odessa', 'uman', 'vinnitsa', 'tarnopol'] as const
/** §5.0a：可重复计分的 VP 来源。 */
export const VP_PER_AXIS_ARMY_HQ_ELIMINATED = 1
export const VP_ARMY_GROUP_SOUTH_DESTROYED = 2
export const VP_RUMANIA_SURRENDER = 2
export const VP_OPTIONAL_58_PZ_DEPLOYED = 2
/** §5.0a：地图边缘突破（坦克/机步军 ≥4 RE 在边缘，苏军整理阶段检查，各 +2）。 */
export const VP_MAP_EDGE_BREAKTHROUGH = 2
export const MAP_EDGE_BREAKTHROUGH_MIN_RE = 4
/** §5.0a：计时扣分（各 -1，特定回合苏军整理阶段检查）。 */
export const VP_TIMED_PENALTY = -1

/** §5.0a：地图边缘突破资格——坦克/机步军且边缘上 ≥4 RE（可分散堆叠，无需 trace）。 */
export function mapEdgeBreakthroughQualifies(facts: { tankOrMechCorps: boolean; reOnEdge: number; sovietCleanupPhase: boolean }): boolean {
  return facts.tankOrMechCorps && facts.reOnEdge >= MAP_EDGE_BREAKTHROUGH_MIN_RE && facts.sovietCleanupPhase
}