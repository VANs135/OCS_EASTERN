// TTW §3.3c–e（批次 10 姿态规则层，纯函数）：Front HQ 姿态为 Offensive / Regrouping 二分。
// 注意：方案中所称"守势"收益（防御 AR+1、免防御补给、守势炮击、进攻 AR-2、攻击补给 2SP 上限）
// 实属 Regrouping 姿态下"在方面军边界内且能从指挥半径内已编属 Army HQ 获得 trace 补给"的单位（§3.3d B），
// 并非独立第三姿态；不满足该条件的单位不享受收益/惩罚（§3.3d B 末）。
// 本模块只表达姿态状态机与战斗修正规格；边界/trace 判定由绑定层以谓词注入。

export const ttwFrontPostures = ['offensive', 'regrouping'] as const
export type TtwFrontPosture = (typeof ttwFrontPostures)[number]

/** 某 Front HQ 的当前姿态与进入该姿态的回合（§3.3e 计时）。 */
export interface TtwFrontPostureState {
  mode: TtwFrontPosture
  sinceTurn: number
}

export const TTW_MAX_OFFENSIVE_FRONTS = 2
export const TTW_OFFENSIVE_MIN_TURNS = 3
export const TTW_OFFENSIVE_MAX_TURNS = 9
export const TTW_REGROUPING_MIN_TURNS = 3

export function turnsInPosture(state: TtwFrontPostureState, turn: number): number {
  return turn - state.sinceTurn
}

/** §3.3c：进攻姿态只能在苏军增援阶段开始指定；须已 regrouping 满 3 回合（§3.3e）。 */
export function canDesignateOffensive(state: TtwFrontPostureState | undefined, turn: number): boolean {
  if (!state) return true // 初始未置姿态者可指定（剧本初设另行给出）
  return state.mode === 'regrouping' && turnsInPosture(state, turn) >= TTW_REGROUPING_MIN_TURNS
}

/** §3.3d：regrouping 在增援阶段末变更；进攻须满 3 回合（§3.3e）。 */
export function canDesignateRegrouping(state: TtwFrontPostureState | undefined, turn: number): boolean {
  if (!state) return true
  return state.mode === 'offensive' && turnsInPosture(state, turn) >= TTW_OFFENSIVE_MIN_TURNS
}

/** §3.3e：进攻满 9 回合必须转 regrouping。 */
export function mustLeaveOffensive(state: TtwFrontPostureState, turn: number): boolean {
  return state.mode === 'offensive' && turnsInPosture(state, turn) >= TTW_OFFENSIVE_MAX_TURNS
}

/** §3.3c：任意时刻最多 2 个进攻姿态；指定第 3 个非法。 */
export function offensiveCount(fronts: Readonly<Record<string, TtwFrontPostureState>>): number {
  return Object.values(fronts).filter((f) => f.mode === 'offensive').length
}
export function canAddOffensive(
  fronts: Readonly<Record<string, TtwFrontPostureState>>, front: string, turn: number,
): boolean {
  const current = fronts[front]
  if (current?.mode === 'offensive') return false
  if (!canDesignateOffensive(current, turn)) return false
  return offensiveCount(fronts) < TTW_MAX_OFFENSIVE_FRONTS
}

/** §3.3d B / §3.3c：姿态对满足边界+trace 条件单位的战斗修正规格。 */
export interface TtwPostureCombatModifiers {
  defenderAr: number
  attackerAr: number
  freeDefensiveSupply: boolean
  mayOwnArtilleryBarrage: boolean
  /** 轴心攻击此类单位时，战斗步 2 后对每个攻击堆免费守势炮击（12-16 列、无修正）。 */
  defensiveBarrage: boolean
  /** 每方面军每回合攻击补给上限（SP）；null 表示无上限。 */
  attackSupplyCap: number | null
  mayUseBarrageMarker: boolean
}
export function ttwPostureCombatModifiers(benefit: boolean): TtwPostureCombatModifiers {
  if (!benefit) {
    return { defenderAr: 0, attackerAr: 0, freeDefensiveSupply: false, mayOwnArtilleryBarrage: true, defensiveBarrage: false, attackSupplyCap: null, mayUseBarrageMarker: true }
  }
  return { defenderAr: 1, attackerAr: -2, freeDefensiveSupply: true, mayOwnArtilleryBarrage: false, defensiveBarrage: true, attackSupplyCap: 2, mayUseBarrageMarker: false }
}

/** §3.3d B：守势炮击固定 12-16 列、无列修正、无补给成本、不要求炮兵在射程内；适用于 overrun 与常规战斗。 */
export const TTW_DEFENSIVE_BARRAGE_COLUMN = '12-16'
export const TTW_DEFENSIVE_BARRAGE_SHIFTS = 0
export const TTW_DEFENSIVE_BARRAGE_SUPPLY_COST = 0

/** §3.4a / §3.3c B / §3.3d C：弹幕标记仅进攻姿态可用。 */
export function mayUseBarrageMarker(state: TtwFrontPostureState | undefined): boolean {
  return state?.mode === 'offensive'
}