import { setupDecision } from '@ocs-eastern/series/setup-workflow'
import type { SetupDrawRecord } from '@ocs-eastern/series/setup-workflow'
import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignOpeningSession, CampaignOpeningContext } from '../match/campaign-opening-session.ts'
import { projectCampaignMatch } from './campaign-match-view.ts'
import { projectCampaignSeat } from './campaign-reinforcement-view.ts'
import { emptyCampaignReplacementHoldings } from '../match/campaign-reinforcement-state.ts'

function visibleDraws(draws: readonly SetupDrawRecord[], viewer: Side) {
  return draws.filter(({ side }) => side === viewer).map(({ stepId, pool, counterId }) => ({ stepId, pool, counterId }))
}

export function projectCampaignSession(record: Readonly<CampaignOpeningSession>, viewer: Side, context: CampaignOpeningContext) {
  const { state, revision } = record
  if (state.kind === 'playing') return { kind: 'playing' as const,
    ...projectCampaignMatch({ revision, state: state.turn }, viewer, context.turn), setupDraws: visibleDraws(state.setupDraws, viewer) }
  const { setup } = state
  const own = projectCampaignSeat({ counters: setup.counters, rng: setup.rng,
    supplyDumps: state.opening.supplyDumps ?? { axis: {}, soviet: {} },
    withdrawalSupplyDebt: state.opening.withdrawalSupplyDebt ?? { axis: 0, soviet: 0 },
    replacementHoldings: emptyCampaignReplacementHoldings() }, viewer)
  return { kind: 'setup' as const, revision, viewer, ...setupDecision(setup, context.setupPlan, viewer, context.setupRules),
    turn: state.opening.turn, date: state.opening.when.date, phasing: null, own, setupDraws: visibleDraws(setup.draws, viewer) }
}
