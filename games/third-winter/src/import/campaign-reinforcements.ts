import type { Side } from '@ocs-eastern/series/state-types'
import type { campaignMapInPlayArea } from '../ttw/campaign/play-area.ts'
import type {
  CampaignReinforcement, CampaignReinforcementClassification, CampaignReinforcementOperation, CampaignReinforcementSchedule,
} from '../ttw/campaign/reinforcement.ts'
import type { TtwCampaignMapIndex } from './campaign-map-index.ts'
import { resolveCampaignReference } from './campaign-reference.ts'
import type { CampaignAliases } from './campaign-reference.ts'
import { campaignHexKey } from './hex-id.ts'

const channels = new Map<string, CampaignReinforcementOperation>([
  ['withdraw', { kind: 'withdraw' }],
  ['add to dead pile', { kind: 'dead-pile' }],
  ['any front hq', { kind: 'arrival', channel: { kind: 'front-hq' } }],
  ['any airbase', { kind: 'arrival', channel: { kind: 'airbase' } }],
  ['at any detrainable hex', { kind: 'arrival', channel: { kind: 'detrainable-hex' } }],
  ['rvgk 1 or 2', { kind: 'arrival', channel: { kind: 'rvgk' } }],
  ['any army or army group hq', { kind: 'arrival', channel: { kind: 'army-or-army-group-hq' } }],
  ['any army or army group hq（map a/b）', { kind: 'arrival', channel: { kind: 'army-or-army-group-hq', panels: 'AB' } }],
  ['any army or army group hq（map c/d）', { kind: 'arrival', channel: { kind: 'army-or-army-group-hq', panels: 'CD' } }],
  ...['any army or army group hq（map a/b 上的匈牙利单位）', 'any army or army group hq（map a/b 匈牙利单位）']
    .map((label): [string, CampaignReinforcementOperation] =>
      [label, { kind: 'arrival', channel: { kind: 'army-or-army-group-hq', panels: 'AB', nation: 'hungarian' } }]),
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function prepareCampaignReinforcements(
  raw: unknown,
  aliases: CampaignAliases,
  map: TtwCampaignMapIndex,
  area?: ReturnType<typeof campaignMapInPlayArea>,
) {
  if (!Array.isArray(raw)) throw new Error('Invalid campaign reinforcement rows')
  const entries: CampaignReinforcement[] = []
  const byTurn = new Map<number, Record<Side, CampaignReinforcement[]>>()
  const groupCounts = new Map<string, number>()
  for (const [index, group] of raw.entries()) {
    const row = index + 1
    if (!isRecord(group) || group.phase !== 'reinforce' || (group.side !== 'axis' && group.side !== 'soviet') ||
      typeof group.turn !== 'number' || !Number.isSafeInteger(group.turn) || group.turn < 1 ||
      typeof group.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(group.date) ||
      (group.raw_date != null && typeof group.raw_date !== 'string') ||
      typeof group.channel !== 'string' || !group.channel.trim() || !Array.isArray(group.entries)) {
      throw new Error(`Invalid campaign reinforcement group at row ${row}`)
    }
    const { turn, side, date, channel: sourceChannel, raw_date: sourceDate } = group
    groupCounts.set(sourceChannel, (groupCounts.get(sourceChannel) ?? 0) + 1)
    const window = byTurn.get(turn) ?? { axis: [], soviet: [] }
    byTurn.set(turn, window)
    const position = { row, turn, side, date, sourceDate: sourceDate ?? null, sourceChannel } as const
    if (group.entries.length === 0) {
      const pending: CampaignReinforcement = { ...position, id: `campaign-reinforcement:${row}`, entry: null,
        ref: null, note: null, status: 'pending', issue: 'empty-group' }
      entries.push(pending)
      window[side].push(pending)
    }
    for (const [entryIndex, source] of group.entries.entries()) {
      const entry = entryIndex + 1
      if (!isRecord(source) || (source.ref !== null && (typeof source.ref !== 'string' || !source.ref.trim())) ||
        (source.note != null && typeof source.note !== 'string')) throw new Error(`Invalid campaign reinforcement entry at ${row}.${entry}`)
      const result: CampaignReinforcement = { ...position, id: `campaign-reinforcement:${row}:${entry}`, entry,
        ref: source.ref, note: source.note ?? null, ...classifyEntry(source.ref, side, sourceChannel, aliases, map, area) }
      entries.push(result)
      window[side].push(result)
    }
  }
  const schedule: CampaignReinforcementSchedule = byTurn
  return { entries, schedule, groups: raw.length, groupCounts }
}

function classifyEntry(
  ref: string | null,
  side: Side,
  label: string,
  aliases: CampaignAliases,
  map: TtwCampaignMapIndex,
  area?: ReturnType<typeof campaignMapInPlayArea>,
): CampaignReinforcementClassification {
  if (ref === null) return { status: 'pending', issue: 'narrative' }
  const reference = resolveCampaignReference(aliases, ref, side)
  if ('issue' in reference) return { status: 'pending', issue: reference.issue }
  const identity = { definition: reference.definition.key, counterKind: reference.definition.kind }
  if (identity.counterKind === 'marker') return { ...identity, status: 'pending', issue: 'marker' }

  const channel = label.trim().toLowerCase()
  if (channel === 'kherson d14.03') {
    const printedHex = 'D14.03'
    const hex = map.canonicalByHex.get(campaignHexKey(printedHex))
    if (!hex || !map.onMapHexes.has(hex)) return { ...identity, status: 'pending', issue: 'missing-entry-hex' }
    if (area && !area.availableHexes.has(hex)) return { ...identity, status: 'pending', issue: 'outside-scenario' }
    return { ...identity, status: 'classified', operation: { kind: 'arrival', channel: { kind: 'fixed-hex', hex, printedHex } } }
  }
  const operation = channels.get(channel)
  return operation ? { ...identity, status: 'classified', operation } : { ...identity, status: 'pending', issue: 'unclassified-channel' }
}
