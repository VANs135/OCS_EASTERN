import type { SupplyTraceOption } from '@ocs-eastern/series/supply-network'
import type { CampaignSupplyPosition } from './campaign-supply-stock.ts'

export interface CampaignFormationTrace {
  formation: string
  members: readonly string[]
  anchors: readonly string[]
  selected?: string
}

export interface CampaignFeeding {
  trace: Readonly<Record<string, readonly SupplyTraceOption[]>>
  exempt: readonly string[]
  formations: readonly CampaignFormationTrace[]
  fed: readonly string[]
  reBySource: Readonly<Record<string, number>>
}

const anchor = (option: SupplyTraceOption) => option.kind === 'direct' ? `direct:${option.source}` : `hq:${option.headquarters ?? option.from}`

/** OCS 12.6f. Reuse the direct or HQ source distinction from the Scorpion supply window. */
export function openCampaignFeeding(position: CampaignSupplyPosition): CampaignFeeding {
  const trace = Object.fromEntries([...position.units].map(([id, unit]) => [id, position.network.trace(unit.hex, unit.mobility)]))
  const exempt: string[] = []
  const byFormation = new Map<string, string[]>()
  for (const [id, { rules }] of position.units) {
    if (rules.traceExempt) exempt.push(id)
    else if (rules.formation) {
      const members = byFormation.get(rules.formation) ?? []
      members.push(id)
      byFormation.set(rules.formation, members)
    }
  }
  const formations = [...byFormation].flatMap(([formation, members]) => {
    const byUnit = members.map((id) => new Set(trace[id]!.map(anchor)))
    const anchors = [...new Set(byUnit.flatMap((choices) => [...choices]))]
    return anchors.length && !anchors.some((candidate) => byUnit.every((choices) => choices.has(candidate)))
      ? [{ formation, members, anchors }] : []
  })
  return { trace, exempt, formations, fed: [], reBySource: {} }
}

export function hasCampaignSupplyTrace(feeding: CampaignFeeding, id: string): boolean {
  if (feeding.exempt.includes(id)) return true
  const split = feeding.formations.find(({ members }) => members.includes(id))
  return feeding.trace[id]?.some((option) => !split || anchor(option) === split.selected) === true
}
