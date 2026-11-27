import { allowsBarrageSource } from '@ocs-eastern/series/fire-timing'
import { groundModeEffect } from '@ocs-eastern/series/modes'
import { rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import { barrageColumn, barrageDensity, barrageVolleyStrength, rollGroundBarrage } from '@ocs-eastern/series/tables/barrage'
import type { BarrageTable } from '@ocs-eastern/series/tables/barrage'
import { actingSide } from '@ocs-eastern/series/turn'
import type { Terrain } from '../import/scorpion-map.ts'
import { combatTerrainCategory } from '../ttw/combat-terrain.ts'
import { applyCampaignCombatLosses } from './campaign-combat-losses.ts'
import type { CampaignLossBoard } from './campaign-combat-losses.ts'
import { campaignCounterGroundMode } from './campaign-ground-position.ts'
import type { CampaignGroundMap, CampaignGroundProfiles } from './campaign-ground-position.ts'
import { campaignPhysicalSupply, campaignSupplySourceKey, spendCampaignSupply } from './campaign-supply-ledger.ts'
import type { CampaignSupplySource } from './campaign-supply-ledger.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

/** 炮兵面＋模式＋阶段资格事实；undefined＝该算子当前不能炮击。 */
export interface CampaignBarrageProfile {
  strength: number
  range: number
  independentRe: boolean
  /** 反应/进击阶段的释放与进击资格，与移动侧同一事实 */
  phaseEligible: boolean
}

export interface CampaignBarrageBoard {
  map: CampaignGroundMap
  table: BarrageTable
  profileOf: CampaignGroundProfiles
  distance(a: string, b: string): number
  barrageProfile(state: Readonly<CampaignTurnState>, id: string): CampaignBarrageProfile | undefined
  stepsOf(state: Readonly<CampaignTurnState>, id: string): number | undefined
  printedReOf(state: Readonly<CampaignTurnState>, id: string): number | undefined
  formationOf?(state: Readonly<CampaignTurnState>, id: string): string | undefined
  terrainAt(hex: string): readonly Terrain[] | undefined
  hedgehogAt(state: Readonly<CampaignTurnState>, hex: string): number
  /** 供补给可用性：direct 按 dump trace，hq 按 HQ throw range */
  canUseSupply(state: Readonly<CampaignTurnState>, side: Side, unitId: string, key: string, hqId?: string): boolean
  losses: CampaignLossBoard
}

export interface CampaignBarrage {
  target: string
  defender: Side
  batteries: readonly { unitId: string; re: number }[]
  strength: number
  initialColumn: number
  cost: number
  hedgehog: number
  /** OCS 14.7: an air strike uses the barrage table but has no artillery battery or supply cost. */
  air?: { missionId: string; kind: 'barrage' | 'hip-shoot' | 'trainbusting'; hipShoot: boolean; tankBuster: boolean; shortRange: boolean }
  roll?: ReturnType<typeof rollGroundBarrage>
  lossesDue?: number
}

export type CampaignBarrageRecord = CampaignBarrage & {
  turn: number
  phasing: Side
  phase: string
  terrain?: Terrain
}

export type CampaignBarrageAction =
  | { type: 'declare-campaign-barrage'; target: string; batteries: readonly { unitId: string; re?: number }[];
      supply: { kind: 'direct' | 'hq'; hqId?: string; payments: readonly { source: CampaignSupplySource; tokens: number }[] } }
  | { type: 'choose-campaign-barrage-terrain'; terrain: Terrain }
  | { type: 'assign-campaign-barrage-loss'; allocation: readonly { unitId: string; steps: number }[] }

/** OCS 10.0e：本阶段已炮击过的目标格（每阶段每格一次）。 */
export function campaignPhaseBarrages(state: Readonly<CampaignTurnState>): readonly CampaignBarrageRecord[] {
  const { cursor } = state
  if (!('phasing' in cursor)) return []
  return (state.barrageHistory ?? []).filter((event) => event.turn === state.turn &&
    event.phasing === cursor.phasing && event.phase === cursor.phase)
}

export function campaignBarrageTargetUnits(state: Readonly<CampaignTurnState>, side: Side, hex: string,
  board: CampaignBarrageBoard): readonly string[] {
  return Object.entries(state.counters).filter(([id, counter]) => {
    if (counter.side !== side || counter.location.kind !== 'map') return false
    return board.map.resolveHex(counter.location.hex) === hex && board.profileOf(state, id)?.combat === true
  }).map(([id]) => id)
}

/** OCS 10.0b：正确观察员＝目标格相邻的友方战斗单位。 */
export function hasCampaignBarrageSpotter(state: Readonly<CampaignTurnState>, side: Side, target: string,
  board: CampaignBarrageBoard): boolean {
  const adjacent = board.map.neighbors(target)
  return Object.entries(state.counters).some(([id, counter]) => counter.side === side &&
    counter.location.kind === 'map' && adjacent.includes(board.map.resolveHex(counter.location.hex) ?? '') &&
    board.profileOf(state, id)?.combat === true)
}

export function applyCampaignBarrage(state: Readonly<CampaignTurnState>, actor: Side, action: CampaignBarrageAction,
  board: CampaignBarrageBoard | undefined): CampaignTurnState {
  if (!board) throw new Error('Campaign barrage rules are not configured')
  if (action.type === 'declare-campaign-barrage') return declareCampaignBarrage(state, actor, action, board)
  if (action.type === 'choose-campaign-barrage-terrain') return chooseCampaignBarrageTerrain(state, actor, action, board)
  return assignCampaignBarrageLoss(state, actor, action, board)
}

function declareCampaignBarrage(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignBarrageAction, { type: 'declare-campaign-barrage' }>, board: CampaignBarrageBoard): CampaignTurnState {
  const { cursor } = state
  const target = board.map.resolveHex(action.target)
  const defender = actor === 'axis' ? 'soviet' : 'axis'
  if (!('phasing' in cursor) || actingSide(cursor.phasing, cursor.phase) !== actor ||
    !allowsBarrageSource(cursor.phase, 'artillery') || state.lateTurnSegment !== 'shooting' || state.barrage ||
    !target || !campaignBarrageTargetUnits(state, defender, target, board).length ||
    campaignPhaseBarrages(state).some((event) => event.target === target)) {
    throw new Error('Artillery may barrage an enemy target once per phase in the shooting segment')
  }
  if (!action.batteries.length || new Set(action.batteries.map(({ unitId }) => unitId)).size !== action.batteries.length) {
    throw new Error('Select one or more distinct artillery counters')
  }
  const fired = campaignPhaseBarrages(state).flatMap((event) => event.batteries)
  const facts = action.batteries.map(({ unitId, re }) => {
    const counter = Object.hasOwn(state.counters, unitId) ? state.counters[unitId] : undefined
    const hex = counter?.location.kind === 'map' ? board.map.resolveHex(counter.location.hex) : undefined
    const profile = counter && board.profileOf(state, unitId)
    const face = counter && board.barrageProfile(state, unitId)
    const mode = counter && profile && groundModeEffect(campaignCounterGroundMode(counter, profile.inCombatMode))
    if (!counter || counter.side !== actor || !hex || !profile?.combat || !face || !mode?.canBarrage ||
      !face.phaseEligible || hex === target || board.distance(hex, target) > face.range) {
      throw new Error('Select eligible artillery within printed range')
    }
    const used = fired.filter((battery) => battery.unitId === unitId).reduce((total, battery) => total + battery.re, 0)
    return { id: unitId, strength: face.strength, printedRe: board.printedReOf(state, unitId) ?? 1,
      independentRe: face.independentRe, remainingSteps: board.stepsOf(state, unitId) ?? 0, usedRe: used,
      barrageFactor: mode.barrageFactor, firingRe: re }
  })
  const volley = barrageVolleyStrength(facts)
  const { initialColumn, cost } = barrageColumn(board.table, volley.strength)
  const hedgehog = board.hedgehogAt(state, target)
  if (!Number.isInteger(hedgehog) || hedgehog < 0 || hedgehog > 4) throw new Error('Invalid hedgehog level')
  const batteries = volley.batteries.map(({ id, re }) => ({ unitId: id, re }))
  const { supply } = action
  const sources = campaignPhysicalSupply(state, actor, board.map)
  const spending = new Map<string, number>()
  for (const { source, tokens } of supply.payments) {
    const key = campaignSupplySourceKey(board.map.resolveHex, source)
    if (!Number.isSafeInteger(tokens) || tokens < 1) throw new Error('Pay the initial column cost in whole tokens')
    spending.set(key, (spending.get(key) ?? 0) + tokens)
  }
  const total = [...spending.values()].reduce((sum, tokens) => sum + tokens, 0)
  if (total !== cost || (supply.kind === 'direct' && batteries.length > 1 && spending.size !== 1) ||
    (supply.kind === 'hq' && !supply.hqId)) {
    throw new Error('Pay the initial column cost through a common HQ or a single shared dump')
  }
  for (const [key] of spending) {
    if (!batteries.every(({ unitId }) => board.canUseSupply(state, actor, unitId, key, supply.hqId))) {
      throw new Error('Pay the initial column cost through a common HQ or a single shared dump')
    }
  }
  const paid = spendCampaignSupply(state, actor, sources, spending)
  return { ...paid, barrage: { target, defender, batteries, strength: volley.strength, initialColumn, cost, hedgehog } }
}

function chooseCampaignBarrageTerrain(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignBarrageAction, { type: 'choose-campaign-barrage-terrain' }>, board: CampaignBarrageBoard): CampaignTurnState {
  const barrage = state.barrage
  if (!barrage || actor !== barrage.defender || barrage.roll) throw new Error('The targeted player must choose the barrage terrain')
  if (!board.terrainAt(barrage.target)?.includes(action.terrain)) throw new Error('Choose a printed terrain in the target hex')
  const defenders = campaignBarrageTargetUnits(state, actor, barrage.target, board)
  const density = barrageDensity(defenders.map((id) => ({
    re: state.counters[id]!.currentRe ?? board.printedReOf(state, id) ?? 1, formation: board.formationOf?.(state, id),
  })))
  const spotter = barrage.air ? false : hasCampaignBarrageSpotter(state, actor === 'axis' ? 'soviet' : 'axis', barrage.target, board)
  let rng = state.rng
  const roll = rollGroundBarrage(board.table, barrage.initialColumn, {
    density, hedgehog: barrage.hedgehog, terrain: combatTerrainCategory(action.terrain), spotter,
  }, {
    table: () => { const first = rollDie(rng); const second = rollDie(first.rng); rng = second.rng; return [first.value, second.value] as const },
    halfLoss: () => { const drawn = rollDie(rng); rng = drawn.rng; return drawn.value },
  })
  const counters = { ...state.counters }
  // OCS 10.0a：DG 结果作用于目标格内该方所有战斗单位。
  if (roll.disorganize) for (const id of defenders) counters[id] = { ...counters[id]!, disorganized: true }
  const lossesDue = Math.min(roll.loss, defenders.reduce((sum, id) => sum + (board.stepsOf(state, id) ?? 0), 0))
  const result = { ...barrage, roll, lossesDue }
  const { cursor } = state
  const record: CampaignBarrageRecord = { ...result, turn: state.turn,
    phasing: 'phasing' in cursor ? cursor.phasing : actor, phase: cursor.phase, terrain: action.terrain }
  const settled = { ...state, counters, rng, barrage: result, barrageHistory: [...(state.barrageHistory ?? []), record] }
  return lossesDue ? settled : { ...settled, barrage: null }
}

function assignCampaignBarrageLoss(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignBarrageAction, { type: 'assign-campaign-barrage-loss' }>, board: CampaignBarrageBoard): CampaignTurnState {
  const barrage = state.barrage
  if (!barrage || actor !== barrage.defender || !barrage.lossesDue ||
    new Set(action.allocation.map(({ unitId }) => unitId)).size !== action.allocation.length ||
    action.allocation.reduce((total, { steps }) => total + steps, 0) !== barrage.lossesDue) {
    throw new Error('Assign exactly the mandatory barrage losses')
  }
  const defenders = new Set(campaignBarrageTargetUnits(state, actor, barrage.target, board))
  for (const { unitId, steps } of action.allocation) {
    const remaining = defenders.has(unitId) ? board.losses.stepsOf(state, unitId) : undefined
    if (remaining === undefined || !Number.isSafeInteger(steps) || steps < 1 || steps > remaining) {
      throw new Error('Only combat units in the target hex can take barrage losses')
    }
  }
  // OCS 9.11c：炮击损失自由选择，不适用 AR 领导单位先吃与逐轮均摊。
  const settled = applyCampaignCombatLosses(state, new Map(action.allocation.map(({ unitId, steps }) => [unitId, steps])), board.losses)
  return { ...settled, barrage: null }
}

/** 射击环节结束阻塞：未结算的炮击必须先处理。 */
export function campaignBarrageBlockers(state: Readonly<CampaignTurnState>): readonly string[] {
  return state.barrage ? ['barrage'] : []
}