import type { Side } from '@ocs-eastern/series/state-types'
import { allowsBreakoutReturnHq } from '../ttw/campaign/breakout-return.ts'
import type { BreakoutHqFacts } from '../ttw/campaign/breakout-return.ts'
import type { CampaignReinforcementState } from './campaign-reinforcement-state.ts'

export type ReturnCampaignBreakout = { type: 'return-campaign-breakout'; counterId: string; hqId: string }

export interface CampaignBreakoutReturnBoard {
  unitFacts(state: Readonly<CampaignReinforcementState>, id: string): { nationality: string; alert?: boolean } | undefined
  hqFacts(state: Readonly<CampaignReinforcementState>, id: string): BreakoutHqFacts | undefined
  /** Scenario boundary and current board eligibility for the normalized map hex. */
  canPlace(state: Readonly<CampaignReinforcementState>, counterId: string, hex: string): boolean
}

export function dueCampaignBreakoutReturns(state: Readonly<CampaignReinforcementState>) {
  const { turn, phasing, phase } = state.cursor
  if (phase !== 'reinforcement' || state.segment !== 'scheduled') return []
  return Object.entries(state.counters).filter(([, unit]) => unit.side === phasing && unit.location.kind === 'breakout-return' &&
    unit.location.turn === turn).map(([id]) => id)
}

export function campaignBreakoutReturnOptions(state: Readonly<CampaignReinforcementState>, board?: CampaignBreakoutReturnBoard) {
  const due = dueCampaignBreakoutReturns(state)
  if (!due.length) return []
  const hqs = Object.entries(state.counters).flatMap(([id, unit]) => {
    if (unit.side !== state.cursor.phasing || unit.kind !== 'hq' || unit.location.kind !== 'map') return []
    const facts = board?.hqFacts(state, id)
    return facts ? [{ id, hex: unit.location.hex, facts }] : []
  })
  return due.map((counterId) => {
    const unit = board?.unitFacts(state, counterId)
    const choices = unit && board ? hqs.filter(({ hex, facts }) => allowsBreakoutReturnHq(state.cursor.phasing, unit, facts) &&
      board.canPlace(state, counterId, hex)).map(({ id, hex }) => ({ hqId: id, hex })) : []
    return { counterId, choices }
  })
}

export function returnCampaignBreakout(state: Readonly<CampaignReinforcementState>, actor: Side,
  action: ReturnCampaignBreakout, board?: CampaignBreakoutReturnBoard): CampaignReinforcementState {
  if (actor !== state.cursor.phasing) throw new Error('Only the phasing side can place a campaign breakout return')
  const order = campaignBreakoutReturnOptions(state, board).find(({ counterId }) => counterId === action.counterId)
  const site = order?.choices.find(({ hqId }) => hqId === action.hqId)
  if (!site) throw new Error('Choose a due campaign breakout counter and a legal return HQ')
  const unit = state.counters[action.counterId]!
  // Current strength carries over. The existing campaign counter's only transient ground marker is internal stocks.
  return { ...state, counters: { ...state.counters, [action.counterId]: { ...unit,
    location: { kind: 'map', hex: site.hex }, internalStocks: undefined } } }
}
