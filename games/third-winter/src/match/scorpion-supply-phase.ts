import type { Side } from '@ocs-eastern/series/state-types'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import { scorpionSupplyNetwork } from '../ttw/scorpion/supply-trace.ts'
import type { TraceOption } from '../ttw/scorpion/supply-trace.ts'
import type { ScorpionAttrition } from './scorpion-attrition.ts'
import { advanceScorpionPhase } from './scorpion-player-turn.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import { scorpionSupplyPosition } from './scorpion-supply-position.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'
import { scorpionSpPayment } from './scorpion-sp-payment.ts'

interface SplitFormation {
  formation: string
  members: readonly string[]
  anchors: readonly string[]
  selected?: string
}

export interface ScorpionSupplyWindow {
  trace: Readonly<Record<string, readonly TraceOption[]>>
  splits: readonly SplitFormation[]
  fed: readonly string[]
  traceExempt?: readonly string[]
  attrition: readonly ScorpionAttrition[] | null
}

export type FeedUnits = { type: 'feed-units'; payments: readonly {
  dumpId: string; portions: readonly { unitId: string; re: number }[]
}[] }

export function openScorpionSupply(
  state: Readonly<ScorpionInPlay>, side: Side, map: ScorpionMap, railroad?: SupplyRailBoard,
): ScorpionInPlay & { supply: ScorpionSupplyWindow } {
  if (state.cursor.phase !== 'movement' || state.supply) throw new Error('Scorpion supply is not due')
  const cursor = advanceScorpionPhase(state.cursor, side)
  if (!cursor || cursor.phase !== 'supply') throw new Error('Invalid supply transition')
  const network = scorpionSupplyNetwork(map, scorpionSupplyPosition(state, map, side, railroad))
  const units = Object.entries(state.units).filter(([, unit]) => unit.combat && unit.side === side)
  const traceExempt = units.filter(([id]) => state.dropTrace?.unitId === id && state.dropTrace.turn === cursor.turn)
    .map(([id]) => id)
  const trace = Object.fromEntries(units.map(([id, unit]) => [id, network.trace(unit.hex, unit.traceDrawMobility)]))
  const formations = new Map<string, string[]>()
  for (const [id, unit] of units) {
    if (!unit.formation || traceExempt.includes(id)) continue
    const members = formations.get(unit.formation) ?? []
    members.push(id)
    formations.set(unit.formation, members)
  }
  const splits: SplitFormation[] = []
  for (const [formation, members] of formations) {
    const anchorsByMember = members.map((id) => new Set(trace[id]?.map(traceAnchor)))
    const anchors = [...new Set(anchorsByMember.flatMap((choices) => [...choices]))]
    // A common source supplies the whole formation automatically. A split requires the player's choice.
    if (anchors.length && !anchors.some((anchor) => anchorsByMember.every((choices) => choices.has(anchor)))) {
      splits.push({ formation, members, anchors })
    }
  }
  // Single-counter fuel applies only during the phase in which it was spent.
  const withoutMovementFuel = Object.fromEntries(Object.entries(state.units).map(([id, unit]) =>
    [id, unit.side === side && unit.fueled ? { ...unit, fueled: false } : unit]))
  return { ...state, cursor, units: withoutMovementFuel, supply: { trace, splits, fed: [], attrition: null,
    ...(traceExempt.length ? { traceExempt } : {}) } }
}

function traceAnchor(option: TraceOption): string {
  return option.kind === 'direct' ? `direct:${option.source}` : `hq:${option.headquarters ?? option.from}`
}

export function hasTrace(window: Readonly<ScorpionSupplyWindow>, id: string): boolean {
  if (window.traceExempt?.includes(id)) return true
  const split = window.splits.find(({ members }) => members.includes(id))
  return window.trace[id]?.some((option) => !split || traceAnchor(option) === split.selected) === true
}

export function selectTraceAnchor(state: Readonly<ScorpionInPlay>, window: ScorpionSupplyWindow,
  formation: string, anchor: string): ScorpionInPlay {
  const choice = window.splits.find((item) => item.formation === formation)
  if (window.attrition !== null || window.fed.length || !choice?.anchors.includes(anchor)) {
    throw new Error('Choose an offered formation trace source before paying for supply')
  }
  return { ...state, supply: { ...window, splits: window.splits.map((item) =>
    item === choice ? { ...item, selected: anchor } : item) } }
}

export function readyForSupplyAllocation(window: Readonly<ScorpionSupplyWindow>) {
  if (window.attrition !== null || window.splits.some((split) => !split.selected)) {
    throw new Error('Resolve the formation trace choices before paying or checking attrition')
  }
}

export function feedScorpionUnits(state: Readonly<ScorpionInPlay>, window: ScorpionSupplyWindow,
  action: FeedUnits, map: ScorpionMap, railroad?: SupplyRailBoard): ScorpionInPlay {
  readyForSupplyAllocation(window)
  const side = state.cursor.phasing
  const ledger = scorpionSpPayment(state, side, map, railroad)
  const totals = new Map<string, number>()
  const used = new Set<string>()
  if (!action.payments.length) throw new Error('Allocate a payment to feed units')
  for (const { dumpId, portions } of action.payments) {
    if (used.has(dumpId) || !portions.length) throw new Error('Combine the allocated portions for each dump')
    used.add(dumpId)
    let reFromDump = 0
    for (const { unitId, re } of portions) {
      const unit = Object.hasOwn(state.units, unitId) ? state.units[unitId] : undefined
      if (!unit?.combat || unit.side !== side || typeof re !== 'number' || re <= 0 || !Number.isFinite(re) ||
        window.fed.includes(unitId) || hasTrace(window, unitId) ||
        !ledger.canUse(unit, dumpId)) throw new Error('Unit cannot eat from this supply source')
      reFromDump += re
      totals.set(unitId, (totals.get(unitId) ?? 0) + re)
    }
    const cost = Math.ceil(reFromDump / 2)
    ledger.spend([{ dumpId, tokens: cost }], () => true)
  }
  for (const [id, paid] of totals) {
    const unit = state.units[id]!
    if (paid !== unit.printedRe - unit.stepsLost) throw new Error('Supply must cover the current RE of each selected unit')
  }
  return { ...state, ...ledger.settle(), supply: { ...window, fed: [...window.fed, ...totals.keys()] } }
}
