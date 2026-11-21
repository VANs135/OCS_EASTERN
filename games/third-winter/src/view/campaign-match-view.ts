import type { Side } from '@ocs-eastern/series/state-types'
import { actingSide } from '@ocs-eastern/series/turn'
import { campaignReinforcementAtCursor } from '../match/campaign-match.ts'
import type { CampaignMatch } from '../match/campaign-match.ts'
import type { CampaignCursor, CampaignTurnContext } from '../match/campaign-turn-state.ts'
import { projectCampaignReinforcementActive, projectCampaignSeat } from './campaign-reinforcement-view.ts'

function preTurnStep(cursor: Extract<CampaignCursor, { phase: 'pre-turn' }>) {
  switch (cursor.segment) {
    case 'weather': return 'determine-weather'
    case 'random-event': return cursor.event ? 'await-event-effect' : 'roll-event'
    case 'initiative': return cursor.winner ? 'choose-first' : 'roll-initiative'
    case 'simulcast': return 'await-simulcast'
  }
}

export function projectCampaignMatch(record: Readonly<CampaignMatch>, viewer: Side, context: CampaignTurnContext) {
  const { state, revision } = record
  const { cursor, reinforcement, when, turn, weather, weatherHistory } = state
  const preTurnRolls = state.preTurnRolls.map(({ segment, check, dice }) => ({ segment, check,
    dice: { ...dice, faces: [...dice.faces] } }))
  const base = { viewer, revision, turn, date: when.date, weather: weather ? { ...weather } : null, ice: weatherHistory.ice,
    phase: cursor.phase, preTurnRolls, own: projectCampaignSeat(state, viewer) }
  if (cursor.phase === 'ended') return { ...base, reason: cursor.reason, phasing: null, actor: null }
  if (cursor.phase === 'pre-turn') {
    const event = cursor.segment === 'random-event' && cursor.event ? { ...cursor.event } : null
    const chooser = cursor.segment === 'initiative' ? cursor.winner : null
    return { ...base, segment: cursor.segment, step: preTurnStep(cursor), event, phasing: null, actor: chooser }
  }

  const player = { ...base, first: cursor.first, phasing: cursor.phasing, actor: actingSide(cursor.phasing, cursor.phase) }
  if (cursor.phase === 'movement') return { ...player, segment: 'breakout' }
  if (cursor.phase !== 'reinforcement' || !reinforcement) return player
  const { stage } = reinforcement
  if (stage === 'ordinary') {
    const active = campaignReinforcementAtCursor(state)!
    return { ...player, segment: active.segment, active: projectCampaignReinforcementActive(active, viewer, context.reinforcement) }
  }
  if (cursor.phasing !== viewer) return { ...player, segment: stage, active: null }
  const blockers = context.reinforcementBlockers?.(state, stage)
  const step = blockers?.length ? 'resolve-reinforcement-obligations' : blockers ? `complete-${stage}` : 'await-reinforcement-rules'
  return { ...player, segment: stage, active: { step, blockers: blockers?.slice() ?? null } }
}
