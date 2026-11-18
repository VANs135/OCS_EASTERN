import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import { pickIndex, rollDie } from '@ocs-eastern/series/rng'
import type { RngState, Side } from '@ocs-eastern/series/state-types'
import type { BarrageTable } from '@ocs-eastern/series/tables/barrage'
import type { TrainbustingMarker } from '@ocs-eastern/series/trainbusting'
import { deployScorpionGroundCounter } from '../import/scorpion-deployment.ts'
import type { DeployedCounter } from '../import/scorpion-deployment.ts'
import { advanceScorpionBarrageRecovery } from '../ttw/scorpion/barrage-markers.ts'
import type { ScorpionBarrageRecovery } from '../ttw/scorpion/barrage-markers.ts'
import { openScorpionTurn } from '../ttw/scorpion/pre-turn.ts'
import type { ScorpionTurn } from '../ttw/scorpion/pre-turn.ts'
import { scorpionOpeningAirBases } from '../ttw/scorpion/setup-stores.ts'
import { scorpionWeather } from '../ttw/scorpion/weather.ts'
import { assignScorpionAttrition, checkScorpionAttrition } from './scorpion-attrition.ts'
import type { AssignAttrition } from './scorpion-attrition.ts'
import { finishScorpionAirBarrage, launchScorpionAirMission, respondScorpionAirMission } from './scorpion-air-operations.ts'
import type { LaunchAirMission, RespondAirMission, ScorpionAirMission, ScorpionAirReport } from './scorpion-air-operations.ts'
import { settleScorpionAirfieldCapacity } from './scorpion-airfield-barrage.ts'
import type { AirfieldCapacityChoice } from './scorpion-airfield-barrage.ts'
import { applyScorpionBarrage } from './scorpion-barrage.ts'
import type { BarrageAction, ScorpionBarrage, ScorpionBarrageRecord, ScorpionFrontBarrage } from './scorpion-barrage.ts'
import { scorpionRegularBarrageTargets } from './scorpion-barrage-timing.ts'
import type { ScorpionBoxPiece } from './scorpion-box-pieces.ts'
import { settleScorpionCapture } from './scorpion-capture.ts'
import type { ScorpionCaptureReport, ScorpionCaptureWindow, SettleScorpionCapture } from './scorpion-capture.ts'
import { chooseScorpionCombatTerrain, declareScorpionCombat, defendScorpionCombat, selectScorpionCombatRating } from './scorpion-combat.ts'
import type { ChooseCombatTerrain, DeclareCombat, DefendCombat, ScorpionCombat, ScorpionCombatBoard } from './scorpion-combat.ts'
import { advanceScorpionCombat, continueScorpionRetreatResult, resolveScorpionCombat } from './scorpion-combat-result.ts'
import type { ContinueCombatRetreat } from './scorpion-retreat.ts'
import type { ResolveCombat } from './scorpion-combat-result.ts'
import { applyScorpionDropPlan } from './scorpion-drop-plan.ts'
import type { ScorpionDropPlan, ScorpionDropPlanAction } from './scorpion-drop-plan.ts'
import { recordScorpionGroundControl, scorpionControlLookup } from './scorpion-hex-control.ts'
import { scorpionOpeningFrontControl } from '../ttw/scorpion/initial-map.ts'
import { applyScorpionGroundAction } from './scorpion-ground-actions.ts'
import type { ScorpionGroundAction } from './scorpion-ground-actions.ts'
import type { ScorpionGroundActivity } from './scorpion-ground-activity.ts'
import type { MovementBoard } from './scorpion-movement.ts'
import { continueScorpionOverrunMove, declareScorpionOverrun } from './scorpion-overrun.ts'
import type { DeclareOverrun, FinishOverrunMove, ScorpionOverrunMarch } from './scorpion-overrun.ts'
import { advanceScorpionPhase, startScorpionPlayerTurns } from './scorpion-player-turn.ts'
import { applyScorpionPhaseFlow } from './scorpion-phase-flow.ts'
import type { ScorpionPhaseAction } from './scorpion-phase-flow.ts'
import { withScorpionPhaseOccupancy } from './scorpion-phase-occupancy.ts'
import type { ScorpionPhaseOccupancy } from './scorpion-phase-occupancy.ts'
import { buyScorpionFuel } from './scorpion-fuel.ts'
import type { FormationFuel, HeadquartersFuel, ScorpionFuelAction } from './scorpion-fuel.ts'
import { handleScorpionTransport } from './scorpion-transport-load.ts'
import type { ScorpionTransportLoad } from './scorpion-transport-load.ts'
import { changeScorpionExtender } from './scorpion-extender.ts'
import type { ScorpionExtenderCommand } from './scorpion-extender.ts'
import { repackScorpionTransport } from './scorpion-transport-points.ts'
import type { RepackTransport } from './scorpion-transport-points.ts'
import { applyScorpionReinforcement } from './scorpion-reinforcement.ts'
import { refitScorpionAircraft } from './scorpion-refit.ts'
import type { RefitScorpionAircraft } from './scorpion-refit.ts'
import type { ReinforcementCommand } from './scorpion-reinforcement.ts'
import type { ReinforcementBoard, ReinforcementState } from './scorpion-reinforcement-state.ts'
import { applyScorpionReserve, assertScorpionMovementEnd } from './scorpion-reserves.ts'
import type { ScorpionReserveAction } from './scorpion-reserves.ts'
import { applyScorpionSetup, createScorpionSetup } from './scorpion-setup.ts'
import type { ScorpionSetup, ScorpionSetupAction, ScorpionSetupAssets, ScorpionSetupData } from './scorpion-setup.ts'
import { recoverScorpionStocks, settleScorpionStockRecovery } from './scorpion-stock-recovery.ts'
import type { RecoverInternalStocks } from './scorpion-stock-recovery.ts'
import { feedScorpionUnits, openScorpionSupply, selectTraceAnchor } from './scorpion-supply-phase.ts'
import type { FeedUnits, ScorpionSupplyWindow } from './scorpion-supply-phase.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

export interface ScorpionInPlay extends ReinforcementState {
  kind: 'playing'
  turn: ScorpionTurn
  rng: RngState
  rerollHolder: Side | null
  airBases: readonly { hex: string; side: Side; level: number }[]
  refittedAirbases?: readonly string[]
  airfieldCapacityChoice?: AirfieldCapacityChoice | null
  airMission?: ScorpionAirMission | null
  airHistory?: readonly ScorpionAirReport[]
  dropPlan?: ScorpionDropPlan | null
  phaseOccupancy?: ScorpionPhaseOccupancy
  dropTrace?: { unitId: string; turn: number }
  trainbusting?: readonly TrainbustingMarker[]
  units: Readonly<Record<string, DeployedCounter>>
  pieces: readonly ScorpionBoxPiece[]
  moved: readonly string[]
  groundActivity?: ScorpionGroundActivity
  nextTransportSerial?: number
  formationFuel?: readonly FormationFuel[]
  headquartersFuel?: readonly HeadquartersFuel[]
  supply: ScorpionSupplyWindow | null
  /** Saved control of all ground hexes. The original field name is retained for save compatibility. */
  railControl: Readonly<Record<string, Side>>
  combat: ScorpionCombat | null
  capture?: ScorpionCaptureWindow | null
  captureHistory?: readonly ScorpionCaptureReport[]
  groundCaptureMove?: Readonly<Record<string, number>> | null
  overrunMarch?: ScorpionOverrunMarch | null
  barrage?: ScorpionBarrage | null
  barrageHistory?: readonly ScorpionBarrageRecord[]
  frontBarrage?: ScorpionFrontBarrage | null
  barrageRecovery?: ScorpionBarrageRecovery
  combatTargets: readonly string[]
  combatAttackers: readonly string[]
}

export type ScorpionSession = { kind: 'setup'; opening: ScorpionSetup } | ScorpionInPlay
export type ScorpionAction = ScorpionSetupAction | ReinforcementCommand | ScorpionGroundAction
  | { type: 'complete-movement' } | { type: 'choose-formation-trace'; formation: string; anchor: string }
  | FeedUnits | RecoverInternalStocks | { type: 'check-attrition' } | AssignAttrition | { type: 'complete-supply' }
  | ScorpionPhaseAction | ScorpionReserveAction | BarrageAction | DeclareCombat | DefendCombat | ChooseCombatTerrain | ResolveCombat
  | ContinueCombatRetreat
  | DeclareOverrun | FinishOverrunMove | SettleScorpionCapture | RefitScorpionAircraft | LaunchAirMission | RespondAirMission
  | ScorpionDropPlanAction | ScorpionFuelAction | ScorpionTransportLoad | ScorpionExtenderCommand | RepackTransport
  | { type: 'settle-airfield-capacity'; unitIds: readonly string[] }
  | { type: 'select-combat-rating'; unitId: string } | { type: 'advance-after-combat'; unitIds: readonly string[] }
export type ScorpionSessionRecord = MatchRecord<ScorpionSession, ScorpionAction, Side>
interface BoardPolicies {
  reinforcements?: (state: Readonly<ScorpionInPlay>) => ReinforcementBoard
  movement?: (state: Readonly<ScorpionInPlay>) => Omit<MovementBoard, 'map' | 'weather' | 'trainbustingAt'>
  supplyRail?: SupplyRailBoard
  combat?: ScorpionCombatBoard
  barrage?: BarrageTable
  facilityBarrage?: BarrageTable
}

export function createScorpionSession(data: ScorpionSetupData, assets: ScorpionSetupAssets, seed: number): ScorpionSessionRecord {
  return { state: { kind: 'setup', opening: createScorpionSetup(data, assets, seed) }, revision: 0, receipts: [] }
}

export function submitScorpionSession(
  record: Readonly<ScorpionSessionRecord>, seat: Side, command: Readonly<Command<ScorpionAction>>,
  assets: ScorpionSetupAssets, board: BoardPolicies = {},
) {
  const airBoard = { barrage: board.barrage, facilityBarrage: board.facilityBarrage,
    hedgehogAt: board.combat?.hedgehogAt, supplyRail: board.supplyRail }
  function applyAction(state: ScorpionSession, actor: Side, action: ScorpionAction): ScorpionSession {
    if (state.kind === 'playing' && (state.victory || state.turn.step.kind === 'ended')) {
      throw new Error('The Scorpion match has ended')
    }
    if (state.kind === 'playing' && state.capture && action.type !== 'settle-capture') {
      throw new Error('Resolve the pending special capture first')
    }
    if (state.kind === 'playing' && state.combat?.retreat && action.type !== 'continue-combat-retreat' && action.type !== 'settle-capture') {
      throw new Error('Complete the pending combat retreat first')
    }
    switch (action.type) {
      case 'respond-interception':
      case 'choose-air-aborts':
      case 'choose-air-combat-unit':
      case 'choose-flak-loss':
      case 'choose-airlift-cargo':
      case 'choose-airdrop-cargo':
      case 'choose-airlift-landing':
      case 'return-aircraft':
        if (state.kind !== 'playing') throw new Error('There is no pending air mission')
        return respondScorpionAirMission(state, actor, action, assets, airBoard)
    }
    if (state.kind === 'playing' && state.airMission && action.type !== 'settle-capture' &&
      !(state.airMission.step.kind === 'barrage' && (action.type === 'choose-barrage-terrain' || action.type === 'assign-barrage-loss'))) {
      throw new Error('Resolve the pending air mission first')
    }
    if (state.kind === 'playing' && state.barrage && action.type !== 'choose-barrage-terrain' && action.type !== 'assign-barrage-loss') {
      throw new Error('Resolve the pending barrage first')
    }
    if (state.kind === 'playing' && state.airfieldCapacityChoice && action.type !== 'settle-airfield-capacity') {
      throw new Error('Resolve the air base’s active aircraft capacity first')
    }
    switch (action.type) {
      case 'plan-air-drop':
      case 'delay-air-drop':
      case 'cancel-air-drop':
        return applyScorpionDropPlan(state, actor, action, assets)
      case 'base-aircraft':
      case 'place-setup-alert':
      case 'choose-setup-loss':
      case 'confirm-setup': {
        if (state.kind !== 'setup') throw new Error('Scorpion deployment is closed')
        const opening = applyScorpionSetup(state.opening, actor, action, assets)
        return opening ? { kind: 'setup', opening } : startMatch(state.opening, assets.map)
      }
      case 'complete-reaction':
      case 'complete-combat':
      case 'complete-exploitation':
      case 'complete-cleanup':
      case 'retain-initiative':
      case 'roll-initiative':
      case 'choose-first':
        if (state.kind !== 'playing') throw new Error('Start the Scorpion match first')
        if (action.type === 'complete-reaction' || action.type === 'complete-exploitation') {
          assertScorpionMovementEnd(state, actor, board.combat?.hedgehogAt)
        }
        return applyScorpionPhaseFlow(state, actor, action, assets.map)
      case 'mark-reserve':
      case 'leave-reserve':
      case 'release-reserve':
        if (state.kind !== 'playing' || state.combat || state.turn.step.kind !== 'player-turn') {
          throw new Error('Reserve action is unavailable')
        }
        if (scorpionRegularBarrageTargets(state).size) throw new Error('The Movement Segment has ended')
        return applyScorpionReserve({ ...state, overrunMarch: null, groundCaptureMove: null }, actor, action, assets)
      case 'settle-airfield-capacity':
        if (state.kind !== 'playing') throw new Error('There is no active air base capacity decision')
        return settleScorpionAirfieldCapacity(state, actor, action.unitIds)
      case 'settle-capture':
        if (state.kind !== 'playing') throw new Error('There is no special capture to settle')
        return settleScorpionCapture(state, actor, action, assets)
      case 'continue-combat-retreat':
        if (state.kind !== 'playing') throw new Error('There is no combat retreat to continue')
        return continueScorpionRetreatResult(state, actor, action, assets, board.supplyRail)
      case 'refit-aircraft':
        if (state.kind !== 'playing') throw new Error('Start the Scorpion match first')
        return refitScorpionAircraft(state, actor, action, assets.map, board.supplyRail)
      case 'launch-air-mission':
        if (state.kind !== 'playing') throw new Error('Start the Scorpion match first')
        return launchScorpionAirMission(state, actor, action, assets, airBoard)
      case 'declare-artillery-barrage':
      case 'declare-front-barrage':
      case 'choose-barrage-terrain':
      case 'assign-barrage-loss': {
        const table = action.type === 'declare-artillery-barrage' && action.targetKind === 'air-base'
          ? board.facilityBarrage : board.barrage
        if (state.kind !== 'playing' || state.turn.step.kind !== 'player-turn' || !table) {
          throw new Error('Barrage requires an active player turn and the appropriate OCS v4.3 barrage table')
        }
        return finishScorpionAirBarrage(applyScorpionBarrage(state, actor, action, assets, table, board.combat?.hedgehogAt, board.supplyRail))
      }
      case 'declare-combat':
      case 'declare-overrun':
      case 'defend-combat':
      case 'select-combat-rating':
      case 'choose-combat-terrain':
      case 'resolve-combat':
      case 'advance-after-combat':
        if (state.kind !== 'playing' || state.turn.step.kind !== 'player-turn' || !board.combat) {
          throw new Error('Combat requires an active player turn and the OCS v4.3 table')
        }
        if (action.type === 'declare-combat') return declareScorpionCombat(state, actor, action, assets.map, board.combat, board.supplyRail)
        if (action.type === 'declare-overrun') return declareScorpionOverrun(state, actor, action, assets, board, board.combat)
        if (action.type === 'defend-combat') return defendScorpionCombat(state, actor, action, assets.map, board.supplyRail)
        if (action.type === 'select-combat-rating') return selectScorpionCombatRating(state, actor, action.unitId)
        if (action.type === 'choose-combat-terrain') return chooseScorpionCombatTerrain(state, actor, action, assets.map, board.combat.table)
        if (action.type === 'resolve-combat') return resolveScorpionCombat(state, actor, action, assets, board.supplyRail)
        return advanceScorpionCombat(state, actor, action.unitIds, assets, board.supplyRail)
      case 'continue-overrun-move':
        if (state.kind !== 'playing' || state.turn.step.kind !== 'player-turn') throw new Error('Overrun movement is unavailable')
        return continueScorpionOverrunMove(state, actor, action, assets, board)
      case 'ground-move':
      case 'reserve-stack-move':
        if (state.kind !== 'playing' || state.combat || state.turn.step.kind !== 'player-turn' ||
          state.cursor.phase === 'exploitation' && state.combatTargets?.length) throw new Error('Scorpion movement is unavailable')
        if (scorpionRegularBarrageTargets(state).size) throw new Error('The Movement Segment has ended')
        return applyScorpionGroundAction({ ...state, overrunMarch: null }, actor, action, assets, board)
      case 'fuel-formation':
      case 'fuel-headquarters':
      case 'fuel-from-paused-transport':
        if (state.kind !== 'playing') throw new Error('Start the Scorpion match first')
        return buyScorpionFuel(state, actor, action, assets.map, board.supplyRail)
      case 'load-transport':
      case 'unload-transport':
        if (state.kind !== 'playing') throw new Error('Start the Scorpion match first')
        return handleScorpionTransport(state, actor, action, assets)
      case 'repack-transport':
        if (state.kind !== 'playing') throw new Error('Start the Scorpion match first')
        return repackScorpionTransport(state, actor, action, assets)
      case 'form-extender':
      case 'dismantle-extender':
      case 'collapse-extender':
        if (state.kind !== 'playing') throw new Error('Start the Scorpion match first')
        return changeScorpionExtender(state, actor, action, assets, board.supplyRail)
      case 'complete-movement':
        if (state.kind !== 'playing' || state.combat || state.turn.step.kind !== 'player-turn') throw new Error('Scorpion supply is unavailable')
        assertScorpionMovementEnd(state, actor, board.combat?.hedgehogAt)
        return openScorpionSupply({ ...state, overrunMarch: null, groundCaptureMove: null }, actor, assets.map, board.supplyRail)
      case 'choose-formation-trace':
      case 'recover-internal-stocks':
      case 'feed-units':
      case 'check-attrition':
      case 'assign-attrition':
      case 'complete-supply': {
        if (state.kind !== 'playing' || state.victory || state.cursor.phase !== 'supply' ||
          actor !== state.cursor.phasing || !state.supply) throw new Error('Scorpion supply is unavailable')
        const window = state.supply
        if (action.type === 'choose-formation-trace') return selectTraceAnchor(state, window, action.formation, action.anchor)
        if (action.type === 'recover-internal-stocks') return recoverScorpionStocks(state, action, assets.map, board.supplyRail)
        if (action.type === 'feed-units' || action.type === 'check-attrition') {
          const recovered = settleScorpionStockRecovery(state, assets.map, board.supplyRail)
          return action.type === 'feed-units' ? feedScorpionUnits(recovered, window, action, assets.map, board.supplyRail)
            : checkScorpionAttrition(recovered, window)
        }
        if (action.type === 'assign-attrition') return assignScorpionAttrition(state, window, action, assets)
        if (!window.attrition || window.attrition.some((item) => !item.assigned)) throw new Error('Resolve attrition before leaving supply')
        const cursor = advanceScorpionPhase(state.cursor, actor)
        if (!cursor || cursor.phase !== 'reaction') throw new Error('Invalid supply phase completion')
        return { ...state, cursor, supply: null }
      }
      default:
        if (state.kind !== 'playing' || state.turn.step.kind !== 'player-turn' || !board.reinforcements) {
          throw new Error('Scorpion reinforcements are unavailable')
        }
        return resolveReinforcements(state, actor, action, assets, board.reinforcements(state))
    }
  }
  return acceptCommand(record, seat, command, (state, actor, action) => {
    const next = applyAction(state, actor, action)
    // OCS 6.1g, 13.2a. Only handling and fueling can interrupt this same transport's move.
    const keepTransport = action.type === 'ground-move' || action.type === 'load-transport' || action.type === 'unload-transport' ||
      action.type === 'fuel-formation' || action.type === 'fuel-headquarters' || action.type === 'fuel-from-paused-transport' ||
      action.type === 'repack-transport'
    const settled: ScorpionSession = next.kind === 'playing' && next.groundActivity?.transport && !keepTransport
      ? { ...next, groundActivity: { ...next.groundActivity, transport: undefined } } : next
    return withScorpionPhaseOccupancy(state, settled)
  })
}

export function scorpionFirstTurn(): ScorpionTurn {
  const weather = scorpionWeather(1, false, () => { throw new Error('Scorpion opening weather is fixed') })
  return openScorpionTurn(1, weather, 0, 'soviet', 0, 'soviet')
}

function startMatch(opening: ScorpionSetup, map: ScorpionSetupAssets['map']): ScorpionInPlay {
  const turn = scorpionFirstTurn()
  const railControl = { ...scorpionOpeningFrontControl(map),
    ...Object.fromEntries(Object.values(opening.units).map(({ side, hex }) => [hex, side])) }
  return { kind: 'playing', turn, cursor: startScorpionPlayerTurns(turn), rng: opening.rng,
    rerollHolder: 'soviet', airBases: scorpionOpeningAirBases, units: opening.units, pieces: opening.pieces,
    ...(opening.dropPlan ? { dropPlan: opening.dropPlan } : {}),
    moved: [], supply: null, railControl, combat: null, combatTargets: [], combatAttackers: [], dumps: opening.dumps,
    arrival: { placed: [], mobilized: [], sovietVp: turn.vp }, arrivalsOnMap: [], window: null,
    pax: { axis: 0, soviet: 0 }, availableAlerts: opening.availableAlerts, placedAlerts: [], victory: null }
}

function resolveReinforcements(
  state: Readonly<ScorpionInPlay>, actor: Side, action: ReinforcementCommand,
  { catalog, map }: ScorpionSetupAssets, board: ReinforcementBoard,
): ScorpionInPlay {
  let rng = state.rng
  const controlOf = scorpionControlLookup(state, map, board.controlOf)
  const result = applyScorpionReinforcement(state, actor, action, { ...board, controlOf }, () => {
    const draw = rollDie(rng)
    rng = draw.rng
    return draw.value
  }, (size) => {
    const draw = pickIndex(rng, size)
    rng = draw.rng
    return draw.value
  })
  let units = state.units
  const arrival = result.arrivalsOnMap[state.arrivalsOnMap.length]
  const alert = result.placedAlerts[state.placedAlerts.length]
  const placed = arrival ? { id: arrival.arrival.id, definition: arrival.arrival.definition, hex: arrival.hex,
    stepsLost: arrival.arrival.stepsLost ?? 0, organicTruck: arrival.arrival.organicTruck }
    : alert && { ...alert.counter, hex: alert.hex, stepsLost: 0, organicTruck: undefined }
  if (placed) {
    const definition = catalog.definitions.get(placed.definition)
    if (!definition || definition.source.side !== actor || !map.hexes.has(placed.hex) || Object.hasOwn(units, placed.id)) {
      throw new Error(`Invalid Scorpion arrival ${placed.id}`)
    }
    const counter = deployScorpionGroundCounter(definition, placed.hex, placed.stepsLost, placed.organicTruck)
    units = { ...units, [placed.id]: counter }
  }
  const barrageRecovery = actor === 'soviet' && action.type === 'complete-reinforcement' && state.barrageRecovery
    ? advanceScorpionBarrageRecovery(state.barrageRecovery) : state.barrageRecovery
  const updated = { ...state, ...result, rng, units, barrageRecovery,
    refittedAirbases: action.type === 'complete-refit' ? [] : state.refittedAirbases }
  return placed ? recordScorpionGroundControl(updated, actor, [placed.hex]) : updated
}
