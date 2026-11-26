import { rollDie } from '@ocs-eastern/series/rng'
import { ARMY_GROUP_HQ_DESTROYED_VP, ARMY_HQ_DESTROYED_VP, corpsHqRecoveryRoll, remnantGenerationEligible } from '../ttw/combat-special.ts'
import { KESSEL_RETURN_TURNS } from './campaign-kessel-placement.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

/** TTW 2.4d 残部自动生成事实（绑定层组合 remnantDestinations 与池库存）。 */
export interface CampaignRemnantGeneration {
  isParentDivision(state: Readonly<CampaignTurnState>, id: string): boolean
  /** 距被毁格恰 2 格以西、开放 Leg 路径、堆叠 ≤10 的落点（已排序）。 */
  destinations(state: Readonly<CampaignTurnState>, id: string, hex: string): readonly string[]
  /** 池中可用残部物理身份；undefined＝池尽。 */
  nextId(state: Readonly<CampaignTurnState>): string | undefined
  definition: string
}

/** 战斗/炮击共用的损失结算事实（步数、RE 折算、HQ 类别）。 */
export interface CampaignLossBoard {
  /** 图上战斗算子的剩余步数；undefined＝非图上战斗算子 */
  stepsOf(state: Readonly<CampaignTurnState>, id: string): number | undefined
  /** 损失 steps 后的剩余 RE（多步编制折算）；undefined＝不可用 */
  reAfterLoss(state: Readonly<CampaignTurnState>, id: string, losses: number): number | undefined
  /** TTW HQ 类别：歼灭 VP 与免费重建/恢复掷骰（2.3b E/c G/d、5.0a） */
  hqKindOf?(state: Readonly<CampaignTurnState>, id: string): 'army' | 'army-group' | 'corps' | undefined
  /** TTW 2.3a：Kessel HQ 被毁调度三回合返回（不计歼灭 VP）。 */
  isKesselHq?(state: Readonly<CampaignTurnState>, id: string): boolean
  /** TTW 2.4d 残部生成（可选；缺省＝不生成）。 */
  remnant?: CampaignRemnantGeneration
}

/** 被毁 HQ 的恢复记录：增援环据此免费重建（Corps 4–6 留 Dead Pile）。 */
export interface CampaignHqRecovery {
  id: string
  definition: string
  kind: 'army' | 'army-group' | 'corps'
  result: 'free-rebuild' | 'dead-pile'
  /** Corps 恢复掷骰（2.3d） */
  die?: number
  turn: number
  /** 下一个轴心增援阶段所在回合（2.3b E/c G/d「下一个轴心国增援阶段」）。 */
  availableTurn: number
}

/** 被毁回合＋先手顺序 ⇒ 免费重建可用的轴心增援回合。苏军先手时苏军回合内的被毁当回合轴心增援即可重建。 */
function nextAxisReinforcementTurn(state: Readonly<CampaignTurnState>): number {
  const sameTurn = 'phasing' in state.cursor && state.cursor.phasing === 'soviet' && state.cursor.first === 'soviet'
  return state.turn + (sameTurn ? 0 : 1)
}

/**
 * 战斗/炮击损失共用入口：减步或整算子进 Dead Pile（TTW 2.4b）。
 * 轴心 Army/Army Group HQ 被毁记苏军歼灭 VP（5.0a，可重复）与免费重建；
 * Corps HQ 被毁掷 1 骰定恢复（2.3d）。损耗不走这里（2.4d 残部不适用损耗）。
 * 校验失败不改局面或骰序。
 */
export function applyCampaignCombatLosses(state: Readonly<CampaignTurnState>, allocation: ReadonlyMap<string, number>,
  board: CampaignLossBoard): CampaignTurnState {
  const counters = { ...state.counters }
  let vp = state.sovietVp ?? 0
  let rng = state.rng
  const recoveries = [...(state.hqRecoveries ?? [])]
  const kesselReturn = { ...(state.kesselReturn ?? {}) }
  for (const [id, steps] of allocation) {
    const counter = Object.hasOwn(counters, id) ? counters[id] : undefined
    const remaining = counter?.location.kind === 'map' ? board.stepsOf(state, id) : undefined
    if (!counter || remaining === undefined || !Number.isSafeInteger(steps) || steps < 1 || steps > remaining) {
      throw new Error('Choose surviving combat steps for losses')
    }
    if (steps < remaining) {
      const currentRe = board.reAfterLoss(state, id, steps)
      if (currentRe === undefined || !Number.isFinite(currentRe) || currentRe <= 0) {
        throw new Error('Remaining RE after loss is unavailable')
      }
      counters[id] = { ...counter, stepsLost: (counter.stepsLost ?? 0) + steps, currentRe }
      continue
    }
    const kind = counter.kind === 'hq' ? board.hqKindOf?.(state, id) : undefined
    if (kind === 'army' || kind === 'army-group') {
      vp += kind === 'army' ? ARMY_HQ_DESTROYED_VP : ARMY_GROUP_HQ_DESTROYED_VP
      recoveries.push({ id, definition: counter.definition, kind, result: 'free-rebuild', turn: state.turn,
        availableTurn: nextAxisReinforcementTurn(state) })
    } else if (kind === 'corps') {
      const rolled = rollDie(rng)
      rng = rolled.rng
      recoveries.push({ id, definition: counter.definition, kind, result: corpsHqRecoveryRoll(rolled.value),
        die: rolled.value, turn: state.turn, availableTurn: nextAxisReinforcementTurn(state) })
    }
    counters[id] = { ...counter, location: { kind: 'dead-pile' }, currentRe: 0, outOfSupply: false }
    // TTW 2.3a：Kessel HQ 被毁调度三回合返回（离图池/死堆期满后再放置），不计歼灭 VP。
    if (counter.kind === 'hq' && board.isKesselHq?.(state, id)) kesselReturn[id] = state.turn + KESSEL_RETURN_TURNS
    // TTW 2.4d：16-4-3 步兵师战斗损失最后一步 ⇒ 池有余且落点合法时自动生成残部营，继承指示物与模式。
    const remnant = board.remnant
    if (remnant && counter.location.kind === 'map' && remnant.isParentDivision(state, id)) {
      const rid = remnant.nextId(state)
      const dest = remnant.destinations(state, id, counter.location.hex)[0]
      if (rid && dest && remnantGenerationEligible({ parentIs1643Infantry: true, lastStepLostInCombat: true, poolHasRemnant: true })) {
        counters[rid] = { kind: 'land', side: counter.side, definition: remnant.definition, location: { kind: 'map', hex: dest },
          currentRe: 1, stepsLost: 0, mode: counter.mode, disorganized: counter.disorganized, exploiting: counter.exploiting,
          outOfSupply: counter.outOfSupply, internalStocks: counter.internalStocks }
      }
    }
  }
  return { ...state, counters, rng, sovietVp: vp, hqRecoveries: recoveries, kesselReturn }
}