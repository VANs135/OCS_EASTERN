import { canAbsorbBreakdown, canDetachBreakdownSteps, isBreakdownCounter } from '@ocs-eastern/series/breakdown'
import type { InternalStocks } from '@ocs-eastern/series/internal-stocks'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignCounter } from './campaign-reinforcement-state.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

/** 与 series BreakdownUnit 同构的事实（reserve 以字符串真值表达）。 */
export interface CampaignBreakdownFacts {
  combat: boolean
  combatClass: 'armor' | 'mech' | 'other'
  printedRe: number
  stepsLost: number
  actionRating: number
  moveMode?: boolean
  reserve?: string
  released?: boolean
  disorganized?: boolean
  exploit?: boolean
  exploitRating?: number
  outOfSupply?: boolean
  internalStocks?: InternalStocks
}

/**
 * OCS 20.0 / TTW 1.6e。parentPools 与 counters 的显式池分配即国籍与 1.6e 例外的编码
 * （苏近卫含空降→近卫池；德空军/猎兵→同类池；德山地→非猎兵国防军池），由剧本/绑定层给出。
 * copies=null 表示剧本未限数量（不限量）。
 */
export interface CampaignBreakdownBoard {
  resolveHex(hex: string): string | undefined
  factsOf(state: Readonly<CampaignTurnState>, id: string): CampaignBreakdownFacts | undefined
  /** 拆分算子定义事实：恒为 1 步 other 战斗算子；给出阵营与 AR。 */
  definitionFacts(definition: string): { side: Side; actionRating: number } | undefined
  parentPools: ReadonlyMap<string, string>
  counters: ReadonlyMap<string, { pool: string; copies: number | null }>
  stackingReAt(state: Readonly<CampaignTurnState>, hex: string): number
  hasMoved(state: Readonly<CampaignTurnState>, id: string): boolean
}

export type CampaignBreakdownAction =
  | { type: 'detach-campaign-breakdown'; parentId: string; definitions: readonly string[] }
  | { type: 'absorb-campaign-breakdown'; parentId: string; breakdownId: string }

const CAMPAIGN_STACKING_LIMIT_RE = 10

function counterFlags(counter: CampaignCounter) {
  return {
    moveMode: counter.mode === 'move',
    reserve: counter.mode === 'reserve' ? 'reserve' : undefined,
    disorganized: counter.disorganized === true,
    exploit: counter.exploiting === true,
    outOfSupply: counter.outOfSupply === true,
    internalStocks: counter.internalStocks,
  }
}

function stockPosition(state: Readonly<CampaignTurnState>) {
  const occupiedIds = new Set(Object.keys(state.counters))
  const inUse = new Map<string, number>()
  for (const counter of Object.values(state.counters)) {
    if (counter.location.kind === 'map') inUse.set(counter.definition, (inUse.get(counter.definition) ?? 0) + 1)
  }
  return { occupiedIds, inUse }
}

function freeBreakdownId(definition: string, occupiedIds: ReadonlySet<string>, returned: readonly string[] = []): string {
  const known = new Set(returned)
  for (const id of known) if (!occupiedIds.has(id)) return id
  for (let copy = 1; ; copy++) {
    const id = `breakdown:${definition}:${copy}`
    if (!occupiedIds.has(id) && !known.has(id)) return id
  }
}

export function applyCampaignBreakdown(state: Readonly<CampaignTurnState>, actor: Side, action: CampaignBreakdownAction,
  board: CampaignBreakdownBoard | undefined): CampaignTurnState {
  if (!board) throw new Error('Campaign breakdown pools are not configured')
  return action.type === 'detach-campaign-breakdown'
    ? detachCampaignBreakdown(state, actor, action, board)
    : absorbCampaignBreakdown(state, actor, action, board)
}

/** OCS 20.0a：普通移动开始前的拆分窗口；最后一步留在母单位。 */
function detachCampaignBreakdown(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignBreakdownAction, { type: 'detach-campaign-breakdown' }>, board: CampaignBreakdownBoard): CampaignTurnState {
  const { cursor } = state
  const parent = Object.hasOwn(state.counters, action.parentId) ? state.counters[action.parentId] : undefined
  const parentHex = parent?.location.kind === 'map' ? board.resolveHex(parent.location.hex) : undefined
  const facts = parent && board.factsOf(state, action.parentId)
  const pool = parent && board.parentPools.get(parent.definition)
  if (!('phasing' in cursor) || cursor.phase !== 'movement' || cursor.phasing !== actor ||
    state.movementSegment !== 'movement' || !parent || parent.side !== actor || !parentHex || !facts || !pool ||
    board.hasMoved(state, action.parentId) || !Array.isArray(action.definitions) || !action.definitions.length ||
    !canDetachBreakdownSteps(facts, action.definitions.length)) {
    throw new Error('Choose an eligible multi-step unit before it starts moving, leaving its last step intact')
  }
  const counters = { ...state.counters }
  const { occupiedIds, inUse } = stockPosition(state)
  const flags = counterFlags(parent)
  for (const key of action.definitions) {
    const entry = board.counters.get(key)
    const def = board.definitionFacts(key)
    if (!entry || entry.pool !== pool || !def || def.side !== actor ||
      (entry.copies !== null && (!Number.isSafeInteger(entry.copies) || entry.copies < 0))) {
      throw new Error('Choose a one-step breakdown from the parent unit’s pool')
    }
    const used = inUse.get(key) ?? 0
    if (entry.copies !== null && used >= entry.copies) throw new Error('No copy of this breakdown counter remains in the pool')
    const detached: CampaignBreakdownFacts = { combat: true, combatClass: 'other', printedRe: 1, stepsLost: 0,
      actionRating: def.actionRating, ...flags }
    if (!isBreakdownCounter(detached)) throw new Error('Choose an eligible breakdown counter')
    if (detached.actionRating > facts.actionRating) throw new Error('Breakdown action rating exceeds the parent unit’s rating')
    const id = freeBreakdownId(key, occupiedIds, state.breakdownReturns?.[key])
    counters[id] = { kind: 'land', side: actor, definition: key, location: { kind: 'map', hex: parentHex },
      currentRe: 1, stepsLost: 0, mode: parent.mode, disorganized: parent.disorganized, exploiting: parent.exploiting,
      outOfSupply: parent.outOfSupply, internalStocks: parent.internalStocks }
    occupiedIds.add(id)
    inUse.set(key, used + 1)
  }
  const stepsLost = (parent.stepsLost ?? 0) + action.definitions.length
  counters[action.parentId] = { ...parent, stepsLost, currentRe: facts.printedRe - stepsLost }
  const settled = { ...state, counters }
  if (board.stackingReAt(settled, parentHex) > CAMPAIGN_STACKING_LIMIT_RE) throw new Error('Position exceeds stacking limit')
  return settled
}

/** OCS 20.0b–d：同格同池且模式/标记一致才可吸收；算子回池（删除实例并记返回身份）。 */
function absorbCampaignBreakdown(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignBreakdownAction, { type: 'absorb-campaign-breakdown' }>, board: CampaignBreakdownBoard): CampaignTurnState {
  const { cursor } = state
  const parent = Object.hasOwn(state.counters, action.parentId) ? state.counters[action.parentId] : undefined
  const detached = Object.hasOwn(state.counters, action.breakdownId) ? state.counters[action.breakdownId] : undefined
  const parentHex = parent?.location.kind === 'map' ? board.resolveHex(parent.location.hex) : undefined
  const detachedHex = detached?.location.kind === 'map' ? board.resolveHex(detached.location.hex) : undefined
  const parentFacts = parent && board.factsOf(state, action.parentId)
  const entry = detached && board.counters.get(detached.definition)
  const def = detached && board.definitionFacts(detached.definition)
  const pool = parent && board.parentPools.get(parent.definition)
  if (!('phasing' in cursor) || cursor.phasing !== actor ||
    (cursor.phase !== 'movement' && cursor.phase !== 'combat' && cursor.phase !== 'exploitation') ||
    !parent || parent.side !== actor || !detached || detached.side !== actor || !parentHex || parentHex !== detachedHex ||
    !parentFacts || !entry || !def || !pool || entry.pool !== pool || !parentFacts.stepsLost) {
    throw new Error('Absorb a matching breakdown from the same hex and pool')
  }
  const detachedFacts: CampaignBreakdownFacts = { combat: true, combatClass: 'other', printedRe: 1, stepsLost: 0,
    actionRating: def.actionRating, ...counterFlags(detached) }
  if (!canAbsorbBreakdown(parentFacts, detachedFacts)) throw new Error('Absorb a matching breakdown from the same hex and pool')
  const counters = { ...state.counters }
  const stepsLost = parentFacts.stepsLost - 1
  counters[action.parentId] = { ...parent, stepsLost, currentRe: parentFacts.printedRe - stepsLost }
  delete counters[action.breakdownId]
  const returned = state.breakdownReturns?.[detached.definition] ?? []
  return { ...state, counters,
    breakdownReturns: { ...state.breakdownReturns, [detached.definition]: [...new Set([...returned, action.breakdownId])] } }
}