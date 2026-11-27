import type { CampaignRailBoard } from './campaign-rail-transport.ts'

/** Scenario Book p.62: Kirovograd has no Axis rail capacity; 09 terrain has no rail movement. */
export const kirovogradRailCapacity = 0

/** Bind the scenario's zero rail capacity to the shared OCS rail-transport checks. */
export function kirovogradRailBoard(): CampaignRailBoard {
  return {
    capacity: () => kirovogradRailCapacity,
    ordinaryCargo: () => false,
    controlBlocksAt: () => true,
    trainbustingAt: () => false,
  }
}
