import type { InternalStocks } from '@ocs-eastern/series/internal-stocks'
import type { ReinforcementSegment } from '@ocs-eastern/series/reinforcement'
import type { DiceRoll, RngState, Side } from '@ocs-eastern/series/state-types'
import type { Phase } from '@ocs-eastern/series/turn'
import type { CampaignArrivalSite } from '../ttw/campaign/arrival-sites.ts'
import type { CampaignReinforcementSchedule } from '../ttw/campaign/reinforcement.ts'
import type { CampaignReinforcementDate } from '../ttw/campaign/reinforcement-timing.ts'

export interface CampaignSupplyPool {
  kind: 'axis-cities' | 'axis-hq' | 'soviet-supply'
  tokens: number
}

export type CampaignSupplyAward = { dice: DiceRoll; pools: readonly CampaignSupplyPool[]; grossTokens: number } & (
  | { status: 'awaiting-placement'; withheldTokens: number; tokensToPlace: number }
  | { status: 'deduction-pending'; requiredTokens: number }
)

export interface CampaignSupplyPlacementPlan {
  pool: CampaignSupplyPool['kind']
  tokens: number
  sites: readonly { hex: string; side: Side; minTokens?: number; maxTokens: number }[]
}

export interface CampaignReplacementAward {
  pax: number
  air: number
  eq: readonly number[]
  ally: number
  special: boolean
}

export type CampaignSpecialReplacement = 'artillery' | 'assault' | 'flak' | 'aa' | 'hedgehog' | 'hq' | 'pontoon' | 'alert' | 'tiger'
export type CampaignReinforcementCheck = 'supply' | 'replacements' | 'special-replacement'
export interface CampaignReinforcementRoll {
  check: CampaignReinforcementCheck
  side: Side
  turn: number
  phase: Phase
  segment: ReinforcementSegment
  step: 'roll-supply' | 'roll-replacements' | 'roll-special-replacement'
  dice: DiceRoll
  before: number
  after: number
}

export interface CampaignCounter {
  definition: string
  kind: 'land' | 'hq' | 'transport' | 'aircraft'
  side: Side
  location: { kind: 'map'; hex: string } | { kind: 'box'; box: string } | { kind: 'breakout-return'; turn: number }
    | { kind: 'available' | 'dead-pile' | 'withdrawn' }
  active?: boolean
  currentRe?: number
  internalStocks?: InternalStocks
}

export interface CampaignBoardState {
  rng: RngState
  counters: Readonly<Record<string, CampaignCounter>>
  supplyDumps: Readonly<Record<Side, Readonly<Record<string, number>>>>
  /** TTW 1.7c. Debit these tokens from the next supply award for each side. */
  withdrawalSupplyDebt: Readonly<Record<Side, number>>
}

export interface CampaignReinforcementWindow {
  settledOrders: readonly string[]
  segment: ReinforcementSegment
  supplyAward?: CampaignSupplyAward
  replacementAward?: CampaignReplacementAward
  specialReplacements?: readonly CampaignSpecialReplacement[]
  rolls: readonly CampaignReinforcementRoll[]
}

export interface CampaignReinforcementState extends CampaignBoardState, CampaignReinforcementWindow {
  cursor: { turn: number; phasing: Side; phase: Phase }
  when?: CampaignReinforcementDate
}

export interface CampaignReinforcementContext {
  schedule: CampaignReinforcementSchedule
  /** Reviewed order-to-instance bindings. A source row alone never creates a copy. */
  bindings: ReadonlyMap<string, readonly string[]>
  resolveHex(printed: string): string | undefined
  arrivalSites(state: Readonly<CampaignReinforcementState>): readonly CampaignArrivalSite[]
  /** Returns the approved Supply Table result in T, with date and table modifiers applied. */
  supplyTable?(state: Readonly<CampaignReinforcementState>, diceTotal: number): readonly CampaignSupplyPool[] | undefined
  /** Game-specific quotas and legal locations, including an approved distribution of any withheld tokens. */
  supplyPlacementPlan?(state: Readonly<CampaignReinforcementState>): readonly CampaignSupplyPlacementPlan[] | undefined
  replacementTable?(state: Readonly<CampaignReinforcementState>, diceTotal: number): CampaignReplacementAward | undefined
  specialReplacementTable?(state: Readonly<CampaignReinforcementState>, face: number): readonly CampaignSpecialReplacement[] | undefined
}

export type CampaignReinforcementAction =
  | { type: 'execute-scheduled-reinforcement'; orderId: string; placements?: readonly { counterId: string; hex: string }[] }
  | { type: 'complete-scheduled-reinforcements' }
  | { type: 'roll-campaign-supply' }
  | { type: 'place-campaign-supply'; placements: readonly { pool: CampaignSupplyPool['kind']; hex: string; tokens: number }[] }
  | { type: 'roll-campaign-replacements' }
  | { type: 'roll-campaign-special-replacement' }
