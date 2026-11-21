import { campaignConsolidationBoxRejection } from '../ttw/campaign/consolidation.ts'
import type { CampaignConsolidationBox } from '../ttw/campaign/consolidation.ts'
import type { CampaignCounter } from './campaign-reinforcement-state.ts'

export function campaignConsolidationLocation(location: CampaignCounter['location'], resolveHex: (hex: string) => string | undefined,
  boxOf?: (id: string) => CampaignConsolidationBox | undefined): { key: string } | { reason: string } {
  if (location.kind === 'map') {
    const hex = resolveHex(location.hex)
    return hex ? { key: `map:${hex}` } : { reason: 'unknown-map-location' }
  }
  if (location.kind !== 'box') return { reason: 'unit-is-not-present' }
  const box = boxOf?.(location.box)
  if (!box) return { reason: 'unknown-box' }
  const rejection = campaignConsolidationBoxRejection(box)
  return rejection ? { reason: rejection } : { key: `box:${box.id}` }
}
