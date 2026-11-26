import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import { createRngState, verifyRngState } from '@ocs-eastern/series/rng'
import type { RngState, Side } from '@ocs-eastern/series/state-types'
import { advancePlayerTurn } from '@ocs-eastern/series/turn'
import { initialWeatherHistory } from '../ttw/campaign/weather.ts'
import { canAddOffensive, canDesignateRegrouping, mustLeaveOffensive } from '../ttw/front-posture.ts'
import { kirovogradOpening, kirovogradScenario } from '../ttw/campaign/kirovograd.ts'
import { consolidateCampaignAircraft } from './campaign-aircraft-consolidation.ts'
import { refitCampaignAircraft } from './campaign-aircraft-refit.ts'
import { applyCampaignBreakout } from './campaign-breakout.ts'
import { applyCampaignBarrage } from './campaign-barrage.ts'
import { applyCampaignCombat, resetCampaignCombatLedgers } from './campaign-combat.ts'
import { applyCampaignBreakdown, campaignBreakdownAbsorbObligations } from './campaign-breakdown.ts'
import { completeCampaignCleanup } from './campaign-cleanup-phase.ts'
import { completeCampaignExploitation } from './campaign-exploitation-phase.ts'
import { applyCampaignGroundMovement, releaseCampaignCounters } from './campaign-ground-movement.ts'
import { applyCampaignKhersonFerry } from './campaign-kherson-ferry.ts'
import { completeCampaignLateSegment } from './campaign-late-turn.ts'
import { applyCampaignMarchResponse } from './campaign-march-response.ts'
import { applyCampaignPontoonAction, closeCampaignPontoonPhase } from './campaign-pontoon-phase.ts'
import { applyCampaignPreTurn } from './campaign-pre-turn.ts'
import { applyCampaignRailTransport } from './campaign-rail-transport.ts'
import { applyCampaignReinforcementPhase } from './campaign-reinforcement-phase.ts'
import { applyCampaignSupplyPhase } from './campaign-supply-phase.ts'
import { applyCampaignSte } from './campaign-special-truck-extender.ts'
import type { CampaignTurnAction, CampaignTurnContext, CampaignTurnState } from './campaign-turn-state.ts'
import { emptyCampaignReplacementHoldings } from './campaign-reinforcement-state.ts'

export type CampaignMatch = MatchRecord<CampaignTurnState, CampaignTurnAction, Side>

export type CampaignMatchOpening = Pick<CampaignTurnState, 'when' | 'turn' | 'opening' | 'counters'> & Partial<
  Pick<CampaignTurnState, 'weatherHistory' | 'ferries' | 'volgaBridgeDecisions' | 'volgaBridgeRepairs' |
  'supplyDumps' | 'withdrawalSupplyDebt' | 'railGaugeByEdge' | 'trainbusting' | 'replacementHoldings'>>

/** Use a normalized board after scenario setup, or a small board for single-mechanism tests. */
export function openCampaignMatch(opening: CampaignMatchOpening, seed: number | RngState): CampaignMatch {
  const { when, turn } = opening
  const date = new Date(`${when.date}T00:00:00Z`)
  if (!Number.isSafeInteger(turn) || turn < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(when.date) ||
    !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== when.date) {
    throw new Error('Invalid campaign turn or date')
  }
  const prescribed = when.scenarioId === kirovogradScenario && turn === 1 ? kirovogradOpening : opening.opening
  const rng = typeof seed === 'number' ? createRngState(seed) : { ...seed }
  if (!verifyRngState(rng)) throw new Error('Invalid opening random state')
  return { revision: 0, receipts: [], state: { ...opening, opening: prescribed, cursor: { phase: 'pre-turn', segment: 'weather' },
    rng, weather: null, weatherHistory: { ...(opening.weatherHistory ?? initialWeatherHistory) },
    preTurnRolls: [], breakoutRolls: [], ferries: opening.ferries ?? [], supplyDumps: opening.supplyDumps ?? { axis: {}, soviet: {} },
    withdrawalSupplyDebt: opening.withdrawalSupplyDebt ?? { axis: 0, soviet: 0 },
    replacementHoldings: opening.replacementHoldings ?? emptyCampaignReplacementHoldings() } }
}

export function submitCampaignMatch(record: Readonly<CampaignMatch>, actor: Side,
  command: Readonly<Command<CampaignTurnAction>>, context: CampaignTurnContext) {
  return acceptCommand(record, actor, command, (state, side, action) => applyCampaignTurn(state, side, action, context))
}

export function applyCampaignTurn(state: Readonly<CampaignTurnState>, actor: Side,
  action: CampaignTurnAction, context: CampaignTurnContext): CampaignTurnState {
  if (action.type === 'resolve-campaign-bridge-demolition' || action.type === 'resume-campaign-ground-march') {
    return applyCampaignMarchResponse(state, actor, action, context.groundMovement)
  }
  if (action.type === 'set-campaign-front-posture') return applyCampaignFrontPosture(state, actor, action)
  if (state.groundMovement?.interruption) throw new Error('Campaign ground movement awaits a response')
  // OCS 20.0d：段末/阶段末先结清强制吸收义务；未结清则开吸收窗阻塞推进。
  if ((action.type === 'complete-campaign-ground-movement' || action.type === 'complete-campaign-late-segment' ||
    action.type === 'complete-campaign-exploitation' || action.type === 'complete-campaign-movement-phase') && context.breakdown &&
    campaignBreakdownAbsorbObligations(state, actor, context.breakdown).length) {
    return { ...state, breakdownAbsorb: { side: actor } }
  }
  switch (action.type) {
    case 'determine-campaign-weather':
    case 'roll-campaign-event':
    case 'roll-campaign-initiative':
    case 'choose-campaign-first':
      return applyCampaignPreTurn(state, actor, action, context.thawTiming)
    case 'attempt-campaign-breakout':
    case 'complete-campaign-breakout':
      return applyCampaignBreakout(state, actor, action, context.breakoutBoard)
    case 'move-campaign-ground':
    case 'hold-campaign-ground-zoc':
      return applyCampaignGroundMovement(state, actor, action, context.groundMovement)
    case 'complete-campaign-ground-movement':
      return { ...applyCampaignGroundMovement(state, actor, action, context.groundMovement), breakdownAbsorb: null }
    case 'use-campaign-kherson-ferry':
      return applyCampaignKhersonFerry(state, actor, action, context.groundMovement)
    case 'transport-campaign-rail': {
      const settled = applyCampaignRailTransport(state, actor, action, context.railTransport, context.groundMovement)
      // Rail passengers occupy only their destination; a German unit detraining within range still releases the corps.
      const to = action.path.at(-1)
      const movers = action.counterIds.map((id) => ({ id, combat: settled.counters[id]?.kind !== 'transport', stepsLeft: 1 }))
      return releaseCampaignCounters(settled, context.groundMovement?.releases?.(settled, actor, { path: to ? [to] : [], movers }) ?? [])
    }
    case 'deploy-campaign-ste':
    case 'withdraw-campaign-ste':
      return applyCampaignSte(state, actor, action, context.groundMovement?.map, context.stePlacement)
    case 'deploy-campaign-ferry':
    case 'remove-campaign-ferry':
    case 'repair-campaign-volga-bridge':
    case 'cancel-campaign-volga-repair':
      return applyCampaignPontoonAction(state, actor, action, context.groundMovement)
    case 'complete-campaign-movement-phase': {
      const { cursor } = state
      if (cursor.phase !== 'movement' || cursor.phasing !== actor || state.movementSegment !== 'barrage') {
        throw new Error('Campaign Movement Phase cannot end before the phasing side resolves barrage')
      }
      const blockers = context.movementBarrageBlockers?.(state, actor)
      if (!blockers) throw new Error('Campaign movement barrage rules are not configured')
      if (blockers.length) throw new Error('Campaign movement barrage obligations are outstanding')
      const settled = closeCampaignPontoonPhase(state, actor, context.groundMovement)
      return { ...resetCampaignCombatLedgers(settled), cursor: advancePlayerTurn(cursor, actor)!, movementSegment: undefined, khersonFerryPhase: undefined, supplyPhase: undefined, breakdownAbsorb: null }
    }
    case 'consolidate-campaign-aircraft':
      return consolidateCampaignAircraft(state, actor, action, context)
    case 'refit-campaign-aircraft':
      return refitCampaignAircraft(state, actor, action, context)
    case 'complete-campaign-exploitation':
      return { ...completeCampaignExploitation(state, actor, context), breakdownAbsorb: null }
    case 'recover-campaign-stocks':
    case 'complete-campaign-stock-recovery':
    case 'choose-campaign-formation-trace':
    case 'feed-campaign-units':
    case 'check-campaign-attrition':
    case 'assign-campaign-attrition':
    case 'complete-campaign-supply':
      return applyCampaignSupplyPhase(state, actor, action, context)
    case 'complete-campaign-late-segment':
      return { ...completeCampaignLateSegment(state, actor, action, context), breakdownAbsorb: null }
    case 'declare-campaign-barrage':
    case 'choose-campaign-barrage-terrain':
    case 'assign-campaign-barrage-loss':
      return applyCampaignBarrage(state, actor, action, context.barrage)
    case 'declare-campaign-combat':
    case 'declare-campaign-overrun':
    case 'defend-campaign-combat':
    case 'select-campaign-combat-rating':
    case 'choose-campaign-combat-terrain':
    case 'resolve-campaign-combat':
    case 'advance-campaign-combat':
      return applyCampaignCombat(state, actor, action, context.combat)
    case 'detach-campaign-breakdown':
    case 'absorb-campaign-breakdown':
      return applyCampaignBreakdown(state, actor, action, context.breakdown)
    case 'complete-campaign-cleanup':
      return completeCampaignCleanup(state, actor, context)
    case 'complete-campaign-refit': {
      const { cursor } = state
      if (cursor.phase !== 'aircraft-refit') throw new Error('Campaign refit is not open in this campaign player turn')
      if (cursor.phasing !== actor) throw new Error('Only the active side can complete campaign refit')
      return { ...state, cursor: advancePlayerTurn(cursor, actor)!, reinforcement: { stage: 'opening' }, refittedBases: undefined }
    }
    default:
      return applyCampaignReinforcementPhase(state, actor, action, context)
  }
}

/** TTW §3.3c/d/e：姿态指定（进攻＝增援阶段开始、regrouping＝阶段末；最多 2 进攻；3/9 回合计时）。 */
function applyCampaignFrontPosture(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignTurnAction, { type: 'set-campaign-front-posture' }>): CampaignTurnState {
  const cursor = state.cursor
  if (!('phase' in cursor) || cursor.phase !== 'reinforcement' || cursor.phasing !== 'soviet' || actor !== 'soviet') {
    throw new Error('Front posture changes only during the Soviet reinforcement phase')
  }
  const fronts = state.frontPostures ?? {}
  const current = fronts[action.front]
  if (action.mode === 'offensive') {
    if (action.window !== 'start') throw new Error('Offensive posture is designated at the start of the reinforcement phase')
    if (!canAddOffensive(fronts, action.front, state.turn)) {
      throw new Error('This front cannot be designated offensive (two-front limit, eligibility or already offensive)')
    }
  } else {
    if (action.window !== 'end') throw new Error('Regrouping posture is designated at the end of the reinforcement phase')
    if (!canDesignateRegrouping(current, state.turn)) throw new Error('This front cannot yet switch to regrouping')
  }
  return { ...state, frontPostures: { ...fronts, [action.front]: { mode: action.mode, sinceTurn: state.turn } } }
}

/** §3.3e：进攻满 9 回合必须转 regrouping 的方面军清单（增援阶段末义务预检用）。 */
export function campaignMustLeaveOffensiveFronts(state: Readonly<CampaignTurnState>): readonly string[] {
  return Object.entries(state.frontPostures ?? {}).filter(([, f]) => mustLeaveOffensive(f, state.turn)).map(([front]) => front)
}
