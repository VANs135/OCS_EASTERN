import { reserveMovementFactor } from './reserve.ts'
import type { Side } from './state-types.ts'
import type { Phase } from './turn.ts'

// OCS 通规 5.0–5.10 单位模式（作品/剧本中立）。
// 数值矩阵与合法性层移植自斯摩棱斯克 src/engine/rules/modes.ts（已逐条对照通规 v4.3 中文规则书）；
// 斯摩棱斯克专规（2.3e 苏军战略模式日期闸门、1.5 首回合 MA 折半、4.1a 可选忽略）不内置，
// 改由调用方以注入式谓词提供（见 canSwitchMode 的 operationalLimit / canSetModeAtSetup）。
// 结构口径：基础模式＝朝向面（combat/move），至多一个层叠标记（reserve/strat/exploit/dg，通规 5.4a/5.10）。

export type GroundFace = 'combat' | 'move'
type MarkedMode = 'reserve' | 'strat' | 'exploit' | 'dg'

export interface GroundModeState {
  face: GroundFace
  marker?: MarkedMode
  released?: boolean
}

const baseEffect = {
  attackFactor: 1, defenseFactor: 1, barrageFactor: 1, actionRatingModifier: 0,
  canAttack: true, canBarrage: true, canOverrun: true,
}
const markerEffects = {
  reserve: { ...baseEffect, defenseFactor: 0.5, canAttack: false, canBarrage: false, canOverrun: false },
  strat: { ...baseEffect, attackFactor: 0, defenseFactor: 0, barrageFactor: 0,
    canAttack: false, canBarrage: false, canOverrun: false },
  exploit: baseEffect,
  dg: { ...baseEffect, attackFactor: 0.5, defenseFactor: 0.5, barrageFactor: 0.5,
    actionRatingModifier: -1, canOverrun: false },
} satisfies Record<MarkedMode, typeof baseEffect>

/** 通规 5.7b：已释放的预备视同无标记，效果折回朝向那一面。 */
export function activeMarker({ marker, released }: GroundModeState): MarkedMode | null {
  if (marker === 'reserve' && released === true) return null
  return marker ?? null
}

/** 通规 5.4a：生效模式（被动标记替代当前模式；无标记即基础面）。 */
export function effectiveMode(state: GroundModeState): GroundFace | MarkedMode {
  return activeMarker(state) ?? state.face
}

export function groundModeEffect(state: GroundModeState) {
  const marker = activeMarker(state)
  return {
    ...(marker ? markerEffects[marker] : baseEffect),
    keepsCombatZoc: state.face === 'combat' && (marker === null || marker === 'exploit'),
    actionRatingFactor: marker === 'strat' ? 0 : 1,
  }
}

/** Movement budget for an eligible unit. Phase/side permission is checked at the command boundary. */
export function groundModeMovementFactor({ marker, released }: GroundModeState, phase: Phase): number {
  if (marker === 'dg' || marker === 'exploit') return 0.5
  if (marker === 'strat') return 2
  // 通规 5.7b：已释放的预备不再按"预备未释放"计，而按释放后的阶段倍率（反应 ×1/2、进击 ×1）。
  const inReserve = marker === 'reserve' && released !== true
  return reserveMovementFactor(phase, inReserve, released === true)
}

/* ── 移动环节阶段（通规 2.2 流程表 C/E/G） ─────────────────────────── */
export type MovementSegmentPhase = 'movement' | 'reaction' | 'exploitation'

/* ── 单位类别（只为模式合法性服务，通规 5.5c/5.6b/5.7f/5.8c/6.1b/13.2d） ── */
export type ModeUnitClass = 'combat' | 'repl' | 'transportPoint' | 'organicTruck' | 'facility'
export interface ModeUnitProfile {
  isCombat?: boolean
  specialized?: readonly string[]
  noncombatKind?: string | null
  ma?: number | null
}
export function modeUnitClass(profile: ModeUnitProfile): ModeUnitClass {
  const kind = profile.noncombatKind ?? null
  if (kind === 'sp' || kind === 'air_base' || kind === 'hedgehog' || kind === 'port') return 'facility'
  if (kind === 'organic_truck') return 'organicTruck'
  if (kind === 'transport_point' || kind === 'supply_extender') return 'transportPoint'
  if ((profile.specialized ?? []).includes('replacement')) return 'repl'
  return 'combat'
}
/** 6.1b：无 MA 设施不可移动或撤退。 */
export function isMobileUnit(profile: ModeUnitProfile): boolean {
  if (modeUnitClass(profile) === 'facility') return false
  return (profile.ma ?? 0) > 0
}

/* ── 矩阵派生判定 ─────────────────────────────────────────────────── */
/** 通规 4.5/5.5e/5.9c：是否投射 ZOC（进击保留基础面；DG/预备/战略一律无）。 */
export function exertsZoc(state: GroundModeState): boolean {
  return groundModeEffect(state).keepsCombatZoc
}
/** 通规 5.6a：能否铁路/空运/海运（须处于移动模式）。 */
export function canUseTransport(state: GroundModeState): boolean {
  return activeMarker(state) === null && state.face === 'move'
}
/** 通规 5.5b/5.10e：能否工程/轨距转换（战斗模式；DG 朝向战斗面即可）。 */
export function canEngineer(state: GroundModeState): boolean {
  const marker = activeMarker(state)
  if (marker === 'dg') return state.face === 'combat'
  return marker === null && state.face === 'combat'
}
export function canConvertGauge(state: GroundModeState): boolean {
  return canEngineer(state)
}
/** 通规 5.7g/16.0f：预备模式不可与环形工事堆叠。 */
export function canStackWithHedgehog(state: GroundModeState): boolean {
  return activeMarker(state) !== 'reserve'
}
/** 通规 5.8b/12.6e：战略模式必须在有追溯补给的格结束移动。 */
export function mustEndMoveInSupply(state: GroundModeState): boolean {
  return activeMarker(state) === 'strat'
}

/* ── 模式状态不变量（通规 5.10/5.9/5.8/5.5/5.6/5.10c） ─────────────── */
export type ModeIssue = 'stratMustFaceMove' | 'baseModeFaceMismatch' | 'transportPointInDg'
export function validateModeState(state: GroundModeState, unitClass?: ModeUnitClass): ModeIssue[] {
  const issues: ModeIssue[] = []
  // 单标记结构已排除 dg+exploit/dg+reserve 等叠加；此处校验朝向与类别约束。
  if (state.marker === 'strat' && state.face !== 'move') issues.push('stratMustFaceMove')
  if (unitClass === 'transportPoint' && state.marker === 'dg') issues.push('transportPointInDg')
  return issues
}

/* ── 阶段可动性（通规 6.0/6.3a/7.0a/11.0a） ────────────────────────── */
export interface PhaseMoveInput { state: GroundModeState; side: Side; activeSide: Side }
export type ModeVerdict = { ok: true; rule?: string } | { ok: false; rule: string; reason: string }
export function canMoveInPhase(input: PhaseMoveInput, phase: MovementSegmentPhase): ModeVerdict {
  const { state, side, activeSide } = input
  if (phase === 'movement') {
    if (side !== activeSide) return { ok: false, rule: '6.0', reason: '移动阶段只能移动当前阶段玩家的地面单位' }
    return { ok: true }
  }
  if (phase === 'reaction') {
    if (side === activeSide) return { ok: false, rule: '6.3a', reason: '反应阶段只能移动非阶段玩家的单位' }
    if (state.released !== true) return { ok: false, rule: '7.0a', reason: '反应阶段只有被释放的预备单位可以移动' }
    return { ok: true }
  }
  if (side !== activeSide) return { ok: false, rule: '11.0a', reason: '进击阶段只能移动当前阶段玩家的单位' }
  if (state.marker !== 'exploit' && state.released !== true) {
    return { ok: false, rule: '11.0a', reason: '进击阶段只有进击模式单位或被释放的预备可以移动' }
  }
  return { ok: true }
}

/* ── 释放预备（通规 5.7b） ────────────────────────────────────────── */
export interface ReserveReleaseInput { state: GroundModeState; side: Side; activeSide: Side; phase: MovementSegmentPhase }
export function canReleaseReserve(input: ReserveReleaseInput):
  { ok: true; rule: string; state: GroundModeState; maMult: number } | { ok: false; rule: string; reason: string } {
  const { state, side, activeSide, phase } = input
  if (phase === 'reaction') {
    if (side === activeSide) return { ok: false, rule: '6.3a', reason: '反应阶段只能由非阶段玩家释放自己的预备' }
  } else if (phase === 'exploitation') {
    if (side !== activeSide) return { ok: false, rule: '11.0a', reason: '进击阶段只能由阶段玩家释放自己的预备' }
  } else {
    return { ok: false, rule: '5.7b', reason: '只在反应/进击阶段释放预备' }
  }
  if (state.marker !== 'reserve') return { ok: false, rule: '5.7b', reason: '该单位不处于预备模式，无需释放' }
  if (state.released === true) return { ok: false, rule: '5.7b', reason: '该单位本阶段已经释放过了' }
  const released: GroundModeState = { ...state, released: true }
  return { ok: true, rule: '5.7b', state: released, maMult: groundModeMovementFactor(released, phase) }
}
/** 通规 5.7b：换阶段即清除「本阶段刚释放」时点事实。 */
export function clearReleased(state: GroundModeState): GroundModeState {
  return state.released === true ? { ...state, released: false } : state
}

/* ── 被动模式施加（通规 5.10/5.10c） ──────────────────────────────── */
export type MarkersAfterDg = 'dgOnly' | 'loseReserveMarkerOnly'
export function markersAfterDg(unit: { unitClass: ModeUnitClass; state: GroundModeState }): MarkersAfterDg {
  return unit.unitClass === 'transportPoint' ? 'loseReserveMarkerOnly' : 'dgOnly'
}

/* ── 模式切换合法性（通规 5.4/4.5a/5.5c/5.7c/f/5.8a/c；专规闸门注入） ── */
export interface ModeSwitchRequest {
  to: GroundFace | 'reserve' | 'strat'
  orientation: GroundFace
  inEnemyZoc: boolean
  unitClass: ModeUnitClass
  side: Side
  phase: MovementSegmentPhase
  adjacentEnemyAttackCapable?: boolean
  /** 作品专规闸门（如 TTW 操作限制）；缺省不启用任何专规限制。 */
  operationalLimit?: (req: ModeSwitchRequest) => ModeVerdict | null
}
export function canSwitchMode(req: ModeSwitchRequest): ModeVerdict {
  if (req.phase !== 'movement') return { ok: false, rule: '5.4', reason: '主动模式切换只能在本方移动阶段进行' }
  if (req.to === 'strat' && req.orientation !== 'move') return { ok: false, rule: '5.8', reason: '战略模式朝向必须是移动面' }
  if (req.to === 'combat' && req.orientation !== 'combat') return { ok: false, rule: '5.5', reason: '进入战斗模式必须朝向战斗面' }
  if (req.to === 'move' && req.orientation !== 'move') return { ok: false, rule: '5.6', reason: '进入移动模式必须朝向移动面' }
  if (req.unitClass === 'facility') return { ok: false, rule: '6.1b', reason: '无 MA 设施不可移动或撤退' }
  if (req.to === 'combat' && (req.unitClass === 'repl' || req.unitClass === 'transportPoint')) {
    return { ok: false, rule: '5.5c', reason: '补员单位与运输点数不能进入战斗模式' }
  }
  if (req.to === 'reserve' && req.unitClass === 'transportPoint') return { ok: false, rule: '5.7f', reason: '运输点数不允许进入预备模式（编内卡车除外）' }
  if (req.to === 'strat' && req.unitClass === 'transportPoint') return { ok: false, rule: '5.8c', reason: '运输点数不能进入战略模式' }
  if (req.adjacentEnemyAttackCapable === true && (req.to === 'reserve' || req.to === 'strat')) {
    return { ok: false, rule: 'IV-B', reason: '初设时与敌方攻击力单位相邻，不能设为预备或战略模式' }
  }
  if (req.to === 'reserve' && req.inEnemyZoc) return { ok: false, rule: '5.7c', reason: '不可在敌方 ZOC 内进入预备模式' }
  if (req.to === 'strat' && req.inEnemyZoc) return { ok: false, rule: '5.8a', reason: '不可在敌方 ZOC 内进入战略模式' }
  const special = req.operationalLimit?.(req)
  if (special && !special.ok) return special
  return { ok: true }
}
/** 通规 5.4：模式切换不消耗 MP。 */
export function modeSwitchCost(): number {
  return 0
}

/* ── 朝向翻转（通规 5.4 末句/5.7a/5.8） ───────────────────────────── */
export interface OrientationFlipInput { state: GroundModeState; phase: MovementSegmentPhase; enteredReserveThisTurn?: boolean }
export function canFlipOrientation(input: OrientationFlipInput): ModeVerdict {
  const { state, phase } = input
  if (phase !== 'movement') return { ok: false, rule: '5.4', reason: '改变朝向只能在本方移动阶段进行' }
  const marker = activeMarker(state)
  if (marker === 'dg') return { ok: true, rule: '5.4' }
  if (marker === 'reserve') {
    if (input.enteredReserveThisTurn === true) return { ok: false, rule: '5.7a', reason: '本回合刚进入预备，该朝向在下一个移动阶段之前无法再切换' }
    return { ok: true, rule: '5.7a' }
  }
  if (marker === 'strat') return { ok: false, rule: '5.8', reason: '战略模式朝向必须是移动面，不可更改' }
  return { ok: false, rule: '5.5/5.6', reason: '战斗/移动模式下朝向即模式本身，改朝向请用模式切换' }
}
export function flipOrientation(state: GroundModeState): GroundModeState {
  const face: GroundFace = state.face === 'combat' ? 'move' : 'combat'
  if (state.marker === undefined) return { ...state, face }
  return { ...state, face }
}

/* ── 按模式改写数值（通规 5.5–5.10；减半不取整 6.1h） ─────────────── */
export interface UnitRawStats { attack: number; ar: number; ma: number; barrage?: number }
export function resolveModeStats(raw: UnitRawStats, state: GroundModeState, phase: MovementSegmentPhase) {
  const effect = groundModeEffect(state)
  const marker = activeMarker(state)
  const isStrat = marker === 'strat'
  const maMult = groundModeMovementFactor(state, phase)
  return {
    attack: isStrat ? 0 : raw.attack * effect.attackFactor,
    defense: isStrat ? 0 : raw.attack * effect.defenseFactor,
    ar: isStrat ? 0 : raw.ar + effect.actionRatingModifier,
    ma: raw.ma * maMult,
    barrage: isStrat || raw.barrage === undefined ? undefined : raw.barrage * effect.barrageFactor,
    canAttack: effect.canAttack,
    canBarrage: effect.canBarrage,
    canOverrun: effect.canOverrun,
    exertsZoc: exertsZoc(state),
    disorganized: marker === 'dg',
    maMultiplier: maMult,
    effectiveMode: effectiveMode(state),
  }
}