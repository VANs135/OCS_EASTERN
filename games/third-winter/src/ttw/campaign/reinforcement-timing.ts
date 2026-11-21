export interface CampaignReinforcementDate {
  scenarioId: string
  date: string
}

/** Scenario Book p.11. Both sides omit the two normal table rolls on this date in scenario 02. */
export function skipsCampaignReinforcementTables(when?: Readonly<CampaignReinforcementDate>) {
  return when?.scenarioId === '02-gotterdammerung' && when.date === '1944-01-26'
}
