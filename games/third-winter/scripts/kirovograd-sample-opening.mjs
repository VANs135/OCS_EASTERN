import { prepareKirovogradOpening } from '../src/match/kirovograd-opening.ts'
import { openCampaignSession, submitCampaignSessionCommand } from '../src/match/campaign-opening-session.ts'
import { projectCampaignSession } from '../src/view/campaign-opening-session-view.ts'

/** Exercise only setup and prescribed opening weather, using one legal option per placement. */
export function sampleKirovogradOpening(data, seed = 20261125) {
  const prepared = prepareKirovogradOpening(data)
  const { opening, context } = prepared
  let record = openCampaignSession(opening, context, seed)
  while (record.state.kind === 'setup') {
    const step = context.setupPlan.steps[record.state.setup.stepIndex]
    const view = projectCampaignSession(record, step.side, context)
    const active = view.active
    if (!active) throw new Error('Missing Kirovograd setup decision')
    let action
    if (active.kind === 'place') {
      if (!active.destinations.length) throw new Error(`No legal initial placement: ${active.counterId}`)
      action = { type: 'setup-place', stepId: active.id, hex: active.destinations[0] }
    } else action = { type: active.kind === 'draw' ? 'setup-draw' : 'setup-confirm', stepId: active.id }
    record = submitCampaignSessionCommand(record, step.side,
      { id: `09-opening:${record.revision}`, expectedRevision: record.revision, action }, context).record
  }
  const beforeWeather = record
  record = submitCampaignSessionCommand(record, data.opening.first,
    { id: '09-opening:weather', expectedRevision: record.revision, action: { type: 'determine-campaign-weather' } }, context).record
  if (record.state.kind !== 'playing' || record.state.turn.rng.drawCount !== beforeWeather.state.turn.rng.drawCount) {
    throw new Error('Prescribed Kirovograd weather unexpectedly consumed a random draw')
  }
  return { ...prepared, beforeWeather, started: record }
}
