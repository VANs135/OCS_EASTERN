import type { SupplyNetworkBoard } from '@ocs-eastern/series/supply-network'
import { khersonFerryBanks } from '../ttw/campaign/kherson-ferry.ts'
import type { CampaignGroundMap } from './campaign-ground-position.ts'

/** Add the ferry to rail tracing without adding a ground hexside or a rail transport route. */
export function campaignKhersonRailTrace(map: CampaignGroundMap, ice: boolean,
  railCanTrace: SupplyNetworkBoard['railCanTrace']): Pick<SupplyNetworkBoard, 'railCanTrace' | 'railNeighbors'> {
  const banks = khersonFerryBanks((hex) => map.resolveHex(hex))
  if (!banks) return { railCanTrace }
  const [first, second] = banks
  const opposite = (hex: string) => hex === first ? second : hex === second ? first : undefined
  return {
    railCanTrace(from, to) { return opposite(from) === to ? !ice : railCanTrace(from, to) },
    railNeighbors(hex) {
      const neighbors = map.neighbors(hex)
      const bank = opposite(hex)
      return !ice && bank && !neighbors.includes(bank) ? [...neighbors, bank] : neighbors
    },
  }
}
