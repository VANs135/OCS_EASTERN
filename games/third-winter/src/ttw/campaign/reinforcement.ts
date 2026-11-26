import type { Side } from '@ocs-eastern/series/state-types'
import type { Phase } from '@ocs-eastern/series/turn'
import type { CampaignReferenceIssue } from '../../import/campaign-reference.ts'
import type { CatalogKind } from '../../import/unit-catalog.ts'

type ArrivalChannel =
  | { kind: 'army-or-army-group-hq'; panels?: 'AB' | 'CD'; nation?: 'hungarian' }
  | { kind: 'front-hq' | 'airbase' | 'detrainable-hex' | 'rvgk' }
  | { kind: 'fixed-hex'; hex: string; printedHex: string }
  /** TTW 4.1. The 58th Panzer Corps option enters at Lvov or on the western map edge within the given hexes of it. */
  | { kind: 'lvov-west-edge'; radius: number }

export type CampaignReinforcementOperation =
  | { kind: 'arrival'; channel: ArrivalChannel }
  | { kind: 'withdraw' | 'dead-pile' }

interface ReinforcementSource {
  id: string
  row: number
  entry: number | null
  side: Side
  turn: number
  date: string
  sourceDate: string | null
  sourceChannel: string
  ref: string | null
  note: string | null
}

type ReinforcementIssue = CampaignReferenceIssue | 'empty-group' | 'marker' | 'narrative' | 'unclassified-channel' |
  'missing-entry-hex' | 'outside-scenario'

export type CampaignReinforcementClassification =
  | { status: 'classified'; operation: CampaignReinforcementOperation; definition: string; counterKind: CatalogKind }
  | { status: 'pending'; issue: ReinforcementIssue; definition?: string; counterKind?: CatalogKind }

export type CampaignReinforcement = ReinforcementSource & CampaignReinforcementClassification

export type CampaignReinforcementSchedule = ReadonlyMap<number, Readonly<Record<Side, readonly CampaignReinforcement[]>>>

/** Reads the phasing player's orders for the current window. Classification does not apply an order. */
export function campaignReinforcementWindow(
  schedule: CampaignReinforcementSchedule,
  cursor: { turn: number; phasing: Side; phase: Phase },
): readonly CampaignReinforcement[] {
  return cursor.phase === 'reinforcement' ? schedule.get(cursor.turn)?.[cursor.phasing] ?? [] : []
}
