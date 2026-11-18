import type { DeployedCounter } from '../import/scorpion-deployment.ts'
import { scorpionHexId } from '../import/hex-id.ts'
import type { ScorpionSetupAssets } from '../match/scorpion-setup.ts'
import type { ScorpionSession } from '../match/scorpion-session.ts'
import { scorpionOpeningAirBases } from '../ttw/scorpion/setup-stores.ts'
import { hexCounterPages } from './hex-counter-layout.ts'

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
  if (state.kind === 'playing') for (const { hex, side } of state.trainbusting ?? []) {
    const asset = markerFace(catalog, side === 'axis' ? 'Trainbusting - Axis' : 'Trainbusting - Allied')
    if (!asset) throw new Error(`Missing Trainbusting artwork for ${side}`)
    push({ id: `trainbusting:${side}:${hex}`, hex, asset, label: `${side === 'axis' ? '轴心' : '苏军'}运输破坏` })
  }
  for (const [id, unit] of Object.entries(board.units)) {
    const source = catalog.definitions.get(unit.definition)?.source
    const face = unit.moveMode ? source?.faces.move : source?.faces.combat
    if (!source || !face?.asset) throw new Error(`Missing artwork for ground counter ${id}`)
    push({ id, hex: unit.hex, asset: face.asset, label: source.name, badges: groundBadges(unit, catalog) })
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
  for (const { hex, side, level } of state.kind === 'playing' ? state.airBases : scorpionOpeningAirBases) {
    const asset = markerFace(catalog, `Airbase Strength ${level}`)
    if (asset) push({ id: `airfield:${side}:${hex}`, hex, asset, label: `${side === 'axis' ? '轴心' : '苏军'} ${level} 级机场` })
  }
  for (const [id, dump] of Object.entries(board.dumps)) {
    if (dump.location !== 'on-map' || !dump.tokens) continue
    const hex = scorpionHexId(id.slice(`${dump.side}:hex:`.length))
    let tokens = dump.tokens
    let copy = 0
    while (tokens > 0) {
      const points = Math.min(5, Math.floor(tokens / 4))
      const used = points ? points * 4 : tokens
      const label = points ? `${points} SP` : `${used}T`
      const ref = points ? `Supply Point ${points}` : `Supply Ton ${used}T`
      const asset = markerFace(catalog, ref)
      if (!asset) throw new Error(`Missing supply counter ${ref}`)
      push({ id: `${id}:${++copy}`, hex, asset, label })
      tokens -= used
    }
  }
  return [...stacks].map(([hex, counters]) => ({
    hex, ...scorpionArtworkHexCenter(hex), pages: hexCounterPages(counters),
  }))
}

function groundBadges(unit: DeployedCounter, catalog: Catalog): CounterBadge[] {
  const badges: CounterBadge[] = []
  const add = (ref: string, label: string, text: string) => {
    const asset = markerFace(catalog, ref)
    badges.push(asset ? { label, asset } : { label, text })
  }
  if (unit.disorganized) add('DG (Disorganized)', '混乱', 'DG')
  if (unit.reserve) add(unit.side === 'axis' ? 'Axis Reserve' : 'Sov Reserve', '预备', '预')
  if (unit.exploit) add(`Exploit ${unit.exploitRating ?? ''}`, '扩张', '扩')
  if (unit.outOfSupply) add('Out of Supply', '断补', '断')
  if (unit.internalStocks === 'low') add('Low/Exhausted', '内部补给低下', '低')
  if (unit.internalStocks === 'exhausted') add('Exhausted', '内部补给耗尽', '耗')
  if (unit.stepsLost) add(`Step Loss ${unit.stepsLost}`, `已损失 ${unit.stepsLost} 步`, String(unit.stepsLost))
  if (unit.fueled) badges.push({ label: '本阶段已加油', text: '油' })
  if (unit.transportCargoTokens !== undefined) badges.push({ label: `装载 ${unit.transportCargoTokens}T`,
    text: unit.transportCargoTokens ? `${unit.transportCargoTokens}T` : '空' })
  else if (unit.organicTruck) badges.push({ label: unit.organicTruck === 'full' ? '编内卡车满载' : '编内卡车空载',
    text: unit.organicTruck === 'full' ? '满' : '空' })
  return badges
}

function markerFace(catalog: Catalog, ref: string): string | undefined {
  const matches = catalog.aliases.get(ref)
  return matches?.length === 1 ? matches[0]!.source.faces.combat?.asset ?? undefined : undefined
}

function scorpionArtworkHexCenter(hex: string) {
  const [col, row] = scorpionHexId(hex).slice(1).split('.').map(Number) as [number, number]
  return { x: 55 + (col + 4) * 93, y: 41 + (17 - row) * 107.4 - (col % 2 === 0 ? 53.7 : 0) }
}
