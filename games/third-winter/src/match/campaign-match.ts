import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import { createRngState, verifyRngState } from '@ocs-eastern/series/rng'
import type { RngState, Side } from '@ocs-eastern/series/state-types'
import { advancePlayerTurn } from '@ocs-eastern/series/turn'
import { initialWeatherHistory } from '../ttw/campaign/weather.ts'
import { canAddOffensive, canDesignateRegrouping, mustLeaveOffensive, mayUseBarrageMarker, turnsInPosture } from '../ttw/front-posture.ts'
import { buyCampaignFuel, fuelCampaignUnit } from './campaign-fuel.ts'
import { applyForceExitCampaignRvgk, enterCampaignRvgk, releaseCampaignRvgk } from './campaign-rvgk.ts'
import { createCampaignKg, dissolveCampaignKg, rollCampaignKgReaction, placeCampaignKg2T } from './campaign-kg.ts'
import { applyCampaignLuftflotteAirlift } from './campaign-luftflotte.ts'
import { applyCampaignKesselFreeMove } from './campaign-kessel.ts'
import { moveCampaignLuftflotte } from './campaign-luftflotte-placement.ts'
import { moveCampaignRvgkMarker } from './campaign-rvgk-marker.ts'
import { applyCampaignArmyGroupDrm, applyCampaignArmyGroupSp, applyCampaignHqSupplyCarry } from './campaign-axis-hq.ts'
import { workCampaignHedgehog } from './campaign-hedgehogs.ts'
import { settleCampaignStacking } from './campaign-stacking.ts'
import { declareCampaignFortress } from './campaign-fortress.ts'
import { workCampaignAirfield } from './campaign-airfield.ts'
import { collapseCampaignExtender, convertCampaignExtender, flipCampaignExtender } from './campaign-extender.ts'
import { settleCampaignTransportCapture } from './campaign-transport-capture.ts'
import { barrageMarkerRecoveryTurn } from '../ttw/combat-special.ts'
import { kirovogradOpening, kirovogradScenario } from '../ttw/campaign/kirovograd.ts'
import { consolidateCampaignAircraft } from './campaign-aircraft-consolidation.ts'
import { refitCampaignAircraft } from './campaign-aircraft-refit.ts'
import { applyCampaignBreakout } from './campaign-breakout.ts'
import { applyCampaignBarrage } from './campaign-barrage.ts'
import { applyCampaignAirMission, campaignAirMissionBlockers, completeCampaignAirStrike } from './campaign-air-strike.ts'
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
  'supplyDumps' | 'withdrawalSupplyDebt' | 'railGaugeByEdge' | 'initialRailheadMarkers' | 'edgeSupplySources' | 'trainbusting' | 'replacementHoldings' | 'hedgehogs' | 'hexControl' |
  'airBases' | 'fortresses' | 'rvgkMarkers'>>

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
  if (action.type === 'settle-campaign-stacking') {
    if (!context.stacking) throw new Error('Campaign stacking board is unavailable')
    return settleCampaignStacking(state, actor, action, context.stacking)
  }
  if (action.type === 'resolve-campaign-bridge-demolition' || action.type === 'resume-campaign-ground-march') {
    return applyCampaignMarchResponse(state, actor, action, context.groundMovement)
  }
  if (action.type === 'launch-campaign-air-strike' || action.type === 'resolve-campaign-air-flak' ||
    action.type === 'choose-campaign-air-flak-loss' || action.type === 'complete-campaign-air-strike') {
    return applyCampaignAirMission(state, actor, action, context.airMission)
  }
  if (action.type === 'set-campaign-front-posture') return applyCampaignFrontPosture(state, actor, action)
  if (action.type === 'spend-campaign-barrage-marker') return applyCampaignBarrageMarker(state, actor, action, context)
  if (action.type === 'fuel-campaign-formation' || action.type === 'fuel-campaign-headquarters') {
    if (!context.groundMovement) throw new Error('Campaign fuel requires a movement board')
    return buyCampaignFuel(state, actor, action, context.groundMovement.map, context.organicFormation,
      { throwRange: context.hqThrowRange, independent: context.hqFuelIndependent })
  }
  if (action.type === 'fuel-campaign-unit') {
    if (!context.groundMovement) throw new Error('Campaign fuel requires a movement board')
    return fuelCampaignUnit(state, actor, action, context.groundMovement.map)
  }
  if (action.type === 'enter-campaign-rvgk') {
    if (!context.groundMovement) throw new Error('Campaign RVGK requires a movement board')
    return enterCampaignRvgk(state, actor, action, context.groundMovement.map, context.rvgkStratReachable ?? (() => false))
  }
  if (action.type === 'release-campaign-rvgk') {
    if (!context.groundMovement) throw new Error('Campaign RVGK requires a movement board')
    const facts = context.rvgkReleaseFacts?.(state, action.counterId)
    if (!facts) throw new Error('RVGK release facts are unavailable')
    return releaseCampaignRvgk(state, actor, action, context.groundMovement.map, facts)
  }
  if (action.type === 'force-exit-campaign-rvgk') {
    if (!context.groundMovement || !context.rvgkAxisCombatUnit) throw new Error('Campaign RVGK forced exit requires a movement board and combat-unit facts')
    return applyForceExitCampaignRvgk(state, actor, action, context.groundMovement.map, context.rvgkAxisCombatUnit)
  }
  if (action.type === 'create-campaign-kg') {
    if (!context.groundMovement) throw new Error('Campaign KG requires a movement board')
    return createCampaignKg(state, actor, action, context.groundMovement.map, context.kgEligible ?? (() => false))
  }
  if (action.type === 'dissolve-campaign-kg') return dissolveCampaignKg(state, actor, action)
  if (action.type === 'roll-campaign-kg-reaction') return rollCampaignKgReaction(state, actor)
  if (action.type === 'place-campaign-kg-2t') {
    if (!context.kgMovedOrAttacked) throw new Error('KG reaction movement/attack facts are unavailable')
    return placeCampaignKg2T(state, actor, action, context.kgMovedOrAttacked(state, action.id))
  }
  if (action.type === 'airlift-campaign-luftflotte') {
    if (!context.groundMovement) throw new Error('Campaign Luftflotte airlift requires a movement board')
    if (!context.luftflotteFacts) throw new Error('Luftflotte airlift facts are unavailable')
    return applyCampaignLuftflotteAirlift(state, actor, action, context.groundMovement.map, context.luftflotteFacts)
  }
  if (action.type === 'kessel-campaign-free-move') {
    if (!context.groundMovement || !context.kesselBoard) throw new Error('Campaign Kessel free move requires a movement board and Kessel facts')
    return applyCampaignKesselFreeMove(state, actor, action, context.groundMovement.map, context.kesselBoard)
  }
  if (action.type === 'move-campaign-luftflotte') return moveCampaignLuftflotte(state, actor, action, context.luftflottePlacement)
  if (action.type === 'move-campaign-rvgk-marker') return moveCampaignRvgkMarker(state, actor, action, context.rvgkMarker)
  if (action.type === 'army-group-place-sp') {
    if (!context.groundMovement || !context.axisHqFacts) throw new Error('Campaign Army Group SP placement requires a movement board and HQ facts')
    return applyCampaignArmyGroupSp(state, actor, action, context.groundMovement.map, context.axisHqFacts)
  }
  if (action.type === 'declare-campaign-army-group-drm') {
    if (!context.groundMovement || !context.axisHqFacts) throw new Error('Campaign Army Group DRM requires a movement board and HQ facts')
    return applyCampaignArmyGroupDrm(state, actor, action, context.groundMovement.map, context.axisHqFacts)
  }
  if (action.type === 'load-campaign-hq-supply' || action.type === 'unload-campaign-hq-supply') {
    if (!context.groundMovement || !context.axisHqFacts) throw new Error('Campaign Army Group supply carry requires a movement board and HQ facts')
    return applyCampaignHqSupplyCarry(state, actor, action, context.groundMovement.map, context.axisHqFacts)
  }
  if (action.type === 'work-campaign-hedgehog') {
    if (!context.hedgehogWork) throw new Error('Campaign hedgehog work requires a hedgehog board')
    return workCampaignHedgehog(state, actor, action, context.hedgehogWork)
  }
  if (action.type === 'declare-campaign-fortress') {
    if (!context.fortressBoard) throw new Error('Campaign fortress declaration requires a fortress board')
    return declareCampaignFortress(state, actor, action, context.fortressBoard)
  }
  if (action.type === 'work-campaign-airfield') {
    if (!context.airfieldWork) throw new Error('Campaign airfield work requires an airfield board')
    return workCampaignAirfield(state, actor, action, context.airfieldWork)
  }
  if (action.type === 'resolve-campaign-transport-capture') {
    if (!state.transportCapture) throw new Error('There is no pending transport capture')
    if (!context.transportCapture) throw new Error('Campaign transport capture requires a transport board')
    return settleCampaignTransportCapture(state, state.transportCapture, action.choices, context.transportCapture)
  }
  if (action.type === 'convert-campaign-extender' || action.type === 'flip-campaign-extender' ||
    action.type === 'collapse-campaign-extender') {
    if (!context.extenderWork) throw new Error('Campaign extender work requires an extender board')
    if (action.type === 'convert-campaign-extender') return convertCampaignExtender(state, actor, action, context.extenderWork)
    if (action.type === 'flip-campaign-extender') return flipCampaignExtender(state, actor, action, context.extenderWork)
    return collapseCampaignExtender(state, actor, action, context.extenderWork)
  }
  if (state.groundMovement?.interruption) throw new Error('Campaign ground movement awaits a response')
  // OCS 20.0d：段末/阶段末先结清强制吸收义务；未结清则开吸收窗阻塞推进。
  if ((action.type === 'complete-campaign-ground-movement' || action.type === 'complete-campaign-late-segment' ||
    action.type === 'complete-campaign-exploitation' || action.type === 'complete-campaign-movement-phase') &&
    campaignAirMissionBlockers(state).length) {
    throw new Error('Resolve the current air strike before ending the segment')
  }
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
    case 'release-campaign-reserve':
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
    case 'assign-campaign-barrage-loss': {
      const settled = applyCampaignBarrage(state, actor, action, context.barrage)
      return settled.airMission && !settled.barrage
        ? completeCampaignAirStrike(settled, settled.airMission.side, context.airMission) : settled
    }
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

/** UI 只读投影：各 Front 姿态/计时/可切换/必须离开/弹幕标记状态，供姿态面板渲染（不替代指定入口）。 */
export function campaignFrontPostureOptions(state: Readonly<CampaignTurnState>) {
  const fronts = state.frontPostures ?? {}
  return Object.entries(fronts).map(([front, f]) => ({
    front, mode: f.mode, sinceTurn: f.sinceTurn, turnsInPosture: turnsInPosture(f, state.turn),
    mayGoOffensive: canAddOffensive(fronts, front, state.turn),
    mayGoRegrouping: canDesignateRegrouping(f, state.turn),
    mustLeaveOffensive: mustLeaveOffensive(f, state.turn),
    mayUseBarrageMarker: mayUseBarrageMarker(f),
    barrageMarkerReady: campaignBarrageMarkerReady(state, front),
  }))
}

/** §3.4b：弹幕标记是否 Ready（turn≥恢复回合；缺省初始 Ready）。 */
export function campaignBarrageMarkerReady(state: Readonly<CampaignTurnState>, front: string): boolean {
  return state.turn >= (state.frontBarrageMarkers?.[front]?.readyTurn ?? 0)
}

/** §3.4a：空/海军炮击环节花费弹幕标记（进攻姿态＋Ready）；用后入轨 9 回合（§3.4b）。 */
function applyCampaignBarrageMarker(state: Readonly<CampaignTurnState>, actor: Side,
  action: Extract<CampaignTurnAction, { type: 'spend-campaign-barrage-marker' }>, context: CampaignTurnContext): CampaignTurnState {
  const cursor = state.cursor
  if (!('phasing' in cursor) || cursor.phase !== 'movement' || state.movementSegment !== 'barrage' ||
    cursor.phasing !== 'soviet' || actor !== 'soviet') {
    throw new Error('Barrage markers are spent only in the Soviet air/naval barrage segment')
  }
  if (!mayUseBarrageMarker(state.frontPostures?.[action.front])) {
    throw new Error('Only a front in offensive posture may use its barrage marker')
  }
  if (!campaignBarrageMarkerReady(state, action.front)) throw new Error('This barrage marker is not ready')
  if (context.barrageMarkerTarget && !context.barrageMarkerTarget(state, action.front, action.targetHex)) {
    throw new Error('The barrage marker target must be adjacent to a Soviet combat unit and within an assigned HQ throw range')
  }
  return { ...state, frontBarrageMarkers: { ...state.frontBarrageMarkers,
    [action.front]: { readyTurn: barrageMarkerRecoveryTurn(state.turn) } } }
}
