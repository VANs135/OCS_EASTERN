import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import { pickIndex, rollDie } from '@ocs-eastern/series/rng'
import type { RngState, Side } from '@ocs-eastern/series/state-types'
import type { BarrageTable } from '@ocs-eastern/series/tables/barrage'
import { deployScorpionGroundCounter } from '../import/scorpion-deployment.ts'
import type { DeployedCounter } from '../import/scorpion-deployment.ts'
import { openScorpionTurn } from '../ttw/scorpion/pre-turn.ts'
import type { ScorpionTurn } from '../ttw/scorpion/pre-turn.ts'
import { scorpionOpeningAirBases } from '../ttw/scorpion/setup-stores.ts'
import { scorpionWeather } from '../ttw/scorpion/weather.ts'
import { assignScorpionAttrition, checkScorpionAttrition } from './scorpion-attrition.ts'
import type { AssignAttrition } from './scorpion-attrition.ts'
import { applyScorpionBarrage, scorpionPhaseBarrages } from './scorpion-barrage.ts'
import type { BarrageAction, ScorpionBarrage, ScorpionBarrageRecord } from './scorpion-barrage.ts'
import type { ScorpionBoxPiece } from './scorpion-box-pieces.ts'
import { chooseScorpionCombatTerrain, declareScorpionCombat, defendScorpionCombat, selectScorpionCombatRating } from './scorpion-combat.ts'
import type { ChooseCombatTerrain, DeclareCombat, DefendCombat, ScorpionCombat, ScorpionCombatBoard } from './scorpion-combat.ts'
import { advanceScorpionCombat, resolveScorpionCombat } from './scorpion-combat-result.ts'
import type { ResolveCombat } from './scorpion-combat-result.ts'
import { applyScorpionGroundAction } from './scorpion-ground-actions.ts'
import type { ScorpionGroundAction } from './scorpion-ground-actions.ts'
import type { MovementBoard } from './scorpion-movement.ts'
import { advanceScorpionPhase, startScorpionPlayerTurns } from './scorpion-player-turn.ts'
import { applyScorpionPhaseFlow } from './scorpion-phase-flow.ts'
import type { ScorpionPhaseAction } from './scorpion-phase-flow.ts'
import { applyScorpionReinforcement } from './scorpion-reinforcement.ts'
import type { ReinforcementCommand } from './scorpion-reinforcement.ts'
import type { ReinforcementBoard, ReinforcementState } from './scorpion-reinforcement-state.ts'
import { applyScorpionReserve, assertScorpionReserveAtMovementEnd } from './scorpion-reserves.ts'
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
  units: Readonly<Record<string, DeployedCounter>>
  pieces: readonly ScorpionBoxPiece[]
  moved: readonly string[]
  supply: ScorpionSupplyWindow | null
  railControl: Readonly<Record<string, Side>>
  combat: ScorpionCombat | null
  barrage?: ScorpionBarrage | null
  barrageHistory?: readonly ScorpionBarrageRecord[]
  combatTargets: readonly string[]
  combatAttackers: readonly string[]
}

export type ScorpionSession = { kind: 'setup'; opening: ScorpionSetup } | ScorpionInPlay
export type ScorpionAction = ScorpionSetupAction | ReinforcementCommand | ScorpionGroundAction
  | { type: 'complete-movement' } | { type: 'choose-formation-trace'; formation: string; anchor: string }
  | FeedUnits | RecoverInternalStocks | { type: 'check-attrition' } | AssignAttrition | { type: 'complete-supply' }
  | ScorpionPhaseAction | ScorpionReserveAction | BarrageAction | DeclareCombat | DefendCombat | ChooseCombatTerrain | ResolveCombat
  | { type: 'select-combat-rating'; unitId: string } | { type: 'advance-after-combat'; unitIds: readonly string[] }
export type ScorpionSessionRecord = MatchRecord<ScorpionSession, ScorpionAction, Side>
interface BoardPolicies {
  reinforcements?: (state: Readonly<ScorpionInPlay>) => ReinforcementBoard
  movement?: (state: Readonly<ScorpionInPlay>) => Omit<MovementBoard, 'map' | 'weather'>
  supplyRail?: SupplyRailBoard
  combat?: ScorpionCombatBoard
  barrage?: BarrageTable
}

export function createScorpionSession(data: ScorpionSetupData, assets: ScorpionSetupAssets, seed: number): ScorpionSessionRecord {
  return { state: { kind: 'setup', opening: createScorpionSetup(data, assets, seed) }, revision: 0, receipts: [] }
}

export function submitScorpionSession(
  record: Readonly<ScorpionSessionRecord>, seat: Side, command: Readonly<Command<ScorpionAction>>,
  assets: ScorpionSetupAssets, board: BoardPolicies = {},
) {
  return acceptCommand(record, seat, command, (state, actor, action): ScorpionSession => {
    if (state.kind === 'playing' && (state.victory || state.turn.step.kind === 'ended')) {
      throw new Error('The Scorpion match has ended')
    }
    if (state.kind === 'playing' && state.barrage && action.type !== 'choose-barrage-terrain' && action.type !== 'assign-barrage-loss') {
      throw new Error('Resolve the pending barrage first')
    }
    switch (action.type) {
      case 'base-aircraft':
      case 'place-setup-alert':
      case 'choose-setup-loss':
      case 'confirm-setup': {
        if (state.kind !== 'setup') throw new Error('Scorpion deployment is closed')
        const opening = applyScorpionSetup(state.opening, actor, action, assets)
        return opening ? { kind: 'setup', opening } : startMatch(state.opening)
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
          assertScorpionReserveAtMovementEnd(state, actor, board.combat?.hedgehogAt)
        }
        return applyScorpionPhaseFlow(state, actor, action, assets.map)
      case 'mark-reserve':
      case 'leave-reserve':
      case 'release-reserve':
        if (state.kind !== 'playing' || state.combat || state.turn.step.kind !== 'player-turn') {
          throw new Error('Reserve action is unavailable')
        }
        if (scorpionPhaseBarrages(state).length) throw new Error('The Movement Segment has ended')
        return applyScorpionReserve(state, actor, action, assets)
      case 'declare-artillery-barrage':
      case 'choose-barrage-terrain':
      case 'assign-barrage-loss':
        if (state.kind !== 'playing' || state.turn.step.kind !== 'player-turn' || !board.barrage) {
          throw new Error('Artillery requires an active player turn and the OCS v4.3 Barrage Table')
        }
        return applyScorpionBarrage(state, actor, action, assets, board.barrage, board.combat?.hedgehogAt, board.supplyRail)
      case 'declare-combat':
      case 'defend-combat':
      case 'select-combat-rating':
      case 'choose-combat-terrain':
      case 'resolve-combat':
      case 'advance-after-combat':
        if (state.kind !== 'playing' || state.turn.step.kind !== 'player-turn' || !board.combat) {
          throw new Error('Combat requires an active player turn and the OCS v4.3 table')
        }
        if (action.type === 'declare-combat') return declareScorpionCombat(state, actor, action, assets.map, board.combat, board.supplyRail)
        if (action.type === 'defend-combat') return defendScorpionCombat(state, actor, action, assets.map, board.supplyRail)
        if (action.type === 'select-combat-rating') return selectScorpionCombatRating(state, actor, action.unitId)
        if (action.type === 'choose-combat-terrain') return chooseScorpionCombatTerrain(state, actor, action, assets.map, board.combat.table)
        if (action.type === 'resolve-combat') return resolveScorpionCombat(state, actor, action, assets, board.supplyRail)
        return advanceScorpionCombat(state, actor, action.unitIds)
      case 'ground-move':
      case 'reserve-stack-move':
        if (state.kind !== 'playing' || state.combat || state.turn.step.kind !== 'player-turn' ||
          state.cursor.phase === 'exploitation' && state.combatTargets?.length) throw new Error('Scorpion movement is unavailable')
        if (scorpionPhaseBarrages(state).length) throw new Error('The Movement Segment has ended')
        return applyScorpionGroundAction(state, actor, action, assets, board)
      case 'complete-movement':
        if (state.kind !== 'playing' || state.turn.step.kind !== 'player-turn') throw new Error('Scorpion supply is unavailable')
        assertScorpionReserveAtMovementEnd(state, actor, board.combat?.hedgehogAt)
        return openScorpionSupply(state, actor, assets.map, board.supplyRail)
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
  })
}

export function scorpionFirstTurn(): ScorpionTurn {
  const weather = scorpionWeather(1, false, () => { throw new Error('Scorpion opening weather is fixed') })
  return openScorpionTurn(1, weather, 0, 'soviet', 0, 'soviet')
}

function startMatch(opening: ScorpionSetup): ScorpionInPlay {
  const turn = scorpionFirstTurn()
  const railControl = Object.fromEntries(Object.values(opening.units).filter((unit) => unit.combat)
    .map(({ side, hex }) => [hex, side]))
  return { kind: 'playing', turn, cursor: startScorpionPlayerTurns(turn), rng: opening.rng,
    rerollHolder: 'soviet', airBases: scorpionOpeningAirBases, units: opening.units, pieces: opening.pieces,
    moved: [], supply: null, railControl, combat: null, combatTargets: [], combatAttackers: [], dumps: opening.dumps,
    arrival: { placed: [], mobilized: [], sovietVp: turn.vp }, arrivalsOnMap: [], window: null,
    pax: { axis: 0, soviet: 0 }, availableAlerts: opening.availableAlerts, placedAlerts: [], victory: null }
}

function resolveReinforcements(
  state: Readonly<ScorpionInPlay>, actor: Side, action: ReinforcementCommand,
  { catalog, map }: ScorpionSetupAssets, board: ReinforcementBoard,
): ScorpionInPlay {
  let rng = state.rng
  const result = applyScorpionReinforcement(state, actor, action, board, () => {
    const draw = rollDie(rng)
    rng = draw.rng
    return draw.value
  }, (size) => {
    const draw = pickIndex(rng, size)
    rng = draw.rng
    return draw.value
  })
  let units = state.units
  let railControl = state.railControl
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
    if (counter.combat) railControl = { ...railControl, [placed.hex]: actor }
  }
  return { ...state, ...result, rng, units, railControl }
}
