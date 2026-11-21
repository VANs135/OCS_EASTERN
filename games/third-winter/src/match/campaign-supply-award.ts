import { rollDice } from '@ocs-eastern/series/rng'
import type { CampaignReinforcementContext, CampaignReinforcementState, CampaignSupplyAward } from './campaign-reinforcement-state.ts'

/** OCS 2.3 and TTW 1.7c. Record the award before its separate placement procedure. */
export function rollCampaignSupply(state: Readonly<CampaignReinforcementState>, context: CampaignReinforcementContext): CampaignReinforcementState {
  if (state.step !== 'supply' || state.supplyAward) throw new Error('The supply roll is not available')
  const side = state.cursor.phasing
  const { value: dice, rng } = rollDice(state.rng, 2)
  const row = context.supplyTable?.(state, dice.total)
  if (!row) throw new Error('The campaign Supply Table is not configured for this result')
  const pools = row.map((pool) => ({ ...pool }))
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
  return { ...state, rng, supplyAward, withdrawalSupplyDebt: supplyAward.status === 'awaiting-placement'
    ? { ...state.withdrawalSupplyDebt, [side]: 0 } : state.withdrawalSupplyDebt }
}
