import { internalRecoveryPerLevel } from '@ocs-eastern/series/internal-stocks'
import type { Mobility } from '@ocs-eastern/series/ground-map'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignGroundMovementBoard } from './campaign-movement-board.ts'
import type { CampaignCounter } from './campaign-reinforcement-state.ts'
import { campaignPhysicalSupply } from './campaign-supply-ledger.ts'
import type { CampaignSupplySource } from './campaign-supply-ledger.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export interface CampaignSupplyUnit {
  steps: number
  rating: number
  multiStep: boolean
  formation?: string
  traceExempt?: boolean
}

export interface CampaignSupplyPhaseBoard {
  profile(state: Readonly<CampaignTurnState>, id: string): CampaignSupplyUnit | undefined
  organicTransportFormation?(state: Readonly<CampaignTurnState>, id: string): string | undefined
  reAfterLoss(state: Readonly<CampaignTurnState>, id: string, losses: number): number | undefined
}

interface CampaignSupplyUnitPosition {
  counter: CampaignCounter
  hex: string
  rules: CampaignSupplyUnit
  re: number
  mobility: Mobility
}

export function campaignSupplyPosition(state: Readonly<CampaignTurnState>, side: Side, phase?: CampaignSupplyPhaseBoard,
  board?: CampaignGroundMovementBoard) {
  const trace = board?.traceSupply?.(state, side)
  if (!phase || !board || !trace) return undefined
  const units = new Map<string, CampaignSupplyUnitPosition>()
  for (const [id, { hex, profile }] of trace.ground.friendly) {
    if (!profile.combat) continue
    const counter = state.counters[id]!
    const rules = phase.profile(state, id)
    const re = counter.currentRe
    if (!rules || !Number.isSafeInteger(rules.steps) || rules.steps < 1 || !Number.isSafeInteger(rules.rating) ||
      rules.rating < 0 || rules.rating > 5 || re === undefined || !Number.isFinite(re) || re <= 0) return undefined
    units.set(id, { counter, hex, rules, re, mobility: profile.drawMobility })
  }
  const sources = campaignPhysicalSupply(state, side, board.map, phase.organicTransportFormation)
  const canUse = (id: string, key: string, reserved?: CampaignSupplySource) => {
    const unit = units.get(id)
    const source = sources.get(key)
    const hex = source?.hex ?? (reserved?.kind === 'dump' ? board.map.resolveHex(reserved.hex) : undefined)
    return !!unit && !!hex && (!source?.formation || source.formation === unit.rules.formation) &&
      trace.network.canUseDump(unit.hex, hex, unit.mobility)
  }
  return { units, sources, canUse, resolveHex: board.map.resolveHex, network: trace.network }
}

export type CampaignSupplyPosition = NonNullable<ReturnType<typeof campaignSupplyPosition>>

export function campaignRecoveryCost(unit: CampaignSupplyUnitPosition) {
  return Math.round(internalRecoveryPerLevel(unit.rules.multiStep ? unit.re : 1))
}

export function campaignRecoveryDuties(position: CampaignSupplyPosition) {
  const unitIds: string[] = []
  const remainder = new Map<string, number>()
  for (const [id, unit] of position.units) {
    if (!unit.counter.internalStocks) continue
    let available = 0
    for (const [key, source] of position.sources) {
      if (source.formation || !position.canUse(id, key)) continue
      available += source.tokens
      remainder.set(key, source.tokens)
    }
    if (available >= campaignRecoveryCost(unit)) unitIds.push(id)
  }
  return { unitIds, remainder }
}
