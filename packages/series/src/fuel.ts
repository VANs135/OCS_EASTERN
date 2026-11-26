import type { Phase } from './turn.ts'

// OCS 通规 §12.5 燃料补给（作品/剧本中立）。判定移植自斯摩棱斯克 src/engine/rules/fuel.ts（已逐条对照通规 v4.3）。
// 斯摩棱斯克专规 4.2c「最省供油」与 TTW §4.2 Jansen 细节不内置，改由调用方以注入式可选闸门提供（computeFuelCost 的 optionalOverride）。
// 常量字面化（12.5c：编队法/HQ 法各 1 SP，单单位法每单位 1 T）；覆盖集/来源同源判据照旧。

export const FUEL_FORMATION_SP = 1
export const FUEL_HQ_SP = 1
export const FUEL_SINGLE_UNIT_T = 1

export type FuelMethod = 'formation' | 'hq' | 'singleUnit'
export type FuelDuration = 'untilNextFriendlyCleanUp' | 'currentPhaseOnly'
export type FuelMarker = 'formationMarker' | 'hqFuelMarker' | 'none'

/** 12.5a：战斗单位且轮式/履带机动，消耗 MP 必须先付燃料（即使只移动一格）。 */
export function requiresFuelToSpendMp(unit: { isCombat: boolean; mobility: 'leg' | 'truck' | 'track' }): boolean {
  return unit.isCombat && (unit.mobility === 'truck' || unit.mobility === 'track')
}

export const FUEL_RELEVANT_ACTIONS = ['move', 'overrun', 'attack', 'defend', 'barrage', 'retreat', 'advanceAfterCombat'] as const
export type FuelRelevantAction = (typeof FUEL_RELEVANT_ACTIONS)[number]
/** 12.5b：只有移动与突袭需要燃料；攻击/防御/轰炸/撤退/战后推进无需。 */
export function actionNeedsFuel(action: FuelRelevantAction): boolean {
  return action === 'move' || action === 'overrun'
}
/** 12.5g：部队储备不能用于燃料补给。 */
export function fuelCanUseInternalStocks(): boolean {
  return false
}

export interface FuelCostInput {
  method: FuelMethod
  /** 编队法（12.5c-A）：编队内受油单位是否共用同一 HQ 投递/同一补给站拖取。 */
  commonSource?: boolean
  /** 单单位法（12.5c-C）：需要加油的单位数。 */
  unitsNeedingFuel?: number
  /** 作品专规可选闸门（斯摩棱斯克 4.2c 最省供油 / TTW §4.2 Jansen）；缺省不启用，完全按 12.5c。 */
  optionalOverride?: (input: FuelCostInput) => FuelCostResult | null
}
export type FuelCostResult =
  | { ok: true; sp: number; t: number; duration: FuelDuration; marker: FuelMarker; rule: string }
  | { ok: false; rule: string; reason: string }

/** 12.5c：一次加油的费用与形态；三法互不叠加。可选专规闸门优先。 */
export function computeFuelCost(input: FuelCostInput): FuelCostResult {
  const override = input.optionalOverride?.(input)
  if (override) return override
  if (input.method === 'formation') {
    if (input.commonSource === false) return { ok: false, rule: '12.5c-A', reason: '编队内单位未共用同一来源，这些单位只能改走单单位法' }
    return { ok: true, sp: FUEL_FORMATION_SP, t: 0, duration: 'untilNextFriendlyCleanUp', marker: 'formationMarker', rule: '12.5c-A' }
  }
  if (input.method === 'hq') {
    return { ok: true, sp: FUEL_HQ_SP, t: 0, duration: 'untilNextFriendlyCleanUp', marker: 'hqFuelMarker', rule: '12.5c-B' }
  }
  const units = input.unitsNeedingFuel ?? 0
  if (units <= 0) return { ok: false, rule: '12.5c-C', reason: '单单位法需要至少一个需要燃料的单位' }
  return { ok: true, sp: 0, t: FUEL_SINGLE_UNIT_T * units, duration: 'currentPhaseOnly', marker: 'none', rule: '12.5c-C' }
}

/** 12.5d：编队法/HQ 法到期于己方清理阶段；单单位法只本阶段有效。 */
export function fuelExpiresAt(method: FuelMethod): FuelDuration {
  return method === 'singleUnit' ? 'currentPhaseOnly' : 'untilNextFriendlyCleanUp'
}
/** 12.5c-C：单单位法换阶段即失效；编队法/HQ 法保留到己方清理阶段。 */
export function fuelExpiresOnPhaseChange(method: FuelMethod): boolean {
  return fuelExpiresAt(method) === 'currentPhaseOnly'
}

/** 通规 3.2f：独立单位＝不属于多单位编队且印值军力 ≤1。 */
export function isIndependentUnit(input: { formation?: string | null; printedSteps: number }): boolean {
  if (typeof input.formation === 'string' && input.formation.length > 0) return false
  return input.printedSteps <= 1
}
/** 12.5c-B/12.5e：HQ 法只覆盖 HQ 自己与独立单位。 */
export function hqFuelCovers(input: { targetIsTheHq: boolean; targetIsIndependent: boolean }): boolean {
  return input.targetIsTheHq || input.targetIsIndependent
}
/** 12.5c-A：编队法覆盖同属本次付款编队的单位（来源那一半由调用方按盘面判）。 */
export function formationFuelCovers(input: { unitFormation?: string | null; fuelFormation?: string | null }): boolean {
  const fuel = input.fuelFormation
  if (typeof fuel !== 'string' || fuel.length === 0) return false
  return input.unitFormation === fuel
}

export interface FuelMethodAvailability { method: FuelMethod; available: boolean; reason: string | null }
/** 12.5c：三法各自适用范围（单单位法恒可用；编队法须同一编队；HQ 法须含 HQ 且其余皆独立单位）。 */
export function fuelMethodAvailability(input: {
  targets: readonly { isHq: boolean; formation: string | null; isIndependent: boolean }[]
}): FuelMethodAvailability[] {
  const targets = input.targets
  const hqIndex = targets.findIndex((target) => target.isHq)
  const singleUnit: FuelMethodAvailability = targets.length === 0
    ? { method: 'singleUnit', available: false, reason: '12.5c-C：先选中要加油的单位' }
    : { method: 'singleUnit', available: true, reason: null }
  const formations = new Set(targets.map((target) => target.formation))
  const formationName = targets[0]?.formation ?? null
  const formationAvailable = targets.length > 0 && formations.size === 1 && formationName !== null
  const formation: FuelMethodAvailability = formationAvailable
    ? { method: 'formation', available: true, reason: null }
    : { method: 'formation', available: false, reason: targets.length === 0 ? '12.5c-A：先选中要加油的单位'
      : formationName === null ? '12.5c-A：编队法只对多单位编队成立' : '12.5c-A：选中单位来自多个编队，请分开付' }
  const nonHqIneligible = targets.filter((target, index) => index !== hqIndex && !target.isIndependent)
  const hqAvailable = hqIndex >= 0 && nonHqIneligible.length === 0
  const hq: FuelMethodAvailability = hqAvailable
    ? { method: 'hq', available: true, reason: null }
    : { method: 'hq', available: false, reason: hqIndex < 0 ? '12.5c-B：先点选那台指挥部' : '12.5c-B/3.2f：HQ 法只覆盖独立单位，选中含非独立单位' }
  return [singleUnit, formation, hq]
}

/** 12.5e：HQ 法投递距离须在独立单位移动前一次性确定，每阶段只一个投递位置。 */
export function hqFuelCoverage(throwRangeHexes: readonly number[]): {
  rule: string; countBeforeMovement: true; singleThrowLocationPerPhase: true; throwRangeHexes: readonly number[]
} {
  return { rule: '12.5e', countBeforeMovement: true, singleThrowLocationPerPhase: true, throwRangeHexes }
}
/** 12.5f：增援部署无需燃料，离开入场格移动时需付；抵达回合无免费燃料。 */
export function reinforcementFuelNeeded(options: { stillInEntryHex: boolean }): { needsFuel: boolean; rule: string } {
  return { needsFuel: !options.stillInEntryHex, rule: '12.5f' }
}

/** 通规 §17.0c：追溯补给无视天气增加的移动消耗（天气效果取自本作天气表，绑定层注入）。 */
export function traceSupplyIgnoresWeatherCost(): boolean {
  return true
}