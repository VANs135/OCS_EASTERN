import type { loadKirovogradScenario } from '../import/kirovograd-scenario.ts'
import { resolveCampaignReference } from '../import/campaign-reference.ts'
import { kirovogradTruckMix } from '../ttw/campaign/kirovograd.ts'
import type { CampaignCounter } from './campaign-reinforcement-state.ts'

/** Truck Point markers name transport capacity. Physical supply stays in the dump ledger. */
export function kirovogradSetupTransports(data: Awaited<ReturnType<typeof loadKirovogradScenario>>) {
  const counters: Record<string, CampaignCounter> = {}
  for (const [index, marker] of data.otherMarkers.entries()) {
    if (marker.ref !== 'Truck Points') continue
    const mix = kirovogradTruckMix[marker.side]
    if (marker.count !== mix.points || !marker.hex || !data.map.resolveHex(marker.hex)) throw new Error('Unresolved Kirovograd Truck Points')
    let points = 0
    for (const [copy, ref] of mix.refs.entries()) {
      const match = resolveCampaignReference(data.catalog.aliases, ref, marker.side)
      if (!('definition' in match) || match.definition.kind !== 'transport' || match.definition.source.abilities?.includes('organic_truck')) {
        throw new Error(`Missing Kirovograd ordinary transport definition: ${ref}`)
      }
      const amount = match.definition.source.faces.combat?.stats.transport
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) throw new Error(`Missing transport denomination: ${ref}`)
      points += amount
      counters[`09:transport:${index + 1}:${copy + 1}`] = { definition: match.definition.key, kind: 'transport', side: marker.side,
        location: { kind: 'map', hex: marker.hex }, mode: 'combat', currentRe: 0, transportPoints: amount, transportCargoTokens: 0 }
    }
    if (points !== marker.count) throw new Error('Kirovograd transport definitions disagree with the scenario capacity')
  }
  return { counters, pendingMarkers: data.otherMarkers.filter(({ ref }) => ref !== 'Truck Points' && ref !== 'Railhead') }
}
