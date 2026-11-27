import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignGroundMap } from './campaign-ground-position.ts'
import type { CampaignTurnState } from './campaign-turn-state.ts'

export type CampaignSupplySource = { kind: 'dump'; hex: string } | { kind: 'transport'; id: string }
  | { kind: 'carried'; id: string } | { kind: 'edge'; hex: string }
type OrganicFormation = (state: Readonly<CampaignTurnState>, id: string) => string | undefined
interface SupplyEntry { source: CampaignSupplySource; hex: string; tokens: number; formation?: string }

export function campaignPhysicalSupply(state: Readonly<CampaignTurnState>, side: Side, map: CampaignGroundMap,
  organicFormation?: OrganicFormation, edgeSources: readonly string[] = state.edgeSupplySources?.[side] ?? []) {
  const sources = new Map<string, SupplyEntry>()
  for (const [hex, tokens] of Object.entries(state.supplyDumps[side])) {
    if (Number.isSafeInteger(tokens) && tokens > 0 && map.resolveHex(hex) === hex) {
      sources.set(`dump:${hex}`, { source: { kind: 'dump', hex }, hex, tokens })
    }
  }
  // Scenario supply sources at a map edge are not dumps: they are unlimited
  // drawing points, so they carry a large sentinel and are never decremented.
  for (const printed of edgeSources) {
    const hex = map.resolveHex(printed)
    if (hex) sources.set(`edge:${hex}`, { source: { kind: 'edge', hex }, hex, tokens: Number.MAX_SAFE_INTEGER })
  }
  for (const [id, counter] of Object.entries(state.counters)) {
    if (counter.side !== side) continue
    if (counter.location.kind !== 'map') continue
    const carried = counter.carriedSupplyTokens
    if (carried !== undefined && Number.isSafeInteger(carried) && carried >= 0) {
      const hex = map.resolveHex(counter.location.hex)
      if (hex) sources.set(`carried:${id}`, { source: { kind: 'carried', id }, hex, tokens: carried })
    }
    if (counter.kind !== 'transport' || counter.specialTruckExtender) continue
    const hex = map.resolveHex(counter.location.hex)
    const tokens = counter.transportCargoTokens
    if (hex && tokens !== undefined && Number.isSafeInteger(tokens) && tokens >= 0) {
      sources.set(`transport:${id}`, { source: { kind: 'transport', id }, hex, tokens, formation: organicFormation?.(state, id) })
    }
  }
  return sources
}

export function campaignSupplySourceKey(resolveHex: CampaignGroundMap['resolveHex'], source: CampaignSupplySource) {
  if (source.kind === 'dump') return `dump:${resolveHex(source.hex) ?? ''}`
  if (source.kind === 'edge') return `edge:${resolveHex(source.hex) ?? ''}`
  return source.kind === 'transport' ? `transport:${source.id}` : `carried:${source.id}`
}

export function spendCampaignSupply(state: Readonly<CampaignTurnState>, side: Side, sources: ReadonlyMap<string, SupplyEntry>,
  spending: ReadonlyMap<string, number>) {
  const counters = { ...state.counters }
  const dumps = { ...state.supplyDumps[side] }
  for (const [key, tokens] of spending) {
    if (tokens === 0) continue
    const entry = sources.get(key)
    if (!entry || !Number.isSafeInteger(tokens) || tokens < 1 || tokens > entry.tokens) throw new Error('Campaign supply source cannot cover payment')
    if (entry.source.kind === 'dump') {
      dumps[entry.hex] = entry.tokens - tokens
      if (dumps[entry.hex] === 0) delete dumps[entry.hex]
    } else if (entry.source.kind === 'transport') {
      const { id } = entry.source
      counters[id] = { ...counters[id]!, transportCargoTokens: entry.tokens - tokens }
    } else if (entry.source.kind === 'edge') {
      // A scenario edge source is a drawing point, not a stock; it never decreases.
    } else {
      const { id } = entry.source
      // 保留 0 token 的条目，与 transport 一致：feeding.reBySource 已付款但未用完的 RE 余量要靠该源键继续生效。
      counters[id] = { ...counters[id]!, carriedSupplyTokens: entry.tokens - tokens }
    }
  }
  return { ...state, counters, supplyDumps: { ...state.supplyDumps, [side]: dumps } }
}
