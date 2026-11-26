import {
  combatLossAllocation, combatResultObligations, defensiveCombatSupplyCost, exploitMarkerEligibility, retreatStepEffects,
} from '@ocs-eastern/series/combat'
import type { StepCost } from '@ocs-eastern/series/ground-map'
import { spendInternalStocks } from '@ocs-eastern/series/internal-stocks'
import { groundModeEffect } from '@ocs-eastern/series/modes'
import { rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CrtLike } from '@ocs-eastern/series/tables/crt'
import { rollRegularCombat } from '@ocs-eastern/series/tables/ground-combat'
import { actingSide } from '@ocs-eastern/series/turn'
import { zocAffectsAction } from '@ocs-eastern/series/zoc'
import type { Terrain } from '../import/scorpion-map.ts'
import { combatStrengthFromFacts, combatTerrainCategory } from '../ttw/combat-terrain.ts'
import type { AttackTerrain, CombatClass } from '../ttw/combat-terrain.ts'
import { armyGroupDestroyedCombatDrm, khersonAttackEligible, volgaAttackEligible, volgaFerryAttackFactor,
  volgaRetreatEligible, VOLGA_ADVANCE_RE_LIMIT } from '../ttw/combat-special.ts'
import type { VolgaCombatCrossing } from '../ttw/combat-special.ts'
import type { Mobility } from '@ocs-eastern/series/ground-map'
import { applyCampaignCombatLosses } from './campaign-combat-losses.ts'
import type { CampaignLossBoard } from './campaign-combat-losses.ts'
import { campaignCounterGroundMode, campaignGroundPosition } from './campaign-ground-position.ts'
import type { CampaignGroundMap, CampaignGroundProfiles } from './campaign-ground-position.ts'
import { campaignPhysicalSupply, campaignSupplySourceKey, spendCampaignSupply } from './campaign-supply-ledger.ts'
import type { CampaignSupplySource } from './campaign-supply-ledger.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

/** OCS 4.8 地面堆叠上限（RE）。 */
export const CAMPAIGN_STACKING_LIMIT_RE = 10

export interface CampaignCombatProfile {
  strength: number
  combatClass: CombatClass
  antiTank: number
  actionRating: number
  printedRe: number
  /** TTW 1.6d 苏军炮兵师 */
  artilleryDivision: boolean
  attackCapable: boolean
  /** 移动侧机动类型（Leg/Track/…）；跨伏尔加级河攻击/撤退资格用（1.4c）。 */
  mobility?: Mobility
}

/** 1.4c 跨伏尔加级河/赫尔松渡口边事实；bank 为推进计入的河岸标识。 */
export interface CampaignRiverCrossing {
  kind: 'volga' | 'kherson'
  crossing: VolgaCombatCrossing
  bank: string
}

export interface CampaignCombatBoard {
  map: CampaignGroundMap
  table: CrtLike
  profileOf: CampaignGroundProfiles
  combatProfile(state: Readonly<CampaignTurnState>, id: string): CampaignCombatProfile | undefined
  distance(a: string, b: string): number
  losses: CampaignLossBoard
  terrainAt(hex: string): readonly Terrain[] | undefined
  /** 跨河岸进攻时的河流类别；undefined＝该边无河 */
  riverAt?(from: string, to: string): 'minor-river' | 'major-river' | undefined
  /** 1.4c 跨河事实；无此钩子则不启用伏尔加/赫尔松限制。 */
  riverCrossing?(state: Readonly<CampaignTurnState>, from: string, to: string): CampaignRiverCrossing | null
  hedgehogAt(state: Readonly<CampaignTurnState>, hex: string): number
  canUseSupply(state: Readonly<CampaignTurnState>, side: Side, unitId: string, key: string, hqId?: string): boolean
  /** 撤退/推进逐格通行性（含天气）；null＝不可通行 */
  stepCost(state: Readonly<CampaignTurnState>, id: string, from: string, to: string): StepCost
  stackingReAt(state: Readonly<CampaignTurnState>, hex: string): number
  /** 进击阶段攻击资格（释放/进击标记），与移动侧同一事实 */
  exploitEligible(state: Readonly<CampaignTurnState>, id: string): boolean
  /** 突袭（OCS 8.0）：可用 MP、进格取费（≤3）、本阶段已移动判定。 */
  overrunMp?(state: Readonly<CampaignTurnState>, id: string): number
  overrunEntryCost?(state: Readonly<CampaignTurnState>, id: string, from: string, to: string): number | null
  hasMoved?(state: Readonly<CampaignTurnState>, id: string): boolean
  /**
   * TTW 专规 AR 修正（1.6c 突击单位、3.3d B 守势、4.4 山地），由绑定层用
   * ttw/combat-special.ts 判定组合姿态/trace/编制事实后注入；默认 0。
   */
  specialArModifier?(state: Readonly<CampaignTurnState>, id: string,
    context: { attacking: boolean; targetHex: string; crossingRiver: boolean }): number
  /** TTW 2.3c G：Army Group South HQ 被毁待重建 */
  armyGroupDestroyed?(state: Readonly<CampaignTurnState>): boolean
}

export interface CampaignRetreatPlan {
  units: readonly string[]
  path: readonly string[]
  /** 进入某格时承受 ZOC 损失的单位（0 起始步号） */
  zocLosses?: Readonly<Record<number, string>>
}

export interface CampaignCombat {
  target: string
  attacker: Side
  attackers: readonly string[]
  defenders: readonly string[]
  heldAtStart: Readonly<Record<Side, readonly string[]>>
  hedgehog: number
  defenseSupplied?: boolean
  attackerLeader?: string
  defenderLeader?: string
  roll?: ReturnType<typeof rollRegularCombat>
  step: 'defender-supply' | 'attacker-rating' | 'defender-rating' | 'defender-terrain' | 'attacker-result' | 'defender-result' | 'advance'
  defenderMayIgnore?: boolean
  attackerRetreated?: boolean
  overrun?: boolean
}

export type CampaignCombatAction =
  | { type: 'declare-campaign-combat'; target: string; attackers: readonly string[];
      payments: readonly { unitId: string; source: CampaignSupplySource; tokens: number }[]; internalUnitIds?: readonly string[] }
  | { type: 'declare-campaign-overrun'; target: string; attackers: readonly string[];
      payments: readonly { unitId: string; source: CampaignSupplySource; tokens: number }[]; internalUnitIds?: readonly string[] }
  | { type: 'defend-campaign-combat'; payments: readonly { source: CampaignSupplySource; tokens: number }[]; internalUnitIds?: readonly string[] }
  | { type: 'select-campaign-combat-rating'; unitId: string }
  | { type: 'choose-campaign-combat-terrain'; terrain: Terrain; attackingTerrain: Readonly<Record<string, AttackTerrain>> }
  | { type: 'resolve-campaign-combat'; lossOrder: readonly string[]; optionLosses: number; ignoreDefenderOption?: boolean;
      retreats?: readonly CampaignRetreatPlan[] }
  | { type: 'advance-campaign-combat'; unitIds: readonly string[] }

const opposing = (side: Side): Side => side === 'axis' ? 'soviet' : 'axis'

function combatUnits(state: Readonly<CampaignTurnState>, board: CampaignCombatBoard) {
  return Object.entries(state.counters).filter(([id, counter]) =>
    counter.location.kind === 'map' && board.profileOf(state, id)?.combat === true)
}

function hexOf(state: Readonly<CampaignTurnState>, id: string, board: CampaignCombatBoard): string | undefined {
  const counter = state.counters[id]
  return counter?.location.kind === 'map' ? board.map.resolveHex(counter.location.hex) : undefined
}

function modeOf(state: Readonly<CampaignTurnState>, id: string, board: CampaignCombatBoard) {
  const counter = state.counters[id]!
  const profile = board.profileOf(state, id)!
  return groundModeEffect(campaignCounterGroundMode(counter, profile.inCombatMode))
}

/** OCS 9.6：模式修正后的 AR（不含专规修正），用于 DRM 与进击资格。 */
function modeRating(state: Readonly<CampaignTurnState>, id: string, board: CampaignCombatBoard): number {
  const profile = board.combatProfile(state, id)!
  const mode = modeOf(state, id, board)
  return profile.actionRating * mode.actionRatingFactor + mode.actionRatingModifier
}

export function applyCampaignCombat(state: Readonly<CampaignTurnState>, actor: Side, action: CampaignCombatAction,
  board: CampaignCombatBoard | undefined): CampaignTurnState {
  if (!board) throw new Error('Campaign ground combat rules are not configured')
  switch (action.type) {
    case 'declare-campaign-combat': return declareCampaignCombat(state, actor, action, board)
    case 'declare-campaign-overrun': return declareCampaignOverrun(state, actor, action, board)
    case 'defend-campaign-combat': return defendCampaignCombat(state, actor, action, board)
    case 'select-campaign-combat-rating': return selectCampaignCombatRating(state, actor, action, board)
    case 'choose-campaign-combat-terrain': return chooseCampaignCombatTerrain(state, actor, action, board)
    case 'resolve-campaign-combat': return resolveCampaignCombat(state, actor, action, board)
    case 'advance-campaign-combat': return advanceCampaignCombat(state, actor, action, board)
  }
}

function declareCampaignCombat(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignCombatAction, { type: 'declare-campaign-combat' }>, board: CampaignCombatBoard): CampaignTurnState {
  const { cursor } = state
  const target = board.map.resolveHex(action.target)
  const enemy = opposing(actor)
  if (!('phasing' in cursor) || (cursor.phase !== 'combat' && cursor.phase !== 'exploitation') ||
    actingSide(cursor.phasing, cursor.phase) !== actor || state.combat || state.barrage || state.overrunMarch || !target ||
    state.combatTargets?.includes(target) || !action.attackers.length ||
    new Set(action.attackers).size !== action.attackers.length) {
    throw new Error('This regular attack is unavailable')
  }
  const defenders = combatUnits(state, board).filter(([id, counter]) => counter.side === enemy &&
    hexOf(state, id, board) === target).map(([id]) => id)
  if (!defenders.length) throw new Error('Choose a hex containing enemy combat units')
  const hedgehog = board.hedgehogAt(state, target)
  if (!Number.isInteger(hedgehog) || hedgehog < 0 || hedgehog > 4) throw new Error('Invalid hedgehog level')
  for (const id of action.attackers) {
    const counter = Object.hasOwn(state.counters, id) ? state.counters[id] : undefined
    const hex = hexOf(state, id, board)
    const profile = counter && board.combatProfile(state, id)
    const mode = counter && board.profileOf(state, id) && modeOf(state, id, board)
    if (!counter || counter.side !== actor || !hex || !profile?.attackCapable || !mode?.canAttack ||
      state.combatAttackers?.includes(id) || hex === target || board.stepCost(state, id, hex, target) === null ||
      (cursor.phase === 'exploitation' && !board.exploitEligible(state, id))) {
      throw new Error('Each attacker must be eligible, unused and able to enter the target hex')
    }
    if (profile && !crossingAttackEligible(state, board, id, hex, target, profile)) throw new Error('Unit cannot attack across this river crossing')
  }
  const units = payAttackSupply(state, actor, action, board)
  const all = combatUnits(state, board)
  const heldAtStart = {
    axis: all.filter(([, counter]) => counter.side === 'axis').map(([id]) => hexOf(state, id, board)!),
    soviet: all.filter(([, counter]) => counter.side === 'soviet').map(([id]) => hexOf(state, id, board)!),
  }
  return { ...units, combat: { target, attacker: actor, attackers: [...action.attackers], defenders, hedgehog,
    heldAtStart, step: 'defender-supply' }, combatTargets: [...(state.combatTargets ?? []), target],
    combatAttackers: [...(state.combatAttackers ?? []), ...action.attackers] }
}

/** OCS 8.0 突袭：移动段内同格出发、canOverrun、余 MP≥3、进格取费≤3；成功後全员进格。 */
function declareCampaignOverrun(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignCombatAction, { type: 'declare-campaign-overrun' }>, board: CampaignCombatBoard): CampaignTurnState {
  const { cursor } = state
  const target = board.map.resolveHex(action.target)
  const enemy = opposing(actor)
  if (!('phasing' in cursor) || (cursor.phase !== 'movement' && cursor.phase !== 'reaction' && cursor.phase !== 'exploitation') ||
    actingSide(cursor.phasing, cursor.phase) !== actor || state.combat || state.barrage || state.overrunMarch ||
    (state.combatTargets?.length ?? 0) > 0 || !target || !action.attackers.length ||
    new Set(action.attackers).size !== action.attackers.length || state.weather?.ground === 'thaw' ||
    !board.overrunMp || !board.overrunEntryCost) {
    throw new Error('Overrun movement requires the active Movement Segment')
  }
  const origin = hexOf(state, action.attackers[0]!, board)
  const defenders = combatUnits(state, board).filter(([id, counter]) => counter.side === enemy &&
    hexOf(state, id, board) === target).map(([id]) => id)
  if (!defenders.length || !origin || board.distance(origin, target) !== 1) throw new Error('Choose an enterable adjacent overrun target')
  const hedgehog = board.hedgehogAt(state, target)
  if (!Number.isInteger(hedgehog) || hedgehog < 0 || hedgehog > 4) throw new Error('Invalid hedgehog level')
  const remaining: Record<string, number> = {}
  for (const id of action.attackers) {
    const counter = Object.hasOwn(state.counters, id) ? state.counters[id] : undefined
    const hex = hexOf(state, id, board)
    const profile = counter && board.combatProfile(state, id)
    const mode = counter && board.profileOf(state, id) && modeOf(state, id, board)
    const mp = board.overrunMp(state, id)
    const cost = board.overrunEntryCost(state, id, hex ?? '', target)
    if (!counter || counter.side !== actor || hex !== origin || !profile?.attackCapable || !mode?.canOverrun ||
      board.hasMoved?.(state, id) === true || mp === undefined || mp < 3 || cost === null || cost > 3) {
      throw new Error('Choose eligible stacked attackers with at least 3 MP and an entry costing at most 3')
    }
    if (profile && !crossingAttackEligible(state, board, id, hex, target, profile)) throw new Error('Unit cannot attack across this river crossing')
    remaining[id] = mp - 3
  }
  const units = payAttackSupply(state, actor, action, board)
  const all = combatUnits(state, board)
  const heldAtStart = {
    axis: all.filter(([, counter]) => counter.side === 'axis').map(([id]) => hexOf(state, id, board)!),
    soviet: all.filter(([, counter]) => counter.side === 'soviet').map(([id]) => hexOf(state, id, board)!),
  }
  return { ...units, combat: { target, attacker: actor, attackers: [...action.attackers], defenders, hedgehog,
    heldAtStart, step: 'defender-supply', overrun: true }, combatTargets: [...(state.combatTargets ?? []), target],
    combatAttackers: [...(state.combatAttackers ?? []), ...action.attackers],
    overrunMarch: { remaining, enteredHex: false } }
}

/** OCS 12.4：攻方每存活步 1T，或单位内部补给。 */
function payAttackSupply(state: Readonly<CampaignTurnState>, actor: Side,
  action: { attackers: readonly string[]; payments: readonly { unitId: string; source: CampaignSupplySource; tokens: number }[]; internalUnitIds?: readonly string[] },
  board: CampaignCombatBoard): CampaignTurnState {
  const internal = action.internalUnitIds ?? []
  if (new Set(internal).size !== internal.length || internal.some((id) => !action.attackers.includes(id))) {
    throw new Error('Internal stocks belong only to their individual participants')
  }
  const sources = campaignPhysicalSupply(state, actor, board.map)
  const totals = new Map<string, number>()
  const spending = new Map<string, number>()
  for (const { unitId, source, tokens } of action.payments) {
    const key = campaignSupplySourceKey(board.map.resolveHex, source)
    if (!action.attackers.includes(unitId) || internal.includes(unitId) || !Number.isSafeInteger(tokens) || tokens < 1 ||
      !board.canUseSupply(state, actor, unitId, key)) throw new Error('Each attacker requires one token per surviving step')
    totals.set(unitId, (totals.get(unitId) ?? 0) + tokens)
    spending.set(key, (spending.get(key) ?? 0) + tokens)
  }
  const counters = { ...state.counters }
  for (const id of action.attackers) {
    const cost = board.losses.stepsOf(state, id) ?? 0
    if (internal.includes(id)) {
      const available = [...sources].filter(([key]) => board.canUseSupply(state, actor, id, key))
        .reduce((sum, [, entry]) => sum + entry.tokens, 0)
      if (available >= cost) throw new Error('This unit can obtain its required on-map combat supply')
      counters[id] = { ...counters[id]!, internalStocks: spendInternalStocks(counters[id]!.internalStocks) }
    } else if (totals.get(id) !== cost) {
      throw new Error('Each attacker requires one token per surviving step or its own internal stocks')
    }
  }
  return spendCampaignSupply({ ...state, counters }, actor, sources, spending)
}

function defendCampaignCombat(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignCombatAction, { type: 'defend-campaign-combat' }>, board: CampaignCombatBoard): CampaignTurnState {
  const combat = state.combat
  if (!combat || combat.step !== 'defender-supply' || actor === combat.attacker) throw new Error('The defender must respond')
  const internal = action.internalUnitIds ?? []
  if (new Set(internal).size !== internal.length || internal.some((id) => !combat.defenders.includes(id))) {
    throw new Error('Internal stocks belong only to their individual participants')
  }
  const stack = combat.defenders.map((id) => state.counters[id]!)
  const cost = defensiveCombatSupplyCost(stack.reduce((sum, counter) => sum + (counter.currentRe ?? 1), 0))
  const sources = campaignPhysicalSupply(state, actor, board.map)
  if (action.payments.length) {
    if (internal.length) throw new Error('Pay the full defending stack cost in on-map supply')
    const spending = new Map<string, number>()
    const coverage = new Map<string, number>()
    for (const { source, tokens } of action.payments) {
      const key = campaignSupplySourceKey(board.map.resolveHex, source)
      if (!Number.isSafeInteger(tokens) || tokens < 1) throw new Error('Pay the full defending stack cost in on-map supply')
      spending.set(key, (spending.get(key) ?? 0) + tokens)
      for (const id of combat.defenders) if (board.canUseSupply(state, actor, id, key)) coverage.set(id, (coverage.get(id) ?? 0) + tokens)
    }
    if ([...spending.values()].reduce((sum, tokens) => sum + tokens, 0) !== cost ||
      combat.defenders.some((id) => (coverage.get(id) ?? 0) < cost)) {
      throw new Error('Pay the full defending stack cost in on-map supply')
    }
    const paid = spendCampaignSupply(state, actor, sources, spending)
    return { ...paid, combat: { ...combat, defenseSupplied: true, step: 'attacker-rating' } }
  }
  const counters = { ...state.counters }
  for (const id of internal) {
    const available = [...sources].filter(([key]) => board.canUseSupply(state, actor, id, key))
      .reduce((sum, [, entry]) => sum + entry.tokens, 0)
    if (available >= cost) throw new Error('This unit can obtain its required on-map combat supply')
    counters[id] = { ...counters[id]!, internalStocks: spendInternalStocks(counters[id]!.internalStocks) }
  }
  return { ...state, counters, combat: { ...combat, defenseSupplied: false, step: 'attacker-rating' } }
}

function selectCampaignCombatRating(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignCombatAction, { type: 'select-campaign-combat-rating' }>, board: CampaignCombatBoard): CampaignTurnState {
  const combat = state.combat
  if (combat?.step === 'attacker-rating' && combat.attacker === actor && combat.attackers.includes(action.unitId)) {
    return { ...state, combat: { ...combat, attackerLeader: action.unitId, step: 'defender-rating' } }
  }
  if (combat?.step !== 'defender-rating' || actor === combat.attacker || !combat.defenders.includes(action.unitId)) {
    throw new Error('Choose an eligible Action Rating unit in the correct order')
  }
  return { ...state, combat: { ...combat, defenderLeader: action.unitId, step: 'defender-terrain' } }
}

function chooseCampaignCombatTerrain(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignCombatAction, { type: 'choose-campaign-combat-terrain' }>, board: CampaignCombatBoard): CampaignTurnState {
  const combat = state.combat
  if (combat?.step !== 'defender-terrain' || actor === combat.attacker || !combat.attackerLeader || !combat.defenderLeader) {
    throw new Error('The defender chooses terrain after both sides select their Action Rating')
  }
  const terrains = board.terrainAt(combat.target)
  if (!terrains?.includes(action.terrain)) throw new Error('Choose a printed defensive hex terrain')
  const frozen = state.weather?.ground === 'freeze'
  const attackingTerrain = Object.fromEntries([...new Set(combat.attackers.map((id) => hexOf(state, id, board)!))].map((from) => {
    const selected = action.attackingTerrain[from]
    const river = board.riverAt?.(from, combat.target)
    if (!selected || (!terrains.includes(selected as Terrain) && (!river || selected !== river))) {
      throw new Error(`Choose a terrain or river for the attacking stack at ${from}`)
    }
    return [from, selected]
  }))
  const antiTank = Math.max(combat.hedgehog > 0 ? 2 : 0, ...combat.defenders.map((id) => board.combatProfile(state, id)!.antiTank))
  const strengthOf = (id: string, attacking: boolean, terrain: AttackTerrain, supplied: boolean, enemyAntiTank: number) => {
    const counter = state.counters[id]!
    const profile = board.combatProfile(state, id)!
    const mode = modeOf(state, id, board)
    // TTW 1.4c：跨渡轮攻击力 ×¼（完好/修复桥不享渡轮减力）。
    const crossingFact = board.riverCrossing?.(state, hexOf(state, id, board)!, combat.target)
    const ferry = attacking && crossingFact?.kind === 'volga' ? volgaFerryAttackFactor(crossingFact.crossing) : 1
    return combatStrengthFromFacts({ attacking, terrain, frozen, supplied, enemyAntiTank, combatClass: profile.combatClass,
      strength: profile.strength, printedRe: profile.printedRe, stepsLost: counter.stepsLost ?? 0, antiTank: profile.antiTank,
      outOfSupply: counter.outOfSupply === true, artilleryDivision: profile.artilleryDivision,
      attackFactor: mode.attackFactor, defenseFactor: mode.defenseFactor }) * ferry
  }
  const attack = combat.attackers.reduce((sum, id) => sum + strengthOf(id, true, attackingTerrain[hexOf(state, id, board)!]!, true, antiTank), 0)
  const defend = combat.defenders.reduce((sum, id) => sum + strengthOf(id, false, action.terrain, combat.defenseSupplied === true, 0), 0)
  const crossing = (id: string) => board.riverAt?.(hexOf(state, id, board)!, combat.target) !== undefined
  const special = (id: string, attacking: boolean) => board.specialArModifier?.(state, id,
    { attacking, targetHex: combat.target, crossingRiver: crossing(id) }) ?? 0
  const modifier = modeRating(state, combat.attackerLeader, board) + special(combat.attackerLeader, true) -
    modeRating(state, combat.defenderLeader, board) - special(combat.defenderLeader, false) +
    armyGroupDestroyedCombatDrm(combat.attacker === 'axis', board.armyGroupDestroyed?.(state) === true)
  let rng = state.rng
  const result = rollRegularCombat(board.table, combatTerrainCategory(action.terrain), attack, defend, modifier, combat.hedgehog, {
    surprise: () => { const a = rollDie(rng); const b = rollDie(a.rng); rng = b.rng; return [a.value, b.value] as const },
    shift: () => { const d = rollDie(rng); rng = d.rng; return d.value },
    combat: () => { const a = rollDie(rng); const b = rollDie(a.rng); rng = b.rng; return [a.value, b.value] as const },
  }, combat.overrun === true)
  const counters = { ...state.counters }
  // OCS 5.7d/9.12a：DG 结果在选损失/撤退之前作用于守方格；有损失/选项时解除守方预备队标记。
  if (result.disorganize) for (const id of combat.defenders) counters[id] = { ...counters[id]!, disorganized: true }
  else if (result.defender.loss > 0 || result.defender.option > 0) {
    for (const id of combat.defenders) if (counters[id]!.mode === 'reserve') counters[id] = { ...counters[id]!, mode: undefined }
  }
  return { ...state, rng, counters, combat: { ...combat, roll: result, step: 'attacker-result' } }
}

function resolveCampaignCombat(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignCombatAction, { type: 'resolve-campaign-combat' }>, board: CampaignCombatBoard): CampaignTurnState {
  const combat = state.combat
  const attacker = combat?.step === 'attacker-result'
  if (!combat?.roll || (!attacker && combat.step !== 'defender-result') || attacker !== (actor === combat.attacker)) {
    throw new Error('The other side must resolve its combat result first')
  }
  const ids = attacker ? combat.attackers : combat.defenders
  const leader = attacker ? combat.attackerLeader! : combat.defenderLeader!
  const result = attacker ? combat.roll.attacker : combat.roll.defender
  const ignore = action.ignoreDefenderOption === true
  if (ignore && (attacker || !combat.defenderMayIgnore)) throw new Error('This side cannot ignore its combat option')
  const remaining = new Map(ids.map((id) => [id, board.losses.stepsOf(state, id) ?? 0]))
  const available = [...remaining.values()].reduce((sum, steps) => sum + steps, 0)
  const obligations = combatResultObligations(result, available, { ignoreOption: ignore, optionLosses: action.optionLosses })
  const allocations = combatLossAllocation(remaining, leader, action.lossOrder, obligations.totalLosses)
  let settled = applyCampaignCombatLosses(state, allocations, board.losses)
  const unmet = obligations.unmetOptions
  const retreat = obligations.retreatDistance
  const plans = action.retreats ?? []
  if (retreat > 0 || plans.length) settled = executeCampaignRetreat(settled, actor, ids, retreat, plans, combat, board)
  if (attacker) {
    // §9.13b-C 攻击格取战斗发起时的堆叠位置（含已损失单位）。
    const origins = [...new Set(ids.map((id) => hexOf(state, id, board)!))]
    const threshold = combat.roll.exploit
    const granted = exploitMarkerEligibility({
      threshold, overrun: combat.overrun === true, combatPhase: 'phase' in state.cursor && state.cursor.phase === 'combat', unmetOptions: unmet, origins,
      adjacent: (a, b) => board.distance(a, b) === 1,
      attackers: ids.flatMap((id) => {
        const counter = settled.counters[id]
        return counter?.location.kind === 'map' ? [{ id, rating: modeRating(settled, id, board), disorganized: counter.disorganized === true }] : []
      }),
    })
    const counters = { ...settled.counters }
    for (const id of granted) counters[id] = { ...counters[id]!, exploiting: true }
    return { ...settled, counters, combat: { ...combat, step: 'defender-result', defenderMayIgnore: unmet > 0,
      attackerRetreated: retreat > 0 } }
  }
  const empty = !combatUnits(settled, board).some(([id, counter]) => counter.side === actor && hexOf(settled, id, board) === combat.target)
  const survivors = combat.attackers.some((id) => hexOf(settled, id, board) !== undefined)
  if (combat.overrun) {
    // OCS 8.1：目标清空且未撤退 ⇒ 全员强制进格；否则结束战斗、保留 march 供返回移动。
    if (empty && !combat.attackerRetreated && survivors) return { ...settled, combat: { ...combat, step: 'advance' } }
    return { ...settled, combat: null, ...(combat.attackerRetreated ? { overrunMarch: null } : {}) }
  }
  const advance = empty && !combat.attackerRetreated && survivors
  return { ...settled, combat: advance ? { ...combat, step: 'advance' } : null }
}

function advanceCampaignCombat(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignCombatAction, { type: 'advance-campaign-combat' }>, board: CampaignCombatBoard): CampaignTurnState {
  const combat = state.combat
  if (combat?.step !== 'advance' || combat.attacker !== actor || new Set(action.unitIds).size !== action.unitIds.length ||
    action.unitIds.some((id) => !combat.attackers.includes(id) || hexOf(state, id, board) === undefined)) {
    throw new Error('Choose eligible surviving attackers for advancement')
  }
  if (combat.overrun) {
    const survivors = combat.attackers.filter((id) => hexOf(state, id, board) !== undefined)
    if (action.unitIds.length !== survivors.length || survivors.some((id) => !action.unitIds.includes(id))) {
      throw new Error('All surviving overrun participants must advance')
    }
  }
  const counters = { ...state.counters }
  for (const id of action.unitIds) counters[id] = { ...counters[id]!, location: { kind: 'map', hex: combat.target } }
  // TTW 1.4c：战后推进每条伏尔加级河岸每阶段 ≤3 RE（跨阶段重置）。
  const ledger = state.volgaAdvance?.phase === state.cursor.phase ? { ...state.volgaAdvance.re } : {}
  for (const id of action.unitIds) {
    const crossing = board.riverCrossing?.(state, hexOf(state, id, board)!, combat.target)
    if (crossing?.kind !== 'volga') continue
    const re = board.combatProfile(state, id)?.printedRe ?? 0
    const used = ledger[crossing.bank] ?? 0
    if (used + re > VOLGA_ADVANCE_RE_LIMIT) throw new Error('Volga bank advance exceeds 3 RE this phase')
    ledger[crossing.bank] = used + re
  }
  const advanced = { ...state, counters, combat: null,
    ...(Object.keys(ledger).length ? { volgaAdvance: { phase: state.cursor.phase, re: ledger } } : {}),
    ...(combat.overrun && state.overrunMarch ? { overrunMarch: { ...state.overrunMarch, enteredHex: true } } : {}) }
  if (board.stackingReAt(advanced, combat.target) > CAMPAIGN_STACKING_LIMIT_RE) throw new Error('Position exceeds stacking limit')
  return advanced
}

/* ── 撤退（OCS 9.12） ─────────────────────────────────────────── */

function retreatNeighbors(origin: string, path: readonly string[], side: Side, combat: CampaignCombat,
  board: CampaignCombatBoard): readonly string[] {
  const enemy = opposing(side)
  const at = path.at(-1) ?? origin
  return board.map.neighbors(at).filter((hex) => hex !== origin && !path.includes(hex) &&
    !combat.heldAtStart[enemy].includes(hex))
}

function passableRetreatStep(state: Readonly<CampaignTurnState>, side: Side, from: string, to: string,
  ids: readonly string[], board: CampaignCombatBoard): boolean {
  // TTW 1.4c：赫尔松渡口不可撤退；伏尔加仅完好/修复桥或冻结 Leg 可撤。
  const crossing = board.riverCrossing?.(state, from, to)
  if (crossing) {
    if (crossing.kind === 'kherson') return false
    for (const id of ids) {
      const mobility = board.combatProfile(state, id)?.mobility
      if (mobility === undefined || !volgaRetreatEligible(crossing.crossing, mobility)) return false
    }
  }
  return ids.every((id) => board.stepCost(state, id, from, to) !== null) &&
    !combatUnits(state, board).some(([unitId, counter]) => counter.side !== side && hexOf(state, unitId, board) === to)
}

/** TTW 1.4c：跨伏尔加级河/赫尔松渡口攻击资格。 */
function crossingAttackEligible(state: Readonly<CampaignTurnState>, board: CampaignCombatBoard, id: string,
  from: string, to: string, profile: CampaignCombatProfile): boolean {
  const crossing = board.riverCrossing?.(state, from, to)
  if (!crossing) return true
  if (profile.mobility === undefined) throw new Error('Combat profile mobility is required for a river crossing')
  return crossing.kind === 'volga' ? volgaAttackEligible(crossing.crossing, profile.mobility)
    : khersonAttackEligible(profile.mobility)
}

function validateRetreatRoute(route: CampaignRetreatPlan & { origin: string }, side: Side, distance: number,
  combat: CampaignCombat, state: Readonly<CampaignTurnState>, board: CampaignCombatBoard): void {
  const endpoint = route.path.at(-1)
  if (!endpoint || board.distance(route.origin, endpoint) !== distance) {
    throw new Error('Retreat must end the full option distance from its origin')
  }
  for (const [index, hex] of route.path.entries()) {
    if (!retreatNeighbors(route.origin, route.path.slice(0, index), side, combat, board).includes(hex) ||
      !passableRetreatStep(state, side, index === 0 ? route.origin : route.path[index - 1]!, hex, route.units, board)) {
      throw new Error('Retreat crosses an illegal hex or a hex occupied by the enemy at combat start')
    }
  }
  if (Object.keys(route.zocLosses ?? {}).some((step) => !/^(0|[1-9]\d*)$/.test(step) || Number(step) >= route.path.length)) {
    throw new Error('Choose a loss on the retreat path')
  }
}

function executeCampaignRetreat(state: Readonly<CampaignTurnState>, side: Side, involved: readonly string[],
  distance: number, plans: readonly CampaignRetreatPlan[], combat: CampaignCombat, board: CampaignCombatBoard): CampaignTurnState {
  if (distance === 0 && !plans.length) return state
  const expected = involved.filter((id) => hexOf(state, id, board) !== undefined)
  const all = plans.flatMap((plan) => plan.units)
  if (!distance || !all.length || new Set(all).size !== all.length || expected.some((id) => !all.includes(id))) {
    throw new Error('Give a retreat route for every surviving participant')
  }
  const routes = plans.map((plan) => {
    const origin = hexOf(state, plan.units[0] ?? '', board)
    if (!origin || !plan.units.some((id) => involved.includes(id))) throw new Error('Each retreat stack must include a surviving participant')
    const route = { ...plan, origin, path: plan.path.map((hex) => board.map.resolveHex(hex) ?? hex) }
    validateRetreatRoute(route, side, distance, combat, state, board)
    return route
  })
  const rawZoc = campaignGroundPosition(state, side, board.map, board.profileOf)?.enemyZoc ?? new Set<string>()
  let settled = state
  for (const route of routes) {
    for (let step = 0; step < route.path.length; step++) settled = retreatStep(settled, side, route, step, rawZoc, board)
  }
  for (const hex of new Set(routes.flatMap(({ units }) => units.map((id) => hexOf(settled, id, board))))) {
    if (hex && board.stackingReAt(settled, hex) > CAMPAIGN_STACKING_LIMIT_RE) throw new Error('Position exceeds stacking limit')
  }
  return settled
}

function retreatStep(state: Readonly<CampaignTurnState>, side: Side, route: CampaignRetreatPlan & { origin: string },
  index: number, rawZoc: ReadonlySet<string>, board: CampaignCombatBoard): CampaignTurnState {
  const to = route.path[index]!
  const from = index === 0 ? route.origin : route.path[index - 1]!
  const moving = route.units.filter((id) => hexOf(state, id, board) !== undefined)
  const loss = route.zocLosses?.[index]
  if (!moving.length) {
    if (loss !== undefined) throw new Error('Retreat includes an unnecessary ZOC loss')
    return state
  }
  if (!passableRetreatStep(state, side, from, to, moving, board)) {
    throw new Error('Retreat crosses an illegal hex or an enemy combat unit')
  }
  const counters = { ...state.counters }
  const effects = retreatStepEffects({
    enteredRawEnemyZoc: zocAffectsAction('retreat', rawZoc.has(to), false),
    secondRetreatHex: index === 1,
    units: moving.map((id) => ({ id, combat: board.profileOf(state, id)?.combat === true, disorganized: counters[id]!.disorganized === true })),
  })
  const dg = effects.zocLossCandidates
  if (dg.length && (!loss || !dg.includes(loss))) throw new Error('Choose a DG retreating unit to lose one step in enemy ZOC')
  if (loss !== undefined && !dg.length) throw new Error('Retreat includes an unnecessary ZOC loss')
  for (const id of moving) counters[id] = { ...counters[id]!, location: { kind: 'map', hex: to } }
  if (effects.disorganizeHex) {
    for (const [id, counter] of Object.entries(counters)) {
      if (counter.side === side && counter.location.kind === 'map' && board.map.resolveHex(counter.location.hex) === to &&
        board.profileOf(state, id)?.combat === true) counters[id] = { ...counter, disorganized: true }
    }
  }
  const moved = { ...state, counters }
  if (!loss) return moved
  return applyCampaignCombatLosses(moved, new Map([[loss, 1]]), board.losses)
}