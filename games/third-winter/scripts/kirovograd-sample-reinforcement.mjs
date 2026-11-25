import { openCampaignReinforcementSession, submitCampaignSession } from '../src/match/campaign-session.ts'
import { scheduledCampaignReinforcements } from '../src/match/campaign-reinforcement-actions.ts'

/** Inspect each reinforcement window independently against the prepared opening board. */
export function sampleKirovogradReinforcements(data, prepared) {
  const original = prepared.started.state.turn
  const context = prepared.context.turn.reinforcement
  const results = []
  for (const [index, date] of data.dates.entries()) for (const side of ['axis', 'soviet']) {
    const turn = index + 1
    let record = openCampaignReinforcementSession(turn, side, original.counters,
      { when: { scenarioId: original.when.scenarioId, date }, rng: original.rng, supplyDumps: original.supplyDumps })
    const act = (action) => {
      record = submitCampaignSession(record, side,
        { id: `09-reinforcement:${record.revision}`, expectedRevision: record.revision, action }, context).record
    }
    let arrivals = 0
    for (const order of scheduledCampaignReinforcements(record.state, context)) {
      if (order.status !== 'ready') throw new Error(`Unready Kirovograd arrival: ${order.order.id}`)
      const hex = order.capacity.keys().next().value
      if (!hex) throw new Error('Missing Kirovograd arrival destination')
      act({ type: 'execute-scheduled-reinforcement', orderId: order.order.id,
        placements: order.counterIds.map((counterId) => ({ counterId, hex })) })
      arrivals += order.counterIds.length
    }
    act({ type: 'complete-scheduled-reinforcements' })
    act({ type: 'issue-fixed-campaign-supply' })
    const tokens = record.state.supplyAward.tokensToPlace
    const plan = context.supplyPlacementPlan(record.state)
    const placements = plan.flatMap(({ pool, tokens, sites }) => {
      if (!tokens) return []
      if (side === 'axis') return sites.map(({ hex, minTokens }) => ({ pool, hex, tokens: minTokens }))
      if (!sites.length) throw new Error('Missing Kirovograd fixed supply HQ')
      return [{ pool, hex: sites[0].hex, tokens }]
    })
    act({ type: 'place-campaign-supply', placements })
    if (record.state.segment !== 'rebuild-consolidate' || record.state.rng.drawCount !== original.rng.drawCount || record.state.rolls.length) {
      throw new Error('Kirovograd fixed reinforcement unexpectedly consumed table dice or opened replacements')
    }
    results.push({ turn, side, arrivals, supplyTokens: tokens, segment: record.state.segment, randomDraws: 0 })
  }
  return results
}
