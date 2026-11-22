import type { DiceRoll, Side } from '@ocs-eastern/series/state-types'
import { campaignConsolidationOptions } from '../match/campaign-consolidation.ts'
import { campaignFormationExchangeOptions } from '../match/campaign-formation-exchange.ts'
import { scheduledCampaignReinforcements } from '../match/campaign-reinforcement-actions.ts'
import { campaignReinforcementStep } from '../match/campaign-reinforcement-flow.ts'
import type { CampaignBoardState, CampaignCounter, CampaignReinforcementContext, CampaignReinforcementState } from '../match/campaign-reinforcement-state.ts'

const copyDice = (dice: DiceRoll) => ({ ...dice, faces: [...dice.faces] })

function ownCounter(id: string, { definition, kind, location, active, currentRe, stepsLost, mode, transportCargoTokens, internalStocks,
  disorganized, exploiting, fueled, outOfSupply, specialTruckExtender }: CampaignCounter) {
  return { id, definition, kind, active, currentRe, internalStocks, ...(stepsLost === undefined ? {} : { stepsLost }),
    ...(disorganized === undefined ? {} : { disorganized }), ...(exploiting === undefined ? {} : { exploiting }),
    ...(fueled === undefined ? {} : { fueled }), ...(outOfSupply === undefined ? {} : { outOfSupply }),
    ...(specialTruckExtender ? { specialTruckExtender: true } : {}),
    ...(mode === undefined ? {} : { mode }), ...(transportCargoTokens === undefined ? {} : { transportCargoTokens }), location: location.kind === 'map'
    ? { kind: location.kind, hex: location.hex }
    : location.kind === 'box' ? { kind: location.kind, box: location.box }
      : location.kind === 'breakout-return' ? { kind: location.kind, turn: location.turn } : { kind: location.kind } }
}

export function projectCampaignSeat(state: Readonly<CampaignBoardState>, viewer: Side) {
  const counters = Object.entries(state.counters).flatMap(([id, counter]) =>
    counter.side === viewer ? [ownCounter(id, counter)] : [])
  return { counters, supplyDumps: { ...state.supplyDumps[viewer] }, withdrawalSupplyDebt: state.withdrawalSupplyDebt[viewer] }
}

/** The caller supplies the authenticated or local seat. The authoritative record stays outside the projection. */
export function projectCampaignReinforcements(record: { state: Readonly<CampaignReinforcementState>; revision: number },
  viewer: Side, context: CampaignReinforcementContext) {
  const { state, revision } = record
  const { phase, phasing, turn } = state.cursor
  return { viewer, revision, phase, phasing, turn, segment: state.segment, own: projectCampaignSeat(state, viewer),
    active: projectCampaignReinforcementActive(state, viewer, context) }
}

export function projectCampaignReinforcementActive(state: Readonly<CampaignReinforcementState>, viewer: Side,
  context: CampaignReinforcementContext) {
  if (state.cursor.phase !== 'reinforcement' || viewer !== state.cursor.phasing) return null

  const supply = state.supplyAward
  const replacement = state.replacementAward
  return {
    step: campaignReinforcementStep(state, context.schedule),
    scheduled: scheduledCampaignReinforcements(state, context).map((entry) => ({
      id: entry.order.id, ref: entry.order.ref, note: entry.order.note, status: entry.status,
      ...(entry.status === 'ready' ? { counterIds: [...entry.counterIds], destinations: [...entry.capacity].map(([hex, capacity]) =>
        ({ hex, capacity: Number.isFinite(capacity) ? capacity : null })) } : {}),
    })),
    supply: supply && { ...supply, dice: copyDice(supply.dice), pools: supply.pools.map((pool) => ({ ...pool })) },
    replacement: replacement && { ...replacement, eq: [...replacement.eq] },
    specialReplacements: state.specialReplacements?.slice(),
    consolidation: campaignConsolidationOptions(state, viewer, context),
    formationExchange: campaignFormationExchangeOptions(state, viewer, context),
    rolls: state.rolls.filter(({ side }) => side === viewer).map(({ check, dice }) => ({ check, dice: copyDice(dice) })),
  }
}
