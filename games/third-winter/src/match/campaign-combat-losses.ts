import { rollDie } from '@ocs-eastern/series/rng'
import { ARMY_GROUP_HQ_DESTROYED_VP, ARMY_HQ_DESTROYED_VP, corpsHqRecoveryRoll } from '../ttw/combat-special.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

/** 战斗/炮击共用的损失结算事实（步数、RE 折算、HQ 类别）。 */
export interface CampaignLossBoard {
  /** 图上战斗算子的剩余步数；undefined＝非图上战斗算子 */
  stepsOf(state: Readonly<CampaignTurnState>, id: string): number | undefined
  /** 损失 steps 后的剩余 RE（多步编制折算）；undefined＝不可用 */
  reAfterLoss(state: Readonly<CampaignTurnState>, id: string, losses: number): number | undefined
  /** TTW HQ 类别：歼灭 VP 与免费重建/恢复掷骰（2.3b E/c G/d、5.0a） */
  hqKindOf?(state: Readonly<CampaignTurnState>, id: string): 'army' | 'army-group' | 'corps' | undefined
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
      recoveries.push({ id, definition: counter.definition, kind, result: 'free-rebuild', turn: state.turn })
    } else if (kind === 'corps') {
      const rolled = rollDie(rng)
      rng = rolled.rng
      recoveries.push({ id, definition: counter.definition, kind, result: corpsHqRecoveryRoll(rolled.value),
        die: rolled.value, turn: state.turn })
    }
    counters[id] = { ...counter, location: { kind: 'dead-pile' }, currentRe: 0, outOfSupply: false }
  }
  return { ...state, counters, rng, sovietVp: vp, hqRecoveries: recoveries }
}