import type { loadKirovogradScenario } from '../import/kirovograd-scenario.ts'
import { kirovogradAxisReceivesSupply, kirovogradAxisSupplyPerHq, kirovogradDates, kirovogradScenario,
  kirovogradSovietSupplyTokens } from '../ttw/campaign/kirovograd.ts'
import type { CampaignReinforcementContext, CampaignReinforcementState, CampaignSupplyPlacementPlan } from './campaign-reinforcement-state.ts'

type Data = Pick<Awaited<ReturnType<typeof loadKirovogradScenario>>, 'map' | 'catalog'>

/** Bind the scenario's deterministic HQ delivery to the ordinary reinforcement Supply segment. */
export function kirovogradReinforcementSupply({ map, catalog }: Data):
  Pick<CampaignReinforcementContext, 'fixedSupply' | 'supplyPlacementPlan' | 'skipReplacementRolls'> {
  function delivery(state: Readonly<CampaignReinforcementState>) {
    if (state.when?.scenarioId !== kirovogradScenario || kirovogradDates[state.cursor.turn - 1] !== state.when.date) return undefined
    const side = state.cursor.phasing
    const occupied = new Set(Object.values(state.counters).flatMap((counter) =>
      counter.side !== side && counter.location.kind === 'map' ? [map.resolveHex(counter.location.hex)] : []))
    const sites = new Map<string, { hex: string; side: typeof side; minTokens: number; maxTokens: number }>()
    const tokens = side === 'axis' ? kirovogradAxisSupplyPerHq : kirovogradSovietSupplyTokens[state.cursor.turn - 1]!
    let headquarters = 0
    for (const counter of Object.values(state.counters)) {
      if (counter.side !== side || counter.kind !== 'hq' || counter.location.kind !== 'map') continue
      const definition = catalog.definitions.get(counter.definition)
      if (definition?.kind !== 'hq' || definition.source.side !== side ||
        (side === 'axis' && !kirovogradAxisReceivesSupply(definition.source.name))) continue
      const hex = map.resolveHex(counter.location.hex)
      if (!hex || occupied.has(hex)) continue
      headquarters++
      const previous = sites.get(hex)
      sites.set(hex, { hex, side, minTokens: side === 'axis' ? (previous?.minTokens ?? 0) + tokens : 0,
        maxTokens: side === 'axis' ? (previous?.maxTokens ?? 0) + tokens : tokens })
    }
    return { tokens: side === 'axis' ? tokens * headquarters : tokens, sites: [...sites.values()] }
  }

  return {
    skipReplacementRolls: true,
    fixedSupply(state) {
      const supply = delivery(state)
      if (!supply) return undefined
      return state.cursor.phasing === 'axis'
        ? [{ kind: 'axis-cities', tokens: 0 }, { kind: 'axis-hq', tokens: supply.tokens }]
        : [{ kind: 'soviet-supply', tokens: supply.tokens }]
    },
    supplyPlacementPlan(state): CampaignSupplyPlacementPlan[] | undefined {
      const supply = delivery(state)
      if (!supply) return undefined
      return state.cursor.phasing === 'axis'
        ? [{ pool: 'axis-cities', tokens: 0, sites: [] }, { pool: 'axis-hq', tokens: supply.tokens, sites: supply.sites }]
        : [{ pool: 'soviet-supply', tokens: supply.tokens, sites: supply.sites }]
    },
  }
}
