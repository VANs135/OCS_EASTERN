// OCS 9.10–9.13、12.4 战斗结算中立判定。
// 来源：第三冬瓶中蝎已验收实现（scorpion-combat-losses / scorpion-combat-result /
// scorpion-retreat / scorpion-combat-supply）与斯摩棱斯克 5603e52 battle.ts、
// combat-option-split.ts；已对照通规 v4.3 §9.10–9.13、§12.4 原文逐条核实。
// 表值、单位档案与地图事实一律由游戏侧注入；本模块不读取任何作品数据。

/**
 * §9.11c 军力损失分配：AR 领导单位必须承受第一点损失；损失超过单位数时，
 * 所有存活单位各承受一点后才能有单位承受第二点（逐轮均摊）。
 * 剩余步数由调用方给出；order 是玩家指定的逐点承受序列，长度必须恰为 required。
 * §9.11b 超出承受能力的强制损失由调用方先以 combatResultObligations 截断。
 * 注意：本分配规则不适用于轰炸或撤退中产生的损失（那些损失自由选择，见 §9.11c 末段）。
 */
export function combatLossAllocation(remaining: ReadonlyMap<string, number>, leader: string,
  order: readonly string[], required: number): ReadonlyMap<string, number> {
  if (order.length !== required || (required > 0 && order[0] !== leader)) {
    throw new Error('Assign all combat losses, starting with the Action Rating unit')
  }
  const assigned = new Map<string, number>()
  for (const id of order) {
    const received = assigned.get(id) ?? 0
    const least = Math.min(...[...remaining].filter(([key, max]) => (assigned.get(key) ?? 0) < max)
      .map(([key]) => assigned.get(key) ?? 0))
    if ((remaining.get(id) ?? 0) <= received || received > least) {
      throw new Error('Each involved unit takes one loss before a surviving unit takes another')
    }
    assigned.set(id, received + 1)
  }
  return assigned
}

export interface CombatResultObligations {
  /** §9.11b 强制损失，超出该方剩余步数的部分忽略 */
  mandatoryLosses: number
  /** 可选损失总额（守方合法忽略选项时为 0） */
  availableOptions: number
  optionLosses: number
  totalLosses: number
  /** 未以损失满足的选项数 */
  unmetOptions: number
  /** §9.12 完整撤退距离＝剩余选项；全员被消灭时无须撤退 */
  retreatDistance: number
}

/**
 * §9.10/§9.11b 结果义务：强制损失先截断到剩余步数，选项损失不得超过
 * min(选项总额, 剩余步数−强制损失)；未满足的选项转为撤退格数。
 * 「该方能否忽略选项」（§9.10c 守方专属）由调用方先行裁定。
 */
export function combatResultObligations(result: { loss: number; option: number }, available: number,
  choice: { ignoreOption?: boolean; optionLosses: number }): CombatResultObligations {
  const mandatory = Math.min(available, result.loss)
  const options = choice.ignoreOption === true ? 0 : result.option
  if (!Number.isSafeInteger(choice.optionLosses) || choice.optionLosses < 0 ||
    choice.optionLosses > Math.min(options, available - mandatory)) {
    throw new Error('Invalid combat option loss allocation')
  }
  const losses = mandatory + choice.optionLosses
  const unmet = options - choice.optionLosses
  return {
    mandatoryLosses: mandatory, availableOptions: options, optionLosses: choice.optionLosses,
    totalLosses: losses, unmetOptions: unmet, retreatDistance: available > losses ? unmet : 0,
  }
}

/**
 * §9.10d/§9.13b 进击标记资格：返回获得标记的攻方单位 id。
 * 条件：CRT 给出 e#；非突袭；战斗阶段的攻击；攻方全部选项选为损失（未撤退）；
 * 攻击格至多两个且彼此相邻；逐单位 AR≥阈值且非 DG（§9.13b-A 只排除 DG 单位本身）。
 * 相邻判定与 AR 取值（含模式修正）由调用方注入。
 */
export function exploitMarkerEligibility(input: {
  threshold: number | null
  overrun: boolean
  combatPhase: boolean
  unmetOptions: number
  origins: readonly string[]
  adjacent: (a: string, b: string) => boolean
  attackers: readonly { id: string; rating: number; disorganized: boolean }[]
}): readonly string[] {
  if (input.threshold === null || input.overrun || !input.combatPhase || input.unmetOptions !== 0) return []
  if (!input.origins.length || input.origins.length > 2 ||
    (input.origins.length === 2 && !input.adjacent(input.origins[0]!, input.origins[1]!))) return []
  return input.attackers.filter((unit) => !unit.disorganized && unit.rating >= input.threshold!).map((unit) => unit.id)
}

/** §12.4 防御战斗补给：整堆 ≤1 RE 付 1T，否则 2T；每堆只付一次。 */
export function defensiveCombatSupplyCost(totalRe: number): number {
  return totalRe <= 1 ? 1 : 2
}

/** 该方某一枚单位在「退 distance 格」时的落点性质 */
export type OptionLanding = 'safe' | 'doomed' | 'none'

/** 「退 distance 格」的整侧预演 */
export interface OptionLadderStep {
  distance: number
  units: readonly { unitId: string; landing: OptionLanding }[]
  /** 每枚单位都存在不会被消灭的落点（含受敌方 ZOC 影响但不会被消灭） */
  allSafe: boolean
  /** 每枚单位都存在落点（可能全部必被消灭 ⇒ §9.12 的兜底消灭） */
  allHaveLanding: boolean
}

export type OptionRetreatLadder = readonly OptionLadderStep[]

/** 选项切分：撤退格数 + 损失点数（两者之和恒等于选项总数，§9.10a） */
export interface OptionSplit {
  retreatHexes: number
  lossPoints: number
}

/**
 * §9.10a 候选切分（按偏好排序，已去重）。只排候选顺序，不判路径合法性。
 * capacity＝该结算方当前可用军力总量（§9.11：任何单位承受的损失不得超过其可用军力总量）。
 * 顺序：全员有安全落点时 k 从大到小 → 全吃损失 → 必死撤退兜底。
 * 来源：斯摩棱斯克 5603e52 combat-option-split.ts（通规 §9.10a/§9.12）。
 */
export function planOptionSplits(input: {
  options: number
  capacity: number
  ladder: OptionRetreatLadder
}): OptionSplit[] {
  const { options, capacity, ladder } = input
  if (options <= 0) return [{ retreatHexes: 0, lossPoints: 0 }]
  const out: OptionSplit[] = []
  const push = (retreatHexes: number, lossPoints: number): void => {
    if (retreatHexes + lossPoints !== options) return
    if (retreatHexes < 0 || lossPoints < 0) return
    if (lossPoints > capacity) return
    if (out.some((item) => item.retreatHexes === retreatHexes)) return
    out.push({ retreatHexes, lossPoints })
  }
  // ① 全员安全：k 从大到小
  for (const step of [...ladder].reverse()) {
    if (step.distance <= 0 || !step.allSafe) continue
    push(step.distance, options - step.distance)
  }
  // ② 全部吃成损失（比「必死撤退」优先：白送单位不如吃军力）
  push(0, options)
  // ③ 至少有落点但都可能必被消灭：只在损失吃不动时才用
  for (const step of [...ladder].reverse()) {
    if (step.distance <= 0 || !step.allHaveLanding) continue
    push(step.distance, options - step.distance)
  }
  return out
}

/** 首选切分；一条候选都没有时退回「全吃损失」，由引擎在确认处给出真实拒绝原因 */
export function chooseOptionSplit(input: {
  options: number
  capacity: number
  ladder: OptionRetreatLadder
}): OptionSplit {
  const splits = planOptionSplits(input)
  return splits[0] ?? { retreatHexes: 0, lossPoints: Math.max(0, input.options) }
}

/**
 * §9.12a/§9.12e 撤退逐格效果（进入一格时结算，单位事实为进入前状态）：
 * - 进入敌方未抵消 ZOC 格（撤退不可被抵消，§9.12e）：该格切 DG，且堆中
 *   进入前已是 DG 的战斗单位必须承受一点损失（owner 从 DG 单位中选）。
 * - 撤退 2 格或更多时，进入第二个格（secondRetreatHex）的瞬间承受 DG（§9.12a）。
 * 纯卡车堆（无战斗单位）不触发上述效果。ZOC 覆盖与「恰好同格友军一并 DG」
 * 由调用方以地图事实结算。
 */
export function retreatStepEffects(input: {
  enteredRawEnemyZoc: boolean
  secondRetreatHex: boolean
  units: readonly { id: string; combat: boolean; disorganized: boolean }[]
}): { disorganizeHex: boolean; zocLossCandidates: readonly string[] } {
  const combatPresent = input.units.some((unit) => unit.combat)
  const enteredZoc = input.enteredRawEnemyZoc && combatPresent
  return {
    disorganizeHex: enteredZoc || (input.secondRetreatHex && combatPresent),
    zocLossCandidates: enteredZoc ? input.units.filter((unit) => unit.combat && unit.disorganized).map((unit) => unit.id) : [],
  }
}