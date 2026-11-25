import { campaignReinforcementStep } from './campaign-reinforcement-flow.ts'
import { drawCampaignReinforcementCheck } from './campaign-reinforcement-rolls.ts'
import type { DiceRoll } from '@ocs-eastern/series/state-types'
import type { CampaignReinforcementContext, CampaignReinforcementState, CampaignSupplyAward, CampaignSupplyPool } from './campaign-reinforcement-state.ts'

/** OCS 2.3 and TTW 1.7c. Record the award before its separate placement procedure. */
export function rollCampaignSupply(state: Readonly<CampaignReinforcementState>, context: CampaignReinforcementContext): CampaignReinforcementState {
  if (context.fixedSupply || campaignReinforcementStep(state) !== 'roll-supply') throw new Error('The supply roll is not available')
  const { dice, rng, rolls } = drawCampaignReinforcementCheck(state, 'supply')
  const row = context.supplyTable?.(state, dice.total)
  if (!row) throw new Error('The campaign Supply Table is not configured for this result')
  return recordSupplyAward({ ...state, rng, rolls }, row, dice)
}

export function issueCampaignFixedSupply(state: Readonly<CampaignReinforcementState>, context: CampaignReinforcementContext): CampaignReinforcementState {
  if (!context.fixedSupply || campaignReinforcementStep(state, undefined, true) !== 'issue-fixed-supply') {
    throw new Error('Fixed campaign supply is not available')
  }
  const row = context.fixedSupply(state)
  if (!row) throw new Error('The fixed campaign supply rule is not configured for this position')
  return recordSupplyAward(state, row, null)
}

function recordSupplyAward(state: Readonly<CampaignReinforcementState>, row: readonly CampaignSupplyPool[], dice: DiceRoll | null): CampaignReinforcementState {
  const side = state.cursor.phasing
  const pools = row.map(({ kind, tokens }) => ({ kind, tokens }))
  const expected = side === 'axis' ? ['axis-cities', 'axis-hq'] : ['soviet-supply']
  const grossTokens = pools.reduce((sum, pool) => sum + pool.tokens, 0)
  if (pools.length !== expected.length || expected.some((kind) => !pools.some((pool) => pool.kind === kind)) ||
    pools.some(({ tokens }) => !Number.isSafeInteger(tokens) || tokens < 0) || !Number.isSafeInteger(grossTokens)) {
    throw new Error('Invalid campaign supply pools')
  }
  const requiredTokens = state.withdrawalSupplyDebt[side]
  if (!Number.isSafeInteger(requiredTokens) || requiredTokens < 0) throw new Error('Invalid campaign withdrawal supply debt')
  // TTW does not specify how to settle a short award. Keep the roll and debt for an explicit ruling.
  const supplyAward: CampaignSupplyAward = { dice, pools, grossTokens, ...(requiredTokens > grossTokens
    ? { status: 'deduction-pending', requiredTokens }
    : { status: 'awaiting-placement', withheldTokens: requiredTokens, tokensToPlace: grossTokens - requiredTokens }) }
  return { ...state, supplyAward, withdrawalSupplyDebt: supplyAward.status === 'awaiting-placement'
    ? { ...state.withdrawalSupplyDebt, [side]: 0 } : state.withdrawalSupplyDebt }
}
