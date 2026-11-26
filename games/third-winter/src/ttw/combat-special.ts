// TTW 战斗专规事实（第三冬专属规则，原石翻译版页码）。
// 本模块只给出条款判定与常量，不读写对局状态；姿态、地图、编制等事实由调用方注入。
// 通规判定在 packages/series；本模块是专规层，优先级高于通规、低于剧本。
import type { Mobility } from '@ocs-eastern/series/ground-map'

/* ── 1.4c 跨伏尔加级河作战（p.2） ─────────────────────────────── */

export interface VolgaCombatCrossing {
  bridge: 'none' | 'intact' | 'blown' | 'repaired'
  /** 本方可用的渡轮指示物（1.5a） */
  friendlyFerry: boolean
  /** 河流冻结（1.4b 连续 3 个 Freeze 回合） */
  ice: boolean
}

/**
 * TTW 1.4c 攻击资格：完好/修复桥任何单位可攻（减力见 TEC）；
 * 炸桥/渡轮/无桥河岸仅 Leg MA——无桥无渡轮时还须冻结。
 * 与移动侧 ttwVolgaMovementCost 同一口径。
 */
export function volgaAttackEligible(crossing: VolgaCombatCrossing, mobility: Mobility): boolean {
  if (crossing.bridge === 'intact' || crossing.bridge === 'repaired') return true
  return mobility === 'leg' && (crossing.ice || crossing.bridge === 'blown' || crossing.friendlyFerry)
}

/** TTW 1.4c（p.33 规则复述框）：跨渡轮攻击力 ×¼。 */
export function volgaFerryAttackFactor(crossing: VolgaCombatCrossing): number {
  return crossing.friendlyFerry && crossing.bridge !== 'intact' && crossing.bridge !== 'repaired' ? 0.25 : 1
}

/** TTW 1.4c：战后推进每条伏尔加级河岸每阶段 ≤3 RE。 */
export const VOLGA_ADVANCE_RE_LIMIT = 3

/**
 * TTW 1.4c 撤退资格（原文枚举穷尽）：完好/修复桥任何单位可撤；
 * 冻结时仅 Leg 可撤；渡轮与赫尔松铁路渡口不可用于撤退；炸桥不在枚举内，不可撤。
 */
export function volgaRetreatEligible(crossing: Pick<VolgaCombatCrossing, 'bridge' | 'ice'>, mobility: Mobility): boolean {
  if (crossing.bridge === 'intact' || crossing.bridge === 'repaired') return true
  return mobility === 'leg' && crossing.ice
}

/** TTW 1.4c + Q02：赫尔松铁路渡口仅 Leg 可攻；战斗按该处河岸地形河况判定；不可用于撤退。 */
export function khersonAttackEligible(mobility: Mobility): boolean {
  return mobility === 'leg'
}

/* ── 1.6b 列车炮（p.3） ──────────────────────────────────────── */

/** TTW 1.6b：列车炮仅战斗模式可炮击（模式面数据已编码，此处供校验引用）。 */
export function railwayGunCanBarrage(inCombatMode: boolean): boolean {
  return inCombatMode
}

/** TTW 1.6b/2.3b D/2.3c F：列车炮、Army HQ、Army Group HQ 被迫撤退即被摧毁。 */
export function destroyedOnForcedRetreat(kind: { railwayGun?: boolean; armyHq?: boolean; armyGroupHq?: boolean }): boolean {
  return kind.railwayGun === true || kind.armyHq === true || kind.armyGroupHq === true
}

/* ── 1.6c 苏军特别突击单位（p.3） ─────────────────────────────── */

/**
 * TTW 1.6c：1890 火焰坦克营与突击工兵旅的印刷 AR 仅用于进攻含城市（大/小）、
 * 堡垒、刺猬或有河流的格/河岸；其它用途（攻无此类地形格、防御、损耗等）AR−1。
 * 1890 跨河攻击不享加成（原文明示「即跨河攻击 AR−1」）。
 */
export function assaultUnitActionRating(printedAr: number, facts: {
  attacking: boolean
  /** 目标格/河岸含城市、堡垒或刺猬 */
  assaultTerrain: boolean
  /** 目标格/河岸含河流 */
  river: boolean
  /** 本次攻击跨过河岸 */
  crossingRiver: boolean
  /** 1890 火焰坦克营 */
  flameTank1890: boolean
}): number {
  if (facts.flameTank1890 && facts.crossingRiver) return printedAr - 1
  const qualifies = facts.attacking && (facts.assaultTerrain || facts.river)
  return qualifies ? printedAr : printedAr - 1
}

/* ── 1.6d 炮兵师（p.3） ──────────────────────────────────────── */
// 防御力＝当前 RE、炮击力按损失比例缩减、逐 RE 独立开火：
// 分别由 combat-terrain.ts combatStrengthFromFacts(artilleryDivision) 与
// series/tables/barrage.ts barrageVolleyStrength(independentRe) 实现，此处不重复。

/* ── 2.3c Army Group HQ 战斗 DRM（p.7-8） ─────────────────────── */

/** TTW 2.3c G：被毁到重建之间，所有战斗轴心进攻 −1、轴心防御 +1。 */
export function armyGroupDestroyedCombatDrm(axisAttacking: boolean, destroyedPendingRebuild: boolean): number {
  return destroyedPendingRebuild ? (axisAttacking ? -1 : 1) : 0
}

/**
 * TTW 2.3c E：每游戏回合一次可对任一战斗加 +1/−1 DRM；
 * 须至少一个轴心单位在其 throw range 内、掷骰前宣布；只影响战斗骰，不影响奇袭。
 */
export function armyGroupDrmEligible(facts: { usedThisGameTurn: boolean; axisUnitInThrowRange: boolean }): boolean {
  return !facts.usedThisGameTurn && facts.axisUnitInThrowRange
}

/* ── 2.3b E / 2.3c G / 2.3d HQ 免费重建与恢复（p.7-8） ─────────── */

/** TTW 5.0a：每消灭一个轴心 Army HQ 苏军 +1 VP（可重复）。 */
export const ARMY_HQ_DESTROYED_VP = 1
/** TTW 5.0a：每消灭一个 Army Group South HQ 苏军 +2 VP（可重复）。 */
export const ARMY_GROUP_HQ_DESTROYED_VP = 2

/**
 * TTW 2.3d：德 Corps HQ 被消灭掷 1 骰——1–3 下个轴心增援阶段免费在任一
 * Army/Army Group HQ 重建；4–6 进 Dead Pile。
 */
export function corpsHqRecoveryRoll(die: number): 'free-rebuild' | 'dead-pile' {
  if (!Number.isInteger(die) || die < 1 || die > 6) throw new Error('Invalid Corps HQ recovery die')
  return die <= 3 ? 'free-rebuild' : 'dead-pile'
}

/* ── 2.4d 残部（p.8-9，路径裁定 Q06） ─────────────────────────── */

/**
 * TTW 2.4d 生成资格：仅 16-4-3 步兵师在战斗中损失最后一步（非损耗、非 Breakout），
 * 且池中有残部营。
 */
export function remnantGenerationEligible(facts: {
  parentIs1643Infantry: boolean
  lastStepLostInCombat: boolean
  poolHasRemnant: boolean
}): boolean {
  return facts.parentIs1643Infantry && facts.lastStepLostInCombat && facts.poolHasRemnant
}

export interface RemnantPathFacts {
  neighbors: (hex: string) => readonly string[]
  distance: (a: string, b: string) => number
  /** 格号列号（西＝列号更小） */
  column: (hex: string) => number
  /** Q06：Leg 可通行、无敌方战斗单位、非敌方图缘补给源；EZOC 可被友方战斗单位抵消 */
  open: (from: string, to: string) => boolean
  friendlyRe: (hex: string) => number
}

/** TTW 2.4d + Q06：距原格恰好 2 格、以西、经开放 Leg 路径；落点堆叠 ≤10 RE。 */
export function remnantDestinations(from: string, facts: RemnantPathFacts): readonly string[] {
  const destinations = facts.neighbors(from).filter((near) => facts.open(from, near)).flatMap((near) =>
    facts.neighbors(near).filter((hex) => facts.column(hex) < facts.column(from) && facts.distance(from, hex) === 2 &&
      facts.friendlyRe(hex) + 1 <= 10 && facts.open(near, hex)))
  return [...new Set(destinations)].sort()
}

/**
 * TTW 2.4d 重建资格：轴心增援阶段，残部与 Corps 或 Army HQ 同格，花 1 Pax
 * 重建 16-4-3（保留一步）。被移除或被毁的残部立即回池。
 */
export function remnantRebuildEligible(facts: {
  axisReinforcement: boolean
  corpsOrArmyHqStacked: boolean
  paxAvailable: boolean
}): boolean {
  return facts.axisReinforcement && facts.corpsOrArmyHqStacked && facts.paxAvailable
}

/* ── 3.3d B 守势姿态战斗利弊（p.11-12） ───────────────────────── */

/**
 * TTW 3.3d B：须同时满足「在方面军边界内」且「能从指挥半径内的编属 Army HQ
 * 获得 trace」才享利弊；不满足者不受影响。
 */
export function defensivePostureQualifies(facts: { inFrontBoundary: boolean; traceFromAssignedArmyHq: boolean }): boolean {
  return facts.inFrontBoundary && facts.traceFromAssignedArmyHq
}

/** TTW 3.3d B：合格单位防御时 lead unit 印刷 AR +1，进攻时 −2。 */
export function defensivePostureArModifier(attacking: boolean, qualifies: boolean): number {
  return qualifies ? (attacking ? -2 : 1) : 0
}

/**
 * TTW 3.3d B：合格单位免付防御战斗补给；不得进行炮兵弹幕；
 * 轴心进攻此类单位时，苏军用 12–16 栏、无移位对每个进攻堆叠各做一次炮击
 * （无补给成本、不需炮兵在射程，适用 Overrun 与战斗，插在战斗序列第 2 步之后）。
 */
export const DEFENSIVE_BARRAGE_COLUMN_LABEL = '12-16'

/** TTW 3.3d B：守势方面军每回合攻击补给上限 2 SP。 */
export const DEFENSIVE_FRONT_ATTACK_SUPPLY_CAP = 2

/* ── 3.4a–b 炮兵弹幕标记（p.12） ─────────────────────────────── */

/** TTW 3.4b：免费炮击后翻面放到 9 回合之后，到该回合苏军增援阶段变回 Ready。 */
export const BARRAGE_MARKER_RECOVERY_TURNS = 9

export function barrageMarkerRecoveryTurn(usedTurn: number): number {
  return usedTurn + BARRAGE_MARKER_RECOVERY_TURNS
}

/**
 * TTW 3.4a：标记 Ready 且方面军为进攻姿态才可在空海炮击环节花费。
 * 姿态状态属批次 10，这里以注入事实表达。
 */
export function barrageMarkerUsable(facts: { ready: boolean; frontPosture: 'offensive' | 'defensive' }): boolean {
  return facts.ready && facts.frontPosture === 'offensive'
}

/* ── 4.3 第聂伯桥头热情（可选，p.14） ─────────────────────────── */

/** TTW 4.3：每回合最多 6 个步兵类 RE（Move Mode 侧 Leg MA 的步兵/伞兵）。 */
export const BRIDGEHEAD_TURN_RE_LIMIT = 6
/** TTW 4.3：跨河攻击战斗力 ×¼。 */
export const BRIDGEHEAD_ATTACK_FACTOR = 0.25

export function bridgeheadAttackStrength(strength: number): number {
  return strength * BRIDGEHEAD_ATTACK_FACTOR
}

/** TTW 4.3：须启用可选规则、步兵类单位、能从进攻姿态方面军的编属 HQ trace 投出。 */
export function bridgeheadEligible(facts: { enabled: boolean; infantryType: boolean; offensiveFrontTrace: boolean }): boolean {
  return facts.enabled && facts.infantryType && facts.offensiveFrontTrace
}

/* ── 4.4 山地单位（可选，p.14） ──────────────────────────────── */

/** TTW 4.4：山地单位在山地格进攻或防御时 AR +1。 */
export function mountainUnitArModifier(facts: { enabled: boolean; mountainUnit: boolean; mountainHex: boolean }): number {
  return facts.enabled && facts.mountainUnit && facts.mountainHex ? 1 : 0
}