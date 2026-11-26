import type { DiceRoll, Side } from '@ocs-eastern/series/state-types'
import type { TrainbustingMarker } from '@ocs-eastern/series/trainbusting'
import type { PlayerTurnCursor } from '@ocs-eastern/series/turn'
import type { CampaignReinforcementDate } from '../ttw/campaign/reinforcement-timing.ts'
import type { TtwRailGauge } from '../ttw/campaign/rail-gauge.ts'
import type { CampaignEventCheck, CampaignEventDraw } from '../ttw/campaign/random-events.ts'
import type { CampaignThawTiming, CampaignWeather, CampaignWeatherCheck, WeatherHistory } from '../ttw/campaign/weather.ts'
import type { CampaignBoardState, CampaignReinforcementAction, CampaignReinforcementContext, CampaignReinforcementWindow } from './campaign-reinforcement-state.ts'
import type { CampaignBreakoutAction, CampaignBreakoutBoard, CampaignBreakoutRoll } from './campaign-breakout.ts'
import type { CampaignBreakoutReturnBoard, ReturnCampaignBreakout } from './campaign-breakout-returns.ts'
import type { CampaignAircraftConsolidationBoard, ConsolidateCampaignAircraft } from './campaign-aircraft-consolidation.ts'
import type { CampaignRefitBoard, RefitCampaignAircraft } from './campaign-aircraft-refit.ts'
import type { CampaignGroundMovementAction, CampaignGroundMovementProgress } from './campaign-ground-movement.ts'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import type { CampaignMarchResponse } from './campaign-march-response.ts'
import type { CampaignBridgeDecision, CampaignBridgeRepair } from './campaign-volga-bridges.ts'
import type { CampaignPontoonAction, CampaignPontoonPhase } from './campaign-pontoon-phase.ts'
import type { CampaignKhersonFerryPhase, UseCampaignKhersonFerry } from './campaign-kherson-ferry.ts'
import type { CampaignRailBoard, TransportCampaignRail } from './campaign-rail-transport.ts'
import type { CampaignRailCleanupBoard } from './campaign-rail-cleanup.ts'
import type { CampaignSupplyAction, CampaignSupplyWindow } from './campaign-supply-phase.ts'
import type { CampaignSupplyPhaseBoard } from './campaign-supply-stock.ts'
import type { CampaignLateSegment, CompleteCampaignLateSegment } from './campaign-late-turn.ts'
import type { CampaignBarrage, CampaignBarrageAction, CampaignBarrageBoard, CampaignBarrageRecord } from './campaign-barrage.ts'
import type { CampaignHqRecovery } from './campaign-combat-losses.ts'
import type { CampaignCombat, CampaignCombatAction, CampaignCombatBoard } from './campaign-combat.ts'
import type { CampaignHqRecoveryBoard, PlaceCampaignHqRecovery } from './campaign-hq-recovery.ts'
import type { CampaignBreakdownAction, CampaignBreakdownBoard } from './campaign-breakdown.ts'
import type { CampaignRemnantRebuildBoard, RebuildCampaignFromRemnant } from './campaign-remnants.ts'
import type { CampaignRoundEnd } from './campaign-cleanup-phase.ts'
import type { CampaignSteAction, CampaignStePlacement } from './campaign-special-truck-extender.ts'

type CampaignPreTurn = { phase: 'pre-turn' } & (
  | { segment: 'weather' }
  | { segment: 'random-event'; event?: CampaignEventDraw }
  | { segment: 'initiative'; winner: Side | null }
  | { segment: 'simulcast' }
)

export type CampaignCursor = CampaignPreTurn | PlayerTurnCursor | { phase: 'ended'; reason: 'april-mud' | 'scenario-end' }

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
  volgaBridgeRepairs?: Readonly<Record<string, CampaignBridgeRepair>>
  pontoonPhase?: CampaignPontoonPhase
  khersonFerryPhase?: CampaignKhersonFerryPhase
  railGaugeByEdge?: Readonly<Record<string, TtwRailGauge>>
  cleanup?: { sovietConvertedEdges: readonly string[] }
  supplyPhase?: CampaignSupplyWindow
  lateTurnSegment?: CampaignLateSegment
  /** 进行中的炮击（OCS 10.0）；null＝已结算。 */
  barrage?: CampaignBarrage | null
  barrageHistory?: readonly CampaignBarrageRecord[]
  /** TTW 5.0a 苏军累积 VP（歼灭 HQ 等）；突然死亡与终局计分随批次 6 后续接通。 */
  sovietVp?: number
  /** 被毁 HQ 的免费重建/恢复记录，增援环消费（TTW 2.3b E/c G/d）。 */
  hqRecoveries?: readonly CampaignHqRecovery[]
  /** 进行中的地面战斗（OCS 9.0）；null＝已结算。 */
  combat?: CampaignCombat | null
  /** 本阶段已发起战斗的目标格（每格一次）。 */
  combatTargets?: readonly string[]
  /** 本阶段已参战的攻击单位（每单位一次）。 */
  combatAttackers?: readonly string[]
  /** 已回池拆分算子的物理身份（按定义），供复用以维持池数量上限。 */
  breakdownReturns?: Readonly<Record<string, readonly string[]>>
  /** 突袭移动账本（OCS 8.0）：余量 MP 与是否已进格；null＝已结束。 */
  overrunMarch?: { remaining: Readonly<Record<string, number>>; enteredHex: boolean } | null
  /** TTW 1.4c：本阶段各伏尔加级河岸已推进 RE（跨阶段重置）。 */
  volgaAdvance?: { phase: string; re: Record<string, number> }
  /** OCS 20.0d：段末强制吸收义务窗（开窗期间仅吸收可结清，段末推进被阻塞）。 */
  breakdownAbsorb?: { side: Side } | null
  /** TTW §3.3：各 Front HQ 姿态与进入回合（§3.3e 计时）。 */
  frontPostures?: Readonly<Record<string, import('../ttw/front-posture.ts').TtwFrontPostureState>>
  /** TTW §3.3d B：每方面军每回合攻击补给已用 SP（turn 不匹配即视为 0）。 */
  frontAttackSupply?: { turn: number; spent: Readonly<Record<string, number>> }
  /** TTW §3.4b：各 Front 弹幕标记的恢复回合（缺省视为初始 Ready）；turn≥readyTurn 即 Ready。 */
  frontBarrageMarkers?: Readonly<Record<string, { readyTurn: number }>>
  /** 通规 §12.5c-A：编队燃料标记（持续到本方清理阶段）。 */
  formationFuel?: readonly import('./campaign-fuel.ts').CampaignFormationFuel[]
  /** 通规 §12.5c-B/12.5e：HQ 燃料标记（持续到本方清理阶段；used 锁定本阶段投递位置）。 */
  headquartersFuel?: readonly import('./campaign-fuel.ts').CampaignHeadquartersFuel[]
  /** TTW §3.5a：各 RVGK 盒标记当前格（rvgk-1/rvgk-2 → hex）；铁路移动结算另接。 */
  rvgkMarkers?: Readonly<Record<string, string>>
  trainbusting?: readonly TrainbustingMarker[]
  refittedBases?: readonly string[]
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

export type CampaignReinforcementPhaseAction = CampaignReinforcementAction | ReturnCampaignBreakout | PlaceCampaignHqRecovery
  | RebuildCampaignFromRemnant
  | { type: 'complete-campaign-reinforcement-opening' }
  | { type: 'complete-campaign-rebuilds' }
  | { type: 'complete-campaign-reinforcement' }

export type CampaignTurnAction = CampaignPreTurnAction | CampaignReinforcementPhaseAction | CampaignBreakoutAction | ConsolidateCampaignAircraft
  | CampaignGroundMovementAction | CampaignMarchResponse | CampaignPontoonAction | UseCampaignKhersonFerry | TransportCampaignRail
  | CampaignSupplyAction | CompleteCampaignLateSegment | CampaignSteAction | RefitCampaignAircraft | CampaignBarrageAction | CampaignCombatAction
  | CampaignBreakdownAction
  | { type: 'complete-campaign-refit' | 'complete-campaign-movement-phase' | 'complete-campaign-exploitation' | 'complete-campaign-cleanup' }
  | SetCampaignFrontPosture
  | SpendCampaignBarrageMarker
  | import('./campaign-fuel.ts').CampaignFuelAction
  | import('./campaign-rvgk.ts').CampaignRvgkAction

/** TTW §3.4a：空/海军炮击环节花费弹幕标记（须进攻姿态＋Ready）。 */
export interface SpendCampaignBarrageMarker {
  type: 'spend-campaign-barrage-marker'
  front: string
  targetHex: string
}

/** TTW §3.3c/d：姿态指定窗口——进攻在苏军增援阶段开始、regrouping 在阶段末。 */
export interface SetCampaignFrontPosture {
  type: 'set-campaign-front-posture'
  front: string
  mode: import('../ttw/front-posture.ts').TtwFrontPosture
  window: 'start' | 'end'
}

export interface CampaignTurnContext {
  reinforcement: CampaignReinforcementContext
  breakoutBoard?: CampaignBreakoutBoard
  groundMovement?: CampaignGroundMovementBoard
  railTransport?: CampaignRailBoard
  railCleanup?: CampaignRailCleanupBoard
  supplyPhase?: CampaignSupplyPhaseBoard
  barrage?: CampaignBarrageBoard
  combat?: CampaignCombatBoard
  hqRecovery?: CampaignHqRecoveryBoard
  breakdown?: CampaignBreakdownBoard
  remnantRebuild?: CampaignRemnantRebuildBoard
  stePlacement?: CampaignStePlacement
  breakoutReturns?: CampaignBreakoutReturnBoard
  aircraftConsolidation?: CampaignAircraftConsolidationBoard
  aircraftRefit?: CampaignRefitBoard
  thawTiming?: CampaignThawTiming
  /** The work-specific stage rules certify resolution of applicable opening and closing obligations. */
  reinforcementBlockers?: (state: Readonly<CampaignTurnState>, stage: 'opening' | 'closing') => readonly string[]
  movementBarrageBlockers?: (state: Readonly<CampaignTurnState>, side: Side) => readonly string[] | undefined
  exploitationEndBlockers?: (state: Readonly<CampaignTurnState>, side: Side) => readonly string[] | undefined
  lateSegmentEndBlockers?: (state: Readonly<CampaignTurnState>, actor: Side, segment: CampaignLateSegment) => readonly string[] | undefined
  cleanupEndBlockers?: (state: Readonly<CampaignTurnState>, side: Side) => readonly string[] | undefined
  roundEnd?: (cleaned: Readonly<CampaignTurnState>) => CampaignRoundEnd | undefined
  /** TTW §3.4a：弹幕标记目标格几何校验（邻接苏军战斗单位＋已编属 HQ 指挥半径内 throw）；绑定层注入。 */
  barrageMarkerTarget?: (state: Readonly<CampaignTurnState>, front: string, hex: string) => boolean
  /** 通规 §12.5c-A：编队燃料的编队归属判定（绑定层注入）。 */
  organicFormation?: (state: Readonly<CampaignTurnState>, id: string) => string | undefined
  /** TTW §3.5c：RVGK 入盒的战略可达判定（绑定层注入）。 */
  rvgkStratReachable?: (state: Readonly<CampaignTurnState>, id: string) => boolean
  /** TTW §3.5d B：RVGK 释放的盘面事实（满编/最低编成维持/本回合入盒/独立单位编组，绑定层注入）。 */
  rvgkReleaseFacts?: (state: Readonly<CampaignTurnState>, id: string) =>
    { fullStrength: boolean; minimumsMaintained: boolean; enteredThisTurn: boolean; independent: boolean; withTankArmyHq: boolean; independentRe: number } | undefined
}
