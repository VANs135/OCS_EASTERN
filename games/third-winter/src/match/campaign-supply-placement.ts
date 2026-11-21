import { nextReinforcementSegment } from '@ocs-eastern/series/reinforcement'
import { campaignReinforcementStep } from './campaign-reinforcement-flow.ts'
import type { CampaignReinforcementAction, CampaignReinforcementContext, CampaignReinforcementState, CampaignSupplyPool } from './campaign-reinforcement-state.ts'

type PlaceSupply = Extract<CampaignReinforcementAction, { type: 'place-campaign-supply' }>
type Pool = CampaignSupplyPool['kind']
type Quota = { min: number; max: number }

function readPlacementPlan(state: Readonly<CampaignReinforcementState>, context: CampaignReinforcementContext,
  gross: readonly CampaignSupplyPool[], net: number) {
  const input = context.supplyPlacementPlan?.(state)
  if (!input) throw new Error('The campaign supply placement plan is not configured')
  const remaining = new Map(gross.map(({ kind, tokens }) => [kind, tokens]))
  const plan = new Map<Pool, { tokens: number; sites: Map<string, Quota> }>()
  const enemyHexes = new Set(Object.values(state.counters).flatMap(({ side, location }) =>
    side !== state.cursor.phasing && location.kind === 'map' ? [context.resolveHex(location.hex)] : []))
  let total = 0
  for (const { pool, tokens, sites: source } of input) {
    const limit = remaining.get(pool)
    if (limit === undefined || !Number.isSafeInteger(tokens) || tokens < 0 || tokens > limit) {
      throw new Error('Invalid campaign supply pool allocation')
    }
    remaining.delete(pool)
    const sites = new Map<string, Quota>()
    for (const { hex: printed, side, minTokens = 0, maxTokens } of source) {
      const hex = context.resolveHex(printed)
      if (!hex || side !== state.cursor.phasing || enemyHexes.has(hex) || sites.has(hex) ||
        !Number.isSafeInteger(minTokens) || !Number.isSafeInteger(maxTokens) || minTokens < 0 || maxTokens < minTokens) {
        throw new Error('Invalid campaign supply site')
      }
      sites.set(hex, { min: minTokens, max: maxTokens })
    }
    plan.set(pool, { tokens, sites })
    total += tokens
  }
  if (remaining.size || total !== net) throw new Error('Campaign supply plan must cover each pool and the exact net award')
  return plan
}

export function placeCampaignSupply(state: Readonly<CampaignReinforcementState>, action: PlaceSupply,
  context: CampaignReinforcementContext): CampaignReinforcementState {
  const award = state.supplyAward
  if (campaignReinforcementStep(state) !== 'place-supply' || award?.status !== 'awaiting-placement') {
    throw new Error('Campaign supply placement is not available')
  }
  if (!Array.isArray(action.placements)) throw new Error('Give a list of campaign supply placements')
  const plan = readPlacementPlan(state, context, award.pools, award.tokensToPlace)
  const spending = new Map<Pool, Map<string, number>>()
  for (const { pool, hex: printed, tokens } of action.placements) {
    const hex = context.resolveHex(printed)
    const quota = hex && plan.get(pool)?.sites.get(hex)
    if (!hex || !quota || !Number.isSafeInteger(tokens) || tokens <= 0) throw new Error('Illegal campaign supply placement')
    const used = spending.get(pool) ?? new Map<string, number>()
    const total = (used.get(hex) ?? 0) + tokens
    if (total > quota.max) throw new Error('Campaign supply placement exceeds the site quota')
    used.set(hex, total)
    spending.set(pool, used)
  }
  const side = state.cursor.phasing
  const dumps = { ...state.supplyDumps[side] }
  for (const [pool, { tokens, sites }] of plan) {
    const used = spending.get(pool) ?? new Map<string, number>()
    if ([...used.values()].reduce((sum, amount) => sum + amount, 0) !== tokens) {
      throw new Error('Place the entire authorized campaign supply pool')
    }
    for (const [hex, quota] of sites) {
      const amount = used.get(hex) ?? 0
      if (amount < quota.min) throw new Error('Campaign supply placement is below the mandatory site quota')
      if (!amount) continue
      const total = (Object.hasOwn(dumps, hex) ? dumps[hex]! : 0) + amount
      if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid campaign supply dump total')
      dumps[hex] = total
    }
  }
  return { ...state, segment: nextReinforcementSegment('supply')!, supplyDumps: { ...state.supplyDumps, [side]: dumps } }
}
