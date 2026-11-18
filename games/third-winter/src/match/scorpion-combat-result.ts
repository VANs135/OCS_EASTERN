import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionHexDistance } from '../import/hex-id.ts'
import { combatRating } from '../ttw/scorpion/combat-terrain.ts'
import { applyScorpionCombatLosses, validateCombatLossOrder } from './scorpion-combat-losses.ts'
import { remainingSteps } from './scorpion-losses.ts'
import { assertNoScorpionSpecialCapture, assertScorpionStacking, retreatScorpionCombat } from './scorpion-retreat.ts'
import type { RetreatPlan } from './scorpion-retreat.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

export type ResolveCombat = { type: 'resolve-combat'; lossOrder: readonly string[]; optionLosses: number;
  ignoreDefenderOption?: boolean; retreats: readonly RetreatPlan[] }

export function resolveScorpionCombat(state: Readonly<ScorpionInPlay>, actor: Side, action: ResolveCombat,
  assets: ScorpionSetupAssets, rail?: SupplyRailBoard): ScorpionInPlay {
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
  const available = ids.reduce((total, id) => total + remainingSteps(state.units[id]!), 0)
  const mandatory = Math.min(available, result.loss)
  const options = ignore ? 0 : result.option
  if (!Number.isSafeInteger(action.optionLosses) || action.optionLosses < 0 ||
    action.optionLosses > Math.min(options, available - mandatory)) throw new Error('Invalid combat option loss allocation')
  const losses = mandatory + action.optionLosses
  const allocations = validateCombatLossOrder(state, ids, leader, action.lossOrder, losses)
  let settled = applyScorpionCombatLosses(state, allocations, assets, rail)
  if (settled.victory) return { ...settled, combat: null }
  const unmet = options - action.optionLosses
  const retreat = available > losses ? unmet : 0
  settled = retreatScorpionCombat(settled, actor, ids, retreat, action.retreats, combat, assets, rail)
  if (settled.victory) return { ...settled, combat: null }

  if (attacker) {
    const threshold = combat.roll.exploit
    const origins = [...new Set(ids.map((id) => state.units[id]!.hex))]
    if (threshold !== null && unmet === 0 && state.cursor.phase === 'combat' && origins.length <= 2 &&
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
  const empty = !Object.values(settled.units).some((unit) => unit.side === actor && unit.combat && unit.hex === combat.target)
  const advance = empty && !combat.attackerRetreated && combat.attackers.some((id) => Object.hasOwn(settled.units, id))
  return { ...settled, combat: advance ? { ...combat, step: 'advance' } : null }
}

export function advanceScorpionCombat(state: Readonly<ScorpionInPlay>, side: Side, ids: readonly string[]): ScorpionInPlay {
  const combat = state.combat
  if (combat?.step !== 'advance' || combat.attacker !== side || new Set(ids).size !== ids.length) {
    throw new Error('Choose eligible surviving attackers for advancement')
  }
  const units = { ...state.units }
  if (ids.length) assertNoScorpionSpecialCapture(state, side, combat.target)
  for (const id of ids) {
    const unit = units[id]
    if (!unit || !combat.attackers.includes(id)) throw new Error('Only surviving attackers may advance')
    units[id] = { ...unit, hex: combat.target }
  }
  const advanced = { ...state, units, combat: null, railControl: ids.length
    ? { ...state.railControl, [combat.target]: side } : state.railControl }
  assertScorpionStacking(advanced, combat.target)
  return advanced
}
