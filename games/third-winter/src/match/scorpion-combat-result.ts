import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionHexDistance } from '../import/hex-id.ts'
import { combatRating } from '../ttw/scorpion/combat-terrain.ts'
import { detachScorpionBreakdowns } from './scorpion-breakdowns.ts'
import type { ScorpionBreakdownOrder } from './scorpion-breakdowns.ts'
import { resolveScorpionEntry } from './scorpion-capture.ts'
import type { ScorpionCapturePolicy } from './scorpion-capture.ts'
import type { ScorpionCombat } from './scorpion-combat.ts'
import { applyScorpionCombatLosses, validateCombatLossOrder } from './scorpion-combat-losses.ts'
import { remainingSteps } from './scorpion-losses.ts'
import { advanceScorpionOverrun, finishScorpionOverrun } from './scorpion-overrun.ts'
import type { ScorpionRemnantPlacement } from './scorpion-remnants.ts'
import { resumeScorpionCombatRetreat, retreatScorpionCombat } from './scorpion-retreat.ts'
import { assertScorpionStacking } from './scorpion-stacking.ts'
import type { ContinueCombatRetreat, RetreatPlan } from './scorpion-retreat.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'

export type ResolveCombat = { type: 'resolve-combat'; lossOrder: readonly string[]; optionLosses: number;
  ignoreDefenderOption?: boolean; retreats: readonly RetreatPlan[]; remnants?: readonly ScorpionRemnantPlacement[] }

export function resolveScorpionCombat(state: Readonly<ScorpionInPlay>, actor: Side, action: ResolveCombat,
  assets: ScorpionSetupAssets, policy: ScorpionCapturePolicy): ScorpionInPlay {
  const combat = state.combat
  const attacker = combat?.step === 'attacker-result'
  if (!combat?.roll || combat.retreat || (!attacker && combat.step !== 'defender-result') || attacker !== (actor === combat.attacker)) {
    throw new Error('The other side must resolve its combat result first')
  }
  const ids = attacker ? combat.attackers : combat.defenders
  const leader = attacker ? combat.attackerLeader! : combat.defenderLeader!
  const result = attacker ? combat.roll.attacker : combat.roll.defender
  const ignore = action.ignoreDefenderOption === true
  if (ignore && (attacker || !combat.defenderMayIgnore)) throw new Error('This side cannot ignore its combat option')
  const available = ids.reduce((total, id) => total + remainingSteps(state.units[id]!), 0)
  const mandatory = Math.min(available, result.loss)
  const options = ignore ? 0 : result.option
  if (!Number.isSafeInteger(action.optionLosses) || action.optionLosses < 0 ||
    action.optionLosses > Math.min(options, available - mandatory)) throw new Error('Invalid combat option loss allocation')
  const losses = mandatory + action.optionLosses
  const allocations = validateCombatLossOrder(state, ids, leader, action.lossOrder, losses)
  let settled = applyScorpionCombatLosses(state, allocations, assets, policy.supplyRail, action.remnants ?? [])
  if (settled.victory) return { ...settled, combat: null, overrunMarch: null }
  const unmet = options - action.optionLosses
  const retreat = available > losses ? unmet : 0
  if (combat.kind === 'overrun' && attacker && action.retreats.some(({ units }) => units.some((id) => !ids.includes(id)))) {
    throw new Error('Only overrun participants can retreat with the attacking stack')
  }
  const retreatResult = retreatScorpionCombat(settled, actor, ids, retreat, action.retreats, combat, assets, policy)
  settled = retreatResult.state
  if (settled.victory) return { ...settled, combat: null, overrunMarch: null, capture: null }
  if (retreatResult.pending) return { ...settled, combat: { ...combat, retreat: retreatResult.pending } }

  if (attacker) {
    const threshold = combat.roll.exploit
    const origins = [...new Set(ids.map((id) => state.units[id]!.hex))]
    if (combat.kind !== 'overrun' && threshold !== null && unmet === 0 && state.cursor.phase === 'combat' && origins.length <= 2 &&
      (origins.length === 1 || scorpionHexDistance(origins[0]!, origins[1]!) === 1)) {
      const units = { ...settled.units }
      for (const id of ids) {
        const unit = units[id]
        if (unit && !unit.disorganized && combatRating(unit) >= threshold) {
          units[id] = { ...unit, exploit: true, exploitRating: threshold }
        }
      }
      settled = { ...settled, units }
    }
    return { ...settled, combat: { ...combat, step: 'defender-result', defenderMayIgnore: unmet > 0,
      attackerRetreated: retreat > 0 } }
  }
  return finishDefenderResult(settled, actor, combat, assets, policy)
}

export function continueScorpionRetreatResult(state: Readonly<ScorpionInPlay>, actor: Side, action: ContinueCombatRetreat,
  assets: ScorpionSetupAssets, policy: ScorpionCapturePolicy): ScorpionInPlay {
  const combat = state.combat
  const retreat = combat?.retreat
  if (!retreat || retreat.side !== actor) throw new Error('Only the retreating side may continue its pending route')
  const { state: settled, pending } = resumeScorpionCombatRetreat(state, retreat, action.routes, combat, assets, policy)
  if (settled.victory) return { ...settled, combat: null, overrunMarch: null, capture: null }
  if (pending) return { ...settled, combat: { ...combat, retreat: pending } }
  const resolved = { ...combat, retreat: undefined }
  if (resolved.step === 'attacker-result') {
    return { ...settled, combat: { ...resolved, step: 'defender-result', defenderMayIgnore: true, attackerRetreated: true } }
  }
  return finishDefenderResult(settled, actor, resolved, assets, policy)
}

function finishDefenderResult(settled: Readonly<ScorpionInPlay>, actor: Side, combat: ScorpionCombat,
  assets: ScorpionSetupAssets, policy: ScorpionCapturePolicy): ScorpionInPlay {
  const empty = !Object.values(settled.units).some((unit) => unit.side === actor && unit.combat && unit.hex === combat.target)
  if (combat.kind === 'overrun') return finishScorpionOverrun(settled, combat, empty, assets, policy)
  const advance = empty && !combat.attackerRetreated && combat.attackers.some((id) => Object.hasOwn(settled.units, id))
  return { ...settled, combat: advance ? { ...combat, step: 'advance' } : null }
}

export function advanceScorpionCombat(state: Readonly<ScorpionInPlay>, side: Side, ids: readonly string[],
  assets: ScorpionSetupAssets, policy: ScorpionCapturePolicy, orders: readonly ScorpionBreakdownOrder[] = []): ScorpionInPlay {
  const combat = state.combat
  if (combat?.step !== 'advance' || combat.attacker !== side || new Set(ids).size !== ids.length) {
    throw new Error('Choose eligible surviving attackers for advancement')
  }
  if (ids.some((id) => !Object.hasOwn(state.units, id) || !combat.attackers.includes(id))) {
    throw new Error('Only surviving attackers may advance')
  }
  if (combat.kind === 'overrun') return advanceScorpionOverrun(state, combat, ids, orders, assets, policy)
  const split = detachScorpionBreakdowns(state, side, orders, ids, assets)
  const entrants = [...ids, ...split.detachedIds]
  const units = { ...split.state.units }
  for (const id of entrants) units[id] = { ...units[id]!, hex: combat.target }
  const advanced = { ...split.state, units, combat: null }
  assertScorpionStacking(advanced, combat.target)
  return entrants.length ? resolveScorpionEntry(advanced, side, combat.target, entrants, assets, true, policy) : advanced
}
