import type { DeployedCounter } from '../import/scorpion-deployment.ts'
import { scorpionHexId } from '../import/hex-id.ts'
import type { ScorpionSetupAssets } from '../match/scorpion-setup.ts'
import type { ScorpionInPlay, ScorpionSession } from '../match/scorpion-session.ts'
import { hasScorpionBulkFuel } from '../match/scorpion-fuel.ts'
import { carriedScorpionTokens } from '../match/scorpion-sp-payment.ts'
import { scorpionOpeningAirBases } from '../ttw/scorpion/setup-stores.ts'
import { hexCounterPages } from './hex-counter-layout.ts'
import { scorpionHexLayout } from './scorpion-grid-layout.ts'
import { scorpionSupplyCounters } from './scorpion-supply-counters.ts'

interface CounterBadge {
  label: string
  asset?: string
  text?: string
}

export interface HexCounter {
  id: string
  hex: string
  asset: string
  label: string
  badges?: readonly CounterBadge[]
}

type Catalog = ScorpionSetupAssets['catalog']

export function scorpionMapStacks(state: Readonly<ScorpionSession>, catalog: Catalog, markers: readonly HexCounter[]) {
  const board = state.kind === 'playing' ? state : state.opening
  const mission = state.kind === 'playing' ? state.airMission : null
  const stacks = new Map<string, HexCounter[]>()
  const push = (counter: HexCounter, priority = false) => {
    const stack = stacks.get(counter.hex) ?? []
    if (priority) stack.unshift(counter)
    else stack.push(counter)
    stacks.set(counter.hex, stack)
  }
  for (const marker of markers) push(marker)
  if (state.kind === 'playing') for (const [hex, hedgehog] of Object.entries(state.hedgehogs ?? {})) {
    if (!hedgehog) continue
    const { side, level } = hedgehog
    const asset = markerFace(catalog, `Hedgehog ${level}`)
    if (!asset) throw new Error(`Missing level ${level} Hedgehog artwork`)
    push({ id: `hedgehog:${hex}`, hex, asset, label: `${side === 'axis' ? '轴心' : '苏军'} ${level} 级工事` })
  }
  if (state.kind === 'playing') for (const { hex, side } of state.trainbusting ?? []) {
    const asset = markerFace(catalog, side === 'axis' ? 'Trainbusting - Axis' : 'Trainbusting - Allied')
    if (!asset) throw new Error(`Missing Trainbusting artwork for ${side}`)
    push({ id: `trainbusting:${side}:${hex}`, hex, asset, label: `${side === 'axis' ? '轴心' : '苏军'}运输破坏` })
  }
  const markedReserveHexes = new Set<string>()
  for (const [id, unit] of Object.entries(board.units)) {
    const source = catalog.definitions.get(unit.definition)?.source
    const face = unit.moveMode ? source?.faces.move ?? (!unit.combat ? source?.faces.combat : undefined) : source?.faces.combat
    const asset = unit.extender?.asset ?? face?.asset
    if (!source || !asset) throw new Error(`Missing artwork for ground counter ${id}`)
    const label = unit.extender ? `延补队 ${unit.extender.range} MP` : unit.remnantOf ? '德军残部营' : source.name
    const reserveKey = `${unit.side}:${unit.hex}`
    const showPhysicalReserve = Boolean(unit.reserve) && !markedReserveHexes.has(reserveKey)
    if (showPhysicalReserve) markedReserveHexes.add(reserveKey)
    push({ id, hex: unit.hex, asset, label,
      badges: groundBadges(unit, catalog, state.kind === 'playing' && Boolean(hasScorpionBulkFuel(state, id)), showPhysicalReserve) })
  }
  for (const unit of board.pieces) {
    if (unit.kind !== 'aircraft' || unit.location.kind !== 'hex') continue
    const source = catalog.definitions.get(unit.definition)?.source
    const face = unit.reduced ? source?.faces.move : source?.faces.combat
    if (!source || !face?.asset) throw new Error(`Missing artwork for aircraft ${unit.id}`)
    const inFlight = mission && mission.step.kind !== 'return' && mission.target.kind === 'hex' &&
      mission.target.hex === unit.location.hex && (mission.flights.some(({ id }) => id === unit.id) || mission.interceptor?.id === unit.id)
    const returning = mission?.returning.includes(unit.id)
    const badges = returning ? [{ text: '返', label: '待返航' }]
      : unit.active === false ? [{ text: '停', label: '非激活' }]
        : inFlight ? [{ text: '飞', label: '执行空军任务' }] : []
    push({ id: unit.id, hex: unit.location.hex, asset: face.asset, label: source.name, badges }, Boolean(inFlight || returning))
  }
  const airfields: ScorpionInPlay['airBases'] = state.kind === 'playing' ? state.airBases : scorpionOpeningAirBases
  for (const { hex, side, level, strip } of airfields) {
    const asset = strip ? catalog.definitions.get(strip)?.source.faces.combat?.asset : markerFace(catalog, `Airbase Strength ${level}`)
    const label = `${side === 'axis' ? '轴心' : '苏军'} ${strip ? '简易跑道' : `${level} 级机场`}`
    if (asset) push({ id: `airfield:${side}:${hex}`, hex, asset, label })
  }
  for (const [id, dump] of Object.entries(board.dumps)) {
    if (dump.location !== 'on-map' || !dump.tokens) continue
    const hex = scorpionHexId(id.slice(`${dump.side}:hex:`.length))
    for (const counter of scorpionSupplyCounters(id, dump.tokens, catalog.aliases)) push({ ...counter, hex })
  }
  return [...stacks].map(([hex, counters]) => {
    const layout = scorpionHexLayout(hex)
    return { hex, ...layout, pages: hexCounterPages(counters, layout.scale) }
  })
}

function groundBadges(unit: DeployedCounter, catalog: Catalog, bulkFuel: boolean, showPhysicalReserve: boolean): CounterBadge[] {
  const badges: CounterBadge[] = []
  const add = (ref: string, label: string, text: string) => {
    const asset = markerFace(catalog, ref)
    badges.push(asset ? { label, asset } : { label, text })
  }
  if (unit.disorganized) add('DG (Disorganized)', '混乱', 'DG')
  if (unit.reserve) {
    if (showPhysicalReserve) add(unit.side === 'axis' ? 'Axis Reserve' : 'Sov Reserve', '预备', '预')
    else badges.push({ label: '同格预备堆叠', text: '预' })
  }
  if (unit.exploit) add(`Exploit ${unit.exploitRating ?? ''}`, '扩张', '扩')
  if (unit.outOfSupply) add('Out of Supply', '断补', '断')
  if (unit.internalStocks === 'low') add('Low/Exhausted', '部队储备低下', '低')
  if (unit.internalStocks === 'exhausted') add('Exhausted', '部队储备耗尽', '耗')
  if (unit.stepsLost) add(`Step Loss ${unit.stepsLost}`, `已损失 ${unit.stepsLost} 步`, String(unit.stepsLost))
  if (bulkFuel) badges.push({ label: '已获燃料，有效至己方整理', asset: unit.side === 'soviet' ? 'misc_fueled-Sv.png' : 'misc_fueled.png' })
  else if (unit.fueled) badges.push({ label: '本阶段已加油', text: '油' })
  if (unit.transportCargoTokens !== undefined || unit.organicTruck) {
    const tokens = carriedScorpionTokens(unit)
    const label = tokens ? `装载 ${tokens}T` : '空载'
    const organicArt = unit.organicTruck && tokens >= 1 && tokens <= 4 ? `${tokens === 4 ? 'F' : `${tokens}T`} Organic c.png` : undefined
    badges.push(organicArt ? { label, asset: organicArt } : { label, text: tokens ? `${tokens}T` : '空' })
  }
  return badges
}

function markerFace(catalog: Catalog, ref: string): string | undefined {
  const matches = catalog.aliases.get(ref)
  return matches?.length === 1 ? matches[0]!.source.faces.combat?.asset ?? undefined : undefined
}
