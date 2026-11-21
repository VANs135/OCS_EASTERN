export interface CampaignConsolidationBox {
  id: string
  kind: 'off-map' | 'rvgk'
}

/** TTW 3.5b: a counter in either RVGK box cannot consolidate. */
export function campaignConsolidationBoxRejection(box: Readonly<CampaignConsolidationBox>) {
  return box.kind === 'rvgk' ? 'consolidation-forbidden-in-rvgk' : null
}
