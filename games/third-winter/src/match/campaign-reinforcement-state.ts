import type { InternalStocks } from '@ocs-eastern/series/internal-stocks'
import type { ReinforcementStep } from '@ocs-eastern/series/reinforcement'
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

export interface CampaignCounter {
  definition: string
  kind: 'land' | 'hq' | 'transport' | 'aircraft'
  side: Side
  location: { kind: 'map'; hex: string } | { kind: 'box'; box: string } | { kind: 'available' | 'dead-pile' | 'withdrawn' }
  active?: boolean
  currentRe?: number
  internalStocks?: InternalStocks
}

export interface CampaignReinforcementState {
  cursor: { turn: number; phasing: Side; phase: Phase }
  when?: CampaignReinforcementDate
  rng: RngState
  counters: Readonly<Record<string, CampaignCounter>>
  settledOrders: readonly string[]
  step: ReinforcementStep
  supplyAward?: CampaignSupplyAward
  /** TTW 1.7c. Debit these tokens from the next supply award for each side. */
  withdrawalSupplyDebt: Readonly<Record<Side, number>>
}

export interface CampaignReinforcementContext {
  schedule: CampaignReinforcementSchedule
  /** Reviewed order-to-instance bindings. A source row alone never creates a copy. */
  bindings: ReadonlyMap<string, readonly string[]>
  resolveHex(printed: string): string | undefined
  arrivalSites(state: Readonly<CampaignReinforcementState>): readonly CampaignArrivalSite[]
  /** Returns the approved Supply Table result in T, with date and table modifiers applied. */
  supplyTable?(state: Readonly<CampaignReinforcementState>, diceTotal: number): readonly CampaignSupplyPool[] | undefined
}

export type CampaignReinforcementAction =
  | { type: 'execute-scheduled-reinforcement'; orderId: string; placements?: readonly { counterId: string; hex: string }[] }
  | { type: 'complete-scheduled-reinforcements' }
  | { type: 'roll-campaign-supply' }
