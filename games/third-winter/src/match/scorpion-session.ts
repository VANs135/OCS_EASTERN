import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import { pickIndex } from '@ocs-eastern/series/rng'
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
import { applyScorpionAirAction } from './scorpion-air-actions.ts'
import type { ScorpionAirAction } from './scorpion-air-actions.ts'
import type { ScorpionAirMission, ScorpionAirReport } from './scorpion-air-operations.ts'
import type { AirfieldCapacityChoice } from './scorpion-airfield-barrage.ts'
import type { ScorpionAirfield } from './scorpion-airfield-work.ts'
import type { BarrageAction, ScorpionBarrage, ScorpionBarrageRecord, ScorpionFrontBarrage } from './scorpion-barrage.ts'
import { scorpionRegularBarrageTargets } from './scorpion-barrage-timing.ts'
import type { ScorpionBoxPiece } from './scorpion-box-pieces.ts'
import { settleScorpionCapture } from './scorpion-capture.ts'
import type { ScorpionCaptureReport, ScorpionCaptureWindow, SettleScorpionCapture } from './scorpion-capture.ts'
import type { ScorpionCombat, ScorpionCombatBoard } from './scorpion-combat.ts'
import { applyScorpionCombatAction, scorpionCombatDecision } from './scorpion-combat-actions.ts'
import type { ScorpionCombatAction } from './scorpion-combat-actions.ts'
import type { ScorpionDropPlan } from './scorpion-drop-plan.ts'
import { applyScorpionFireAction } from './scorpion-fire-actions.ts'
import { pruneScorpionGroundControl, recordScorpionGroundControl, scorpionControlLookup } from './scorpion-hex-control.ts'
import { scorpionControlSites, scorpionOpeningFrontControl } from '../ttw/scorpion/initial-map.ts'
import { applyScorpionGroundAction } from './scorpion-ground-actions.ts'
import type { GroundPolicies, ScorpionGroundAction } from './scorpion-ground-actions.ts'
import type { ScorpionGroundActivity } from './scorpion-ground-activity.ts'
import type { ScorpionHedgehog } from './scorpion-hedgehogs.ts'
import { applyScorpionLogisticsAction } from './scorpion-logistics-actions.ts'
import type { ScorpionLogisticsAction } from './scorpion-logistics-actions.ts'
import type { ScorpionOverrunMarch } from './scorpion-overrun.ts'
import { startScorpionPlayerTurns } from './scorpion-player-turn.ts'
import { applyScorpionPhaseFlow } from './scorpion-phase-flow.ts'
import type { ScorpionPhaseAction } from './scorpion-phase-flow.ts'
import { withScorpionPhaseOccupancy } from './scorpion-phase-occupancy.ts'
import type { ScorpionPhaseOccupancy } from './scorpion-phase-occupancy.ts'
import type { FormationFuel, HeadquartersFuel } from './scorpion-fuel.ts'
import { applyScorpionReinforcement } from './scorpion-reinforcement.ts'
import type { ReinforcementCommand } from './scorpion-reinforcement.ts'
import type { ReinforcementBoard, ReinforcementState } from './scorpion-reinforcement-state.ts'
import { applyScorpionReserve, assertScorpionMovementEnd } from './scorpion-reserves.ts'
import type { ScorpionReserveAction } from './scorpion-reserves.ts'
import { rebuildScorpionRemnant } from './scorpion-remnants.ts'
import type { RebuildScorpionRemnant } from './scorpion-remnants.ts'
import { applyScorpionKessel } from './scorpion-kessel.ts'
import type { ScorpionKesselAction } from './scorpion-kessel.ts'
import { applyScorpionReroll, scorpionRolls } from './scorpion-reroll.ts'
import type { ResolveScorpionReroll, ScorpionPlayAction, ScorpionRerollUse, ScorpionRerollWindow, ScorpionRoll } from './scorpion-reroll.ts'
import { applyScorpionSetup, createScorpionSetup } from './scorpion-setup.ts'
import type { ScorpionSetup, ScorpionSetupAction, ScorpionSetupAssets, ScorpionSetupData } from './scorpion-setup.ts'
import type { ScorpionSupplyWindow } from './scorpion-supply-phase.ts'
import { advanceScorpionThaw } from './scorpion-thaw.ts'
import { assertScorpionPhaseStacking, scorpionThawEntryHexes, settleScorpionStacking } from './scorpion-stacking.ts'
import type { SettleScorpionStacking } from './scorpion-stacking.ts'

export interface ScorpionInPlay extends ReinforcementState {
  kind: 'playing'
  turn: ScorpionTurn
  rng: RngState
  rerollHolder: Side | null
  reroll?: ScorpionRerollWindow
  rerollHistory?: readonly ScorpionRerollUse[]
  airBases: readonly ScorpionAirfield[]
  airfieldBuiltAt?: Readonly<Record<string, number>>
  airfieldReducedAt?: Readonly<Record<string, number>>
  refittedAirbases?: readonly string[]
  airfieldCapacityChoice?: AirfieldCapacityChoice | null
  airMission?: ScorpionAirMission | null
  airHistory?: readonly ScorpionAirReport[]
  dropPlan?: ScorpionDropPlan | null
  phaseOccupancy?: ScorpionPhaseOccupancy
  dropTrace?: { unitId: string; turn: number }
  kesselReturns?: Readonly<Record<string, number>>
  trainbusting?: readonly TrainbustingMarker[]
  hedgehogs?: Readonly<Record<string, ScorpionHedgehog | null>>
  hedgehogBuiltAt?: Readonly<Record<string, number>>
  hedgehogReducedAt?: Readonly<Record<string, number>>
  units: Readonly<Record<string, DeployedCounter>>
  pieces: readonly ScorpionBoxPiece[]
  moved: readonly string[]
  groundActivity?: ScorpionGroundActivity
  nextTransportSerial?: number
  formationFuel?: readonly FormationFuel[]
  headquartersFuel?: readonly HeadquartersFuel[]
  supply: ScorpionSupplyWindow | null
  thawSupply?: ScorpionSupplyWindow
  /** Control of eligible sites. Rail gauge is stored independently of this save field. */
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
  | ScorpionLogisticsAction
  | ScorpionPhaseAction | ScorpionReserveAction | BarrageAction | ScorpionCombatAction
  | RebuildScorpionRemnant | ResolveScorpionReroll
  | ScorpionKesselAction | SettleScorpionStacking
  | SettleScorpionCapture | ScorpionAirAction
export type ScorpionSessionRecord = MatchRecord<ScorpionSession, ScorpionAction, Side>
interface BoardPolicies extends GroundPolicies {
  reinforcements?: (state: Readonly<ScorpionInPlay>) => ReinforcementBoard
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
  function applyAction(state: ScorpionSession, actor: Side, action: ScorpionPlayAction, offer?: ScorpionRoll): ScorpionSession {
    const airBoard = { barrage: board.barrage, facilityBarrage: board.facilityBarrage,
      hedgehogAt: board.combat?.hedgehogAt, supplyRail: board.supplyRail, captureResolution: board.captureResolution, offerRoll: offer }
    const stackingExempt = state.kind === 'playing' && state.turn.weather.ground === 'thaw'
      ? scorpionThawEntryHexes(state, board.reinforcements?.(state)) : undefined
    if (state.kind === 'playing' && (state.victory || state.turn.step.kind === 'ended')) {
      throw new Error('The Scorpion match has ended')
    }
    if (state.kind === 'playing' && state.turn.weather.ground === 'thaw' && (
      action.type === 'declare-combat' || action.type === 'declare-overrun' || action.type === 'declare-artillery-barrage' ||
      action.type === 'declare-front-barrage' || action.type === 'work-hedgehog' || action.type === 'work-airfield')) {
      throw new Error('Combat, barrage and construction are unavailable in a Thaw Simulcast turn')
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
        return applyScorpionAirAction(state, actor, action, assets, airBoard)
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
    if (state.kind === 'playing' && state.combat && action.type !== 'settle-capture') {
      const decision = scorpionCombatDecision(state.combat)
      if (action.type !== decision.actionType) {
        throw new Error(`Resolve the pending combat in the correct order: ${decision.actionType} is next`)
      }
      if (actor !== decision.actor) {
        if (decision.step === 'retreat') throw new Error('Only the retreating side may continue its pending route')
        throw new Error(`Resolve the pending combat with the current responding side: ${decision.actor}`)
      }
    }
    switch (action.type) {
      case 'plan-air-drop':
      case 'delay-air-drop':
      case 'cancel-air-drop':
      case 'settle-airfield-capacity':
      case 'refit-aircraft':
      case 'launch-air-mission':
        return applyScorpionAirAction(state, actor, action, assets, airBoard)
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
          assertScorpionMovementEnd(state, actor, board.combat?.hedgehogAt, stackingExempt)
        }
        if (action.type === 'complete-combat' || action.type === 'complete-cleanup') assertScorpionPhaseStacking(state, actor, stackingExempt)
        return applyScorpionPhaseFlow(state, actor, action, assets.map)
      case 'settle-stacking':
        if (state.kind !== 'playing') throw new Error('Start the Scorpion match first')
        return settleScorpionStacking(state, actor, action, assets, board.supplyRail, stackingExempt)
      case 'mark-reserve':
      case 'leave-reserve':
      case 'release-reserve':
        if (state.kind !== 'playing' || state.combat || state.turn.step.kind !== 'player-turn') {
          throw new Error('Reserve action is unavailable')
        }
        if (scorpionRegularBarrageTargets(state).size) throw new Error('The Movement Segment has ended')
        return applyScorpionReserve({ ...state, overrunMarch: null, groundCaptureMove: null }, actor, action, assets)
      case 'settle-capture':
        if (state.kind !== 'playing') throw new Error('There is no special capture to settle')
        return settleScorpionCapture(state, actor, action, assets)
      case 'rebuild-remnant':
        if (state.kind !== 'playing' || state.turn.step.kind !== 'player-turn') throw new Error('Remnant rebuilding is unavailable')
        return rebuildScorpionRemnant(state, actor, action, assets, board.supplyRail)
      case 'place-kessel-hq':
      case 'remove-kessel-hq':
        if (state.kind !== 'playing') throw new Error('Start the Scorpion match first')
        return applyScorpionKessel(state, actor, action, assets)
      case 'declare-artillery-barrage':
      case 'declare-front-barrage':
      case 'choose-barrage-terrain':
      case 'assign-barrage-loss':
        return applyScorpionFireAction(state, actor, action, assets, airBoard)
      case 'declare-combat':
      case 'declare-overrun':
      case 'defend-combat':
      case 'select-combat-rating':
      case 'choose-combat-terrain':
      case 'resolve-combat':
      case 'advance-after-combat':
      case 'continue-combat-retreat':
      case 'continue-overrun-move':
        return applyScorpionCombatAction(state, actor, action, assets, board, offer)
      case 'ground-move':
      case 'kessel-move':
      case 'set-ground-mode':
      case 'reserve-stack-move':
        return applyScorpionGroundAction(state, actor, action, assets, board)
      case 'work-hedgehog':
      case 'work-airfield':
      case 'fuel-formation':
      case 'fuel-headquarters':
      case 'fuel-from-paused-transport':
      case 'load-transport':
      case 'unload-transport':
      case 'repack-transport':
      case 'form-extender':
      case 'dismantle-extender':
      case 'collapse-extender':
      case 'complete-movement':
      case 'choose-formation-trace':
      case 'recover-internal-stocks':
      case 'feed-units':
      case 'check-attrition':
      case 'assign-attrition':
      case 'complete-supply':
        return applyScorpionLogisticsAction(state, actor, action,
          { assets, supplyRail: board.supplyRail, hedgehogAt: board.combat?.hedgehogAt, stackingExempt })
      case 'complete-refit':
      case 'place-arrival':
      case 'place-supply':
      case 'finish-scheduled-arrivals':
      case 'place-alert':
      case 'pass-alert':
      case 'complete-reinforcement': {
        if (state.kind !== 'playing' || state.turn.step.kind !== 'player-turn' || !board.reinforcements) {
          throw new Error('Scorpion reinforcements are unavailable')
        }
        if (action.type === 'complete-refit') assertScorpionPhaseStacking(state, actor, stackingExempt)
        if (state.cursor.simulcast && state.cursor.phasing === actor &&
          action.type === 'complete-refit' && state.cursor.phase === 'aircraft-refit' && !state.window) {
          return advanceScorpionThaw(state, actor, assets.map, board.supplyRail)
        }
        const updated = resolveReinforcements(state, actor, action, assets, board.reinforcements(state), offer)
        return state.cursor.simulcast && action.type === 'complete-reinforcement'
          ? advanceScorpionThaw({ ...updated, cursor: state.cursor }, actor, assets.map, board.supplyRail) : updated
      }
      default:
        action satisfies never
        throw new Error('Unknown Scorpion action')
    }
  }
  return acceptCommand(record, seat, command, (state, actor, action) => {
    if (state.kind === 'setup') {
      if (action.type === 'resolve-reroll') throw new Error('No roll is pending during setup')
      return withScorpionPhaseOccupancy(state, applyAction(state, actor, action))
    }
    const current = assets.map ? pruneScorpionGroundControl(state, assets.map) : state
    const next = applyScorpionReroll(current, actor, action, applyAction)
    if (next.kind === 'playing' && next.reroll) return next
    // OCS 6.1g, 13.2a. Only handling and fueling can interrupt this same transport's move.
    const type = current.reroll?.action.type ?? action.type
    const keepTransport = type === 'ground-move' || type === 'load-transport' || type === 'unload-transport' ||
      type === 'fuel-formation' || type === 'fuel-headquarters' || type === 'fuel-from-paused-transport' || type === 'repack-transport'
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
  const sites = scorpionControlSites(map)
  const railControl = { ...scorpionOpeningFrontControl(map),
    ...Object.fromEntries(Object.values(opening.units).filter(({ hex }) => sites.has(hex)).map(({ side, hex }) => [hex, side])) }
  return { kind: 'playing', turn, cursor: startScorpionPlayerTurns(turn), rng: opening.rng,
    rerollHolder: 'soviet', airBases: scorpionOpeningAirBases, units: opening.units, pieces: opening.pieces,
    ...(opening.dropPlan ? { dropPlan: opening.dropPlan } : {}),
    moved: [], supply: null, railControl, combat: null, combatTargets: [], combatAttackers: [], dumps: opening.dumps,
    arrival: { placed: [], mobilized: [], sovietVp: turn.vp }, arrivalsOnMap: [], window: null,
    pax: { axis: 0, soviet: 0 }, availableAlerts: opening.availableAlerts, placedAlerts: [], victory: null }
}

function resolveReinforcements(
  state: Readonly<ScorpionInPlay>, actor: Side, action: ReinforcementCommand,
  { catalog, map }: ScorpionSetupAssets, board: ReinforcementBoard, offer?: ScorpionRoll,
): ScorpionInPlay {
  let rng = state.rng
  const controlOf = scorpionControlLookup(state, map, board.controlOf)
  const result = applyScorpionReinforcement(state, actor, action, { ...board, controlOf }, { pair: () => {
    const rolls = scorpionRolls(rng, offer)
    const dice = rolls.two({ kind: 'supply', side: actor })
    rng = rolls.rng
    return dice
  } }, (size) => {
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
  return placed ? recordScorpionGroundControl(updated, actor, placed.hex, map) : updated
}
