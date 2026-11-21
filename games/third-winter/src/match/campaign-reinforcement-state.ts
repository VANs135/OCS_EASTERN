import type { InternalStocks } from '@ocs-eastern/series/internal-stocks'
import type { Side } from '@ocs-eastern/series/state-types'
import type { Phase } from '@ocs-eastern/series/turn'
import type { CampaignArrivalSite } from '../ttw/campaign/arrival-sites.ts'
import type { CampaignReinforcementSchedule } from '../ttw/campaign/reinforcement.ts'

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
  counters: Readonly<Record<string, CampaignCounter>>
  settledOrders: readonly string[]
  scheduledWindow: 'open' | 'closed'
  /** TTW 1.7c. Debit these tokens from the next supply award for each side. */
  withdrawalSupplyDebt: Readonly<Record<Side, number>>
}

export interface CampaignReinforcementContext {
  schedule: CampaignReinforcementSchedule
  /** Reviewed order-to-instance bindings. A source row alone never creates a copy. */
  bindings: ReadonlyMap<string, readonly string[]>
  resolveHex(printed: string): string | undefined
  arrivalSites(state: Readonly<CampaignReinforcementState>): readonly CampaignArrivalSite[]
}

export type CampaignReinforcementAction =
  | { type: 'execute-scheduled-reinforcement'; orderId: string; placements?: readonly { counterId: string; hex: string }[] }
  | { type: 'complete-scheduled-reinforcements' }
