import type { DiceRoll, Side } from '@ocs-eastern/series/state-types'
import type { TrainbustingMarker } from '@ocs-eastern/series/trainbusting'
import type { PlayerTurnCursor } from '@ocs-eastern/series/turn'
import type { CampaignReinforcementDate } from '../ttw/campaign/reinforcement-timing.ts'
import type { TtwRailGauge } from '../ttw/campaign/rail-gauge.ts'
import type { CampaignEventCheck, CampaignEventDraw } from '../ttw/campaign/random-events.ts'
import type { CampaignThawTiming, CampaignWeather, CampaignWeatherCheck, WeatherHistory } from '../ttw/campaign/weather.ts'
import type { CampaignBoardState, CampaignCounter, CampaignReinforcementAction, CampaignReinforcementContext, CampaignReinforcementWindow } from './campaign-reinforcement-state.ts'
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
import type { CampaignScenarioVictory } from './campaign-victory.ts'
import type { CampaignSteAction, CampaignStePlacement } from './campaign-special-truck-extender.ts'
import type { CampaignAirMission, CampaignAirMissionAction, CampaignAirMissionBoard, CampaignAirMissionRecord } from './campaign-air-strike.ts'

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

/** 控制点易手事件：VP/城市格被另一侧战斗单位穿越时追加，供剧本计分读取历史归属。 */
export interface CampaignControlEvent {
  hex: string
  side: Side
  turn: number
}

/** 整算子被歼事件。与 Dead Pile 当前快照分开记账，重建后再被毁可再次计分。 */
export interface CampaignDestroyedUnit {
  id: string
  definition: string
  side: Side
  kind: CampaignCounter['kind']
  turn: number
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
  /** Opening-only railhead snapshot used to seed the initial gauge. Current railheads are derived from gauge changes. */
  initialRailheadMarkers?: readonly { side: Side; hex: string }[]
  /** Scenario supply sources at map edges (TTW Scenario 9 west/east rail hexes). */
  edgeSupplySources?: Readonly<Record<Side, readonly string[]>>
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
  /** TTW §2.4e：轴心 KG 标记（id＝领队算子，hex＝标记格；成员按同堆合格单位派生）。 */
  kampfgruppen?: readonly { id: string; hex: string }[]
  /** TTW §2.4e：本回合轴心反应段 KG 特殊反应掷骰（取半＝可行动 KG 数）与 2T 落点。 */
  kgReaction?: { turn: number; die: number; count: number; twoT: string | null }
  /** TTW §2.2b：Luftflotte HQ 本局一次性空运补给是否已用。 */
  luftflotteAirliftUsed?: boolean
  /** TTW §2.3a B：本回合已获益免费移动的 Kessel HQ（每回合仅一个）。 */
  kesselFreeMove?: { turn: number; kesselId: string }
  /** TTW §2.3a：Kessel HQ 移除/被毁后的返回可用回合（kesselId→turn+3）。 */
  kesselReturn?: Readonly<Record<string, number>>
  /** TTW §2.3c D：各 Army Group HQ 最近一次放 SP 的回合（每 HQ 每回合一次）。 */
  armyGroupSpPlaced?: Record<string, number>
  /** TTW §2.3c E：Army Group HQ 战斗 DRM 已用的游戏回合（每游戏回合全局一次）。 */
  armyGroupDrmTurn?: number
  /** TTW §5.0a：VP/城市格归属（最后穿越该格的战斗单位一方；hex→side）。 */
  hexControl?: Readonly<Record<string, Side>>
  /** TTW §5.0a：控制点易手事件（按发生顺序；剧本“解放/曾控制”类条件读取）。 */
  controlEvents?: readonly CampaignControlEvent[]
  /** 整算子歼灭事件（战斗/炮击损失入 Dead Pile 时追加；剧本 VP/事件读取）。 */
  destroyedUnits?: readonly CampaignDestroyedUnit[]
  /** 剧本终局胜负结果（清理阶段判终局时写入；进行中为 undefined）。 */
  scenarioVictory?: CampaignScenarioVictory
  /** OCS 16.0b–c：在图工事标记（hex→归属/等级；null＝已缩减为空）。 */
  hedgehogs?: Readonly<Record<string, import('./campaign-hedgehogs.ts').CampaignHedgehog | null>>
  /** OCS 16.0b：各格本回合是否已建造/缩减（每格每操作每回合一次）。 */
  hedgehogBuiltAt?: Readonly<Record<string, number>>
  hedgehogReducedAt?: Readonly<Record<string, number>>
  /** TTW §2.4a：已宣告要塞城市（城市名＋城市连通格＋宣告回合）。 */
  fortresses?: readonly import('./campaign-fortress.ts').CampaignFortress[]
  /** OCS 14.2f：进行中的空军任务；null＝无任务。 */
  airMission?: CampaignAirMission | null
  airHistory?: readonly CampaignAirMissionRecord[]
  /** OCS 15.2：在图机场/跑道（同格唯一；level 0 且带 strip＝跑道）。 */
  airBases?: readonly import('./campaign-airfield.ts').CampaignAirBase[]
  /** OCS 15.2：各格本回合是否已施工/降级（每格每操作每回合一次）。 */
  airfieldBuiltAt?: Readonly<Record<string, number>>
  airfieldReducedAt?: Readonly<Record<string, number>>
  /** OCS 9.14c：运输点夺取窗口；原主选定被夺取计数器与位移格前阻塞。 */
  transportCapture?: import('./campaign-transport-capture.ts').CampaignTransportCapture
  /** OCS 9.14c：同一 move 路径上后续格的待决窗口（按进入顺序）。 */
  transportCaptureQueue?: import('./campaign-transport-capture.ts').CampaignTransportCapture[]
  /** OCS 12.7a：在图延补器（翻转普通运输点数产生；throw 半径 20/10）。 */
  extenders?: readonly import('./campaign-extender.ts').CampaignExtender[]
  /** OCS 12.7a：延补器编号计数器（同格多枚唯一）。 */
  extenderSerial?: number
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
  | import('./campaign-kessel-placement.ts').CampaignKesselPlacementAction
  | import('./campaign-special-hedgehog.ts').PlaceCampaignSpecialHedgehog
  | { type: 'complete-campaign-reinforcement-opening' }
  | { type: 'complete-campaign-rebuilds' }
  | { type: 'complete-campaign-reinforcement' }

export type CampaignTurnAction = CampaignPreTurnAction | CampaignReinforcementPhaseAction | CampaignBreakoutAction | ConsolidateCampaignAircraft
  | CampaignGroundMovementAction | CampaignMarchResponse | CampaignPontoonAction | UseCampaignKhersonFerry | TransportCampaignRail
  | CampaignSupplyAction | CompleteCampaignLateSegment | CampaignSteAction | RefitCampaignAircraft | CampaignBarrageAction | CampaignCombatAction
  | CampaignAirMissionAction
  | CampaignBreakdownAction
  | import('./campaign-stacking.ts').CampaignStackingAction
  | { type: 'complete-campaign-refit' | 'complete-campaign-movement-phase' | 'complete-campaign-exploitation' | 'complete-campaign-cleanup' }
  | SetCampaignFrontPosture
  | SpendCampaignBarrageMarker
  | import('./campaign-fuel.ts').CampaignFuelAction
  | import('./campaign-rvgk.ts').CampaignRvgkAction
  | import('./campaign-rvgk-marker.ts').CampaignRvgkMarkerAction
  | import('./campaign-kg.ts').CampaignKgAction
  | import('./campaign-luftflotte.ts').CampaignLuftflotteAction
  | import('./campaign-luftflotte-placement.ts').CampaignLuftflottePlacementAction
  | import('./campaign-kessel.ts').CampaignKesselAction
  | import('./campaign-axis-hq.ts').CampaignAxisHqAction
  | import('./campaign-hedgehogs.ts').CampaignHedgehogAction
  | import('./campaign-fortress.ts').CampaignFortressAction
  | import('./campaign-airfield.ts').CampaignAirfieldAction
  | import('./campaign-extender.ts').CampaignExtenderAction
  | import('./campaign-transport-capture.ts').CampaignTransportCaptureAction
  | import('./campaign-special-hedgehog.ts').PlaceCampaignSpecialHedgehog

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
  kesselPlacement?: import('./campaign-kessel-placement.ts').CampaignKesselPlacementBoard
  luftflottePlacement?: import('./campaign-luftflotte-placement.ts').CampaignLuftflottePlacementBoard
  rvgkMarker?: import('./campaign-rvgk-marker.ts').CampaignRvgkMarkerBoard
  breakdown?: CampaignBreakdownBoard
  remnantRebuild?: CampaignRemnantRebuildBoard
  stePlacement?: CampaignStePlacement
  breakoutReturns?: CampaignBreakoutReturnBoard
  aircraftConsolidation?: CampaignAircraftConsolidationBoard
  aircraftRefit?: CampaignRefitBoard
  airMission?: CampaignAirMissionBoard
  stacking?: import('./campaign-stacking.ts').CampaignStackingBoard
  thawTiming?: CampaignThawTiming
  /** The work-specific stage rules certify resolution of applicable opening and closing obligations. */
  reinforcementBlockers?: (state: Readonly<CampaignTurnState>, stage: 'opening' | 'closing') => readonly string[]
  movementBarrageBlockers?: (state: Readonly<CampaignTurnState>, side: Side) => readonly string[] | undefined
  exploitationEndBlockers?: (state: Readonly<CampaignTurnState>, side: Side) => readonly string[] | undefined
  lateSegmentEndBlockers?: (state: Readonly<CampaignTurnState>, actor: Side, segment: CampaignLateSegment) => readonly string[] | undefined
  cleanupEndBlockers?: (state: Readonly<CampaignTurnState>, side: Side) => readonly string[] | undefined
  roundEnd?: (cleaned: Readonly<CampaignTurnState>) => CampaignRoundEnd | undefined
  /** 剧本终局 VP 结算（清理阶段 roundEnd 返回 ended 时写入 scenarioVictory；绑定层注入）。 */
  scenarioVictory?: (cleaned: Readonly<CampaignTurnState>) => CampaignScenarioVictory | undefined
  /** TTW §3.4a：弹幕标记目标格几何校验（邻接苏军战斗单位＋已编属 HQ 指挥半径内 throw）；绑定层注入。 */
  barrageMarkerTarget?: (state: Readonly<CampaignTurnState>, front: string, hex: string) => boolean
  /** 通规 §12.5c-A：编队燃料的编队归属判定（绑定层注入）。 */
  organicFormation?: (state: Readonly<CampaignTurnState>, id: string) => string | undefined
  /** TTW §3.5c：RVGK 入盒的战略可达判定（绑定层注入）。 */
  rvgkStratReachable?: (state: Readonly<CampaignTurnState>, id: string) => boolean
  /** TTW §3.5d A：轴心战斗单位判定（强制出盒触发/校验，绑定层注入）。 */
  rvgkAxisCombatUnit?: (state: Readonly<CampaignTurnState>, id: string) => boolean
  /** TTW §3.5d B：RVGK 释放的盘面事实（满编/最低编成维持/本回合入盒/独立单位编组，绑定层注入）。 */
  rvgkReleaseFacts?: (state: Readonly<CampaignTurnState>, id: string) =>
    { fullStrength: boolean; minimumsMaintained: boolean; enteredThisTurn: boolean; independent: boolean; withTankArmyHq: boolean; independentRe: number; truckOrTrackMa: boolean } | undefined
  /** TTW §2.4e：KG 合格单位判定（德军＋卡车/履带 MA，绑定层注入）。 */
  kgEligible?: (state: Readonly<CampaignTurnState>, id: string) => boolean
  /** TTW §2.4e：该 KG 本反应段是否实际移动/攻击（2T 落点判定，绑定层注入）。 */
  kgMovedOrAttacked?: (state: Readonly<CampaignTurnState>, id: string) => boolean
  /** TTW §2.2b：Luftflotte 空运的 HQ 当前格与目标格分类（绑定层注入）。 */
  luftflotteFacts?: (state: Readonly<CampaignTurnState>, targetHex: string) => { hqHex: string; friendlyHex: boolean; airBase: boolean } | undefined
  /** TTW §2.3a B：Kessel 免费移动盘面（资格/步事实/东西向，绑定层注入）。 */
  kesselBoard?: import('./campaign-kessel.ts').CampaignKesselBoard
  /** TTW §2.3c D：Army Group HQ 放 SP 事实（识别/战斗模式/移动初同格 SP/throw 半径，绑定层注入）。 */
  axisHqFacts?: (state: Readonly<CampaignTurnState>, id: string) => import('./campaign-axis-hq.ts').CampaignAxisHqFacts | undefined
  /** OCS 12.5e：HQ 法燃料的 throw 半径（绑定层注入；缺省则无法投到独立单位）。 */
  hqThrowRange?: (state: Readonly<CampaignTurnState>, id: string) => number | undefined
  /** 通规 3.2f：该单位是否为独立单位（HQ 法覆盖判定，绑定层注入）。 */
  hqFuelIndependent?: (state: Readonly<CampaignTurnState>, id: string) => boolean
  /** OCS 16.0b–c / 13.8d：工事劳动盘面（地图/工人事实/付款可达/上限，绑定层注入）。 */
  hedgehogWork?: import('./campaign-hedgehogs.ts').CampaignHedgehogBoard
  /** TTW §2.4a：要塞宣告盘面（城市归属/敌近/池中要塞/罗马尼亚境内，绑定层注入）。 */
  fortressBoard?: import('./campaign-fortress.ts').CampaignFortressBoard
  /** OCS 15.2–4：机场施工盘面（地图/工人/跑道池/付款可达，绑定层注入）。 */
  airfieldWork?: import('./campaign-airfield.ts').CampaignAirfieldBoard
  /** OCS 12.7a/d/e、5.7f：延补转换盘面（同格运输点数/落盘钩子，绑定层注入）。 */
  extenderWork?: import('./campaign-extender.ts').CampaignExtenderBoard
  /** OCS 9.14c：运输点夺取的落位钩子（绑定层注入）。 */
  transportCapture?: import('./campaign-transport-capture.ts').CampaignTransportCaptureBoard
  /** TTW §1.7b：特殊替换 "HH" 的 trace 盘面（绑定层注入）。 */
  specialHedgehog?: import('./campaign-special-hedgehog.ts').CampaignSpecialHedgehogBoard
}
