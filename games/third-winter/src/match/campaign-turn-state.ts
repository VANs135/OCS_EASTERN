import type { DiceRoll, Side } from '@ocs-eastern/series/state-types'
import type { PlayerTurnCursor } from '@ocs-eastern/series/turn'
import type { CampaignReinforcementDate } from '../ttw/campaign/reinforcement-timing.ts'
import type { CampaignEventCheck, CampaignEventDraw } from '../ttw/campaign/random-events.ts'
import type { CampaignThawTiming, CampaignWeather, CampaignWeatherCheck, WeatherHistory } from '../ttw/campaign/weather.ts'
import type { CampaignBoardState, CampaignReinforcementAction, CampaignReinforcementContext, CampaignReinforcementWindow } from './campaign-reinforcement-state.ts'
import type { CampaignBreakoutAction, CampaignBreakoutBoard, CampaignBreakoutRoll } from './campaign-breakout.ts'
import type { CampaignBreakoutReturnBoard, ReturnCampaignBreakout } from './campaign-breakout-returns.ts'
import type { CampaignAircraftConsolidationBoard, ConsolidateCampaignAircraft } from './campaign-aircraft-consolidation.ts'
import type { CampaignGroundMovementAction, CampaignGroundMovementProgress } from './campaign-ground-movement.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import type { CampaignMarchResponse } from './campaign-march-response.ts'
import type { CampaignBridgeDecision } from './campaign-volga-bridges.ts'

type CampaignPreTurn = { phase: 'pre-turn' } & (
  | { segment: 'weather' }
  | { segment: 'random-event'; event?: CampaignEventDraw }
  | { segment: 'initiative'; winner: Side | null }
  | { segment: 'simulcast' }
)

export type CampaignCursor = CampaignPreTurn | PlayerTurnCursor | { phase: 'ended'; reason: 'april-mud' }

export type CampaignPreTurnCheck = CampaignWeatherCheck | CampaignEventCheck | `${Side}-initiative`

export interface CampaignPreTurnRoll {
  turn: number
  phase: 'pre-turn'
  segment: 'weather' | 'random-event' | 'initiative'
  check: CampaignPreTurnCheck
  dice: DiceRoll
  before: number
  after: number
}

export interface CampaignFerry {
  id: string
  side: Side
  hex: string
  pontoonId: string
}

export interface CampaignOpeningConditions {
  weather: CampaignWeather
  first: Side
}

export interface CampaignTurnState extends CampaignBoardState {
  when: CampaignReinforcementDate
  turn: number
  cursor: CampaignCursor
  opening?: CampaignOpeningConditions
  weather: CampaignWeather | { ground: 'mud'; flight: null } | null
  weatherHistory: WeatherHistory
  ferries: readonly CampaignFerry[]
  /** Canonical hexside keys. A kept bridge is permanently past its demolition window. */
  volgaBridgeDecisions?: Readonly<Record<string, CampaignBridgeDecision>>
  preTurnRolls: readonly CampaignPreTurnRoll[]
  movementSegment?: 'breakout' | 'movement' | 'barrage'
  groundMovement?: CampaignGroundMovementProgress
  breakoutRolls: readonly CampaignBreakoutRoll[]
  reinforcement?: { stage: 'opening' } | {
    stage: 'ordinary' | 'closing'
    window: CampaignReinforcementWindow
  }
}

export type CampaignPreTurnAction =
  | { type: 'determine-campaign-weather' }
  | { type: 'roll-campaign-event' }
  | { type: 'roll-campaign-initiative' }
  | { type: 'choose-campaign-first'; first: Side }

export type CampaignReinforcementPhaseAction = CampaignReinforcementAction | ReturnCampaignBreakout
  | { type: 'complete-campaign-reinforcement-opening' }
  | { type: 'complete-campaign-rebuilds' }
  | { type: 'complete-campaign-reinforcement' }

export type CampaignTurnAction = CampaignPreTurnAction | CampaignReinforcementPhaseAction | CampaignBreakoutAction | ConsolidateCampaignAircraft
  | CampaignGroundMovementAction | CampaignMarchResponse | { type: 'complete-campaign-refit' }

export interface CampaignTurnContext {
  reinforcement: CampaignReinforcementContext
  breakoutBoard?: CampaignBreakoutBoard
  groundMovement?: CampaignGroundMovementBoard
  breakoutReturns?: CampaignBreakoutReturnBoard
  aircraftConsolidation?: CampaignAircraftConsolidationBoard
  thawTiming?: CampaignThawTiming
  /** The work-specific stage rules certify resolution of applicable opening and closing obligations. */
  reinforcementBlockers?: (state: Readonly<CampaignTurnState>, stage: 'opening' | 'closing') => readonly string[]
}
