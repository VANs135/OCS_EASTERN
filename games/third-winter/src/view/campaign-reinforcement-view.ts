import type { DiceRoll, Side } from '@ocs-eastern/series/state-types'
import { scheduledCampaignReinforcements } from '../match/campaign-reinforcement-actions.ts'
import { campaignReinforcementStep } from '../match/campaign-reinforcement-flow.ts'
import type { CampaignCounter, CampaignReinforcementContext } from '../match/campaign-reinforcement-state.ts'
import type { CampaignSession } from '../match/campaign-session.ts'

const copyDice = (dice: DiceRoll) => ({ ...dice, faces: [...dice.faces] })

function ownCounter(id: string, { definition, kind, location, active, currentRe, internalStocks }: CampaignCounter) {
  return { id, definition, kind, active, currentRe, internalStocks, location: location.kind === 'map'
    ? { kind: location.kind, hex: location.hex }
    : location.kind === 'box' ? { kind: location.kind, box: location.box } : { kind: location.kind } }
}

/** The caller supplies the authenticated or local seat. The authoritative record stays outside the projection. */
export function projectCampaignReinforcements(record: Readonly<CampaignSession>, viewer: Side, context: CampaignReinforcementContext) {
  const { state, revision } = record
  const { phase, phasing, turn } = state.cursor
  const counters = Object.entries(state.counters).flatMap(([id, counter]) =>
    counter.side === viewer ? [ownCounter(id, counter)] : [])
  const own = { counters, supplyDumps: { ...state.supplyDumps[viewer] }, withdrawalSupplyDebt: state.withdrawalSupplyDebt[viewer] }
  const base = { viewer, revision, phase, phasing, turn, segment: state.segment, own }
  if (phase !== 'reinforcement' || viewer !== phasing) return { ...base, active: null }

  const supply = state.supplyAward
  const replacement = state.replacementAward
  return { ...base, active: {
    step: campaignReinforcementStep(state, context.schedule),
    scheduled: scheduledCampaignReinforcements(state, context).map((entry) => ({
      id: entry.order.id, ref: entry.order.ref, note: entry.order.note, status: entry.status,
      ...(entry.status === 'ready' ? { counterIds: [...entry.counterIds], destinations: [...entry.capacity].map(([hex, capacity]) =>
        ({ hex, capacity: Number.isFinite(capacity) ? capacity : null })) } : {}),
    })),
    supply: supply && { ...supply, dice: copyDice(supply.dice), pools: supply.pools.map((pool) => ({ ...pool })) },
    replacement: replacement && { ...replacement, eq: [...replacement.eq] },
    specialReplacements: state.specialReplacements?.slice(),
    rolls: state.rolls.filter(({ side }) => side === viewer).map(({ check, dice }) => ({ check, dice: copyDice(dice) })),
  } }
}
