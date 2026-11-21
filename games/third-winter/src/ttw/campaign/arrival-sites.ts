import { airbaseActiveCapacity } from '@ocs-eastern/series/airbase'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignReinforcementOperation } from './reinforcement.ts'

interface Site { hex: string; side: Side }

export type CampaignArrivalSite =
  | (Site & { kind: 'army-hq' | 'army-group-hq'; detrainable: boolean })
  | (Site & { kind: 'front-hq' })
  | (Site & { kind: 'airbase'; inTrace: boolean; level: number })

type Arrival = Extract<CampaignReinforcementOperation, { kind: 'arrival' }>

export function supportsCampaignArrival({ channel }: Arrival) {
  return channel.kind === 'fixed-hex' || channel.kind === 'airbase' || channel.kind === 'front-hq' ||
    (channel.kind === 'army-or-army-group-hq' && !channel.panels && !channel.nation)
}

/** TTW 2.1b and 3.1b. The caller filters to open hexes within the scenario boundary. */
export function campaignArrivalCandidates({ channel }: Arrival, side: Side, aircraft: boolean, sites: readonly CampaignArrivalSite[]) {
  const choices = new Map<string, number>()
  if (channel.kind === 'airbase' && aircraft) {
    for (const site of sites) if (site.side === side && site.kind === 'airbase' && site.inTrace &&
      Number.isSafeInteger(site.level) && site.level >= 0 && site.level <= 3) {
      choices.set(site.hex, airbaseActiveCapacity(site.level))
    }
  }
  if (aircraft) return choices
  if (channel.kind === 'fixed-hex') choices.set(channel.hex, Infinity)
  for (const site of sites) {
    if (site.side !== side) continue
    if ((channel.kind === 'front-hq' && side === 'soviet' && site.kind === 'front-hq') ||
      (channel.kind === 'army-or-army-group-hq' && side === 'axis' && !channel.panels && !channel.nation &&
        (site.kind === 'army-hq' || site.kind === 'army-group-hq') && site.detrainable)) choices.set(site.hex, Infinity)
  }
  return choices
}
