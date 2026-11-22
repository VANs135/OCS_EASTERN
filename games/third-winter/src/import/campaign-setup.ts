import type { Side } from '@ocs-eastern/series/state-types'
import type { campaignMapInPlayArea } from '../ttw/campaign/play-area.ts'
import type { TtwCampaignMapIndex } from './campaign-map-index.ts'
import { resolveCampaignReference } from './campaign-reference.ts'
import type { CampaignAliases, CampaignReferenceIssue } from './campaign-reference.ts'
import { campaignHexKey } from './hex-id.ts'
import type { BackupUnit } from './unit-backup.ts'
import type { Definition } from './unit-catalog.ts'

type PlayableMap = ReturnType<typeof campaignMapInPlayArea>
type HexIssue = 'missing-hex' | 'outside-scenario'

function resolveLocation(printed: string | null, map: TtwCampaignMapIndex, area?: PlayableMap):
  { hex: string } | { issue: HexIssue } {
  if (!printed || !/^[A-D]\d+\.\d+$/.test(printed)) return { issue: 'missing-hex' }
  const hex = map.canonicalByHex.get(campaignHexKey(printed))
  if (!hex || !map.onMapHexes.has(hex)) return { issue: 'missing-hex' }
  if (area && !area.availableHexes.has(hex)) return { issue: 'outside-scenario' }
  return { hex }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readSide(value: unknown, at: string): Side {
  if (value !== 'axis' && value !== 'soviet') throw new Error(`Invalid campaign setup side at ${at}`)
  return value
}

interface SetupCounter {
  id: string
  row: number
  side: Side
  ref: string
  hex: string
  printedHex: string
  definition: string
  kind: Definition<BackupUnit>['kind']
  face: string | null
  stepsLost?: number
}

/** Read an explicit loss in a single roster parenthesis. The marker name is not a loss count. */
function lossFromSource(source: unknown) {
  if (typeof source !== 'string' || !/-\s*\d+\s*steps?\b/i.test(source)) return {}
  const match = /^[^()]+\([^();]+;\s*-\s*(\d+)\s*steps?\s*\)$/i.exec(source.trim())
  const stepsLost = match && Number(match[1])
  return stepsLost && Number.isSafeInteger(stepsLost) ? { stepsLost } : { issue: 'ambiguous-loss-source' as const }
}

function readLoss(entry: Record<string, unknown>): { stepsLost?: number; issue?: string } {
  if (entry.steps_lost === undefined) return lossFromSource(entry.src)
  const stepsLost = entry.steps_lost
  return typeof stepsLost === 'number' && Number.isSafeInteger(stepsLost) && stepsLost > 0 ? { stepsLost }
    : stepsLost === 0 ? {} : { issue: 'invalid-explicit-loss' }
}

/** Prepare known placements and retain pending setup actions. A prepared list alone cannot open a match. */
export function prepareCampaignSetup(raw: unknown, aliases: CampaignAliases, map: TtwCampaignMapIndex, area?: PlayableMap) {
  if (!isRecord(raw) || !Array.isArray(raw.units) || (raw.random_draws !== undefined && !Array.isArray(raw.random_draws))) {
    throw new Error('Invalid campaign setup rows')
  }
  const counters: SetupCounter[] = []
  const pendingMarkerRows: { row: number; side: Side; ref: string; printedHex: string | null; lossHint?: number }[] = []
  const formationHeadings: { row: number; side: Side; ref: string }[] = []
  const unresolvedSetup: { row: number; side: Side; ref: string; issue: CampaignReferenceIssue }[] = []
  const missingSetupHexes: { row: number; ref: string; hex: string | null }[] = []
  const outsideSetupArea: typeof missingSetupHexes = []
  const unresolvedLosses: { row: number; ref: string; issue: string }[] = []
  let resolvedNonMarkers = 0
  for (const [index, entry] of raw.units.entries()) {
    const row = index + 1
    if (!isRecord(entry) || typeof entry.ref !== 'string' || !entry.ref.trim() ||
      (entry.face != null && typeof entry.face !== 'string')) throw new Error(`Invalid campaign setup row ${row}`)
    const { ref } = entry
    const side = readSide(entry.side, `row ${row}`)
    const at = entry.at
    const printedHex = isRecord(at) ? `${at.map}${at.col}.${at.row}` : null
    const location = resolveLocation(printedHex, map, area)
    if ('issue' in location) (location.issue === 'missing-hex' ? missingSetupHexes : outsideSetupArea).push({ row, ref, hex: printedHex })
    const reference = resolveCampaignReference(aliases, ref, side)
    if ('issue' in reference) {
      unresolvedSetup.push({ row, ref, side, issue: reference.issue })
      continue
    }
    const { definition } = reference
    if (definition.kind === 'formation' && typeof entry.note === 'string' && entry.note.includes('编队本级')) {
      formationHeadings.push({ row, side, ref })
      continue
    }
    const loss = readLoss(entry)
    if (definition.kind === 'marker') {
      pendingMarkerRows.push({ row, ref, side, printedHex, ...(loss.stepsLost ? { lossHint: loss.stepsLost } : {}) })
      continue
    }
    resolvedNonMarkers++
    const capacity = definition.source.re
    const lossIssue = loss.issue ?? (loss.stepsLost !== undefined &&
      (definition.kind !== 'land' || typeof capacity !== 'number' || loss.stepsLost >= capacity) ? 'invalid-loss-capacity' : undefined)
    if (lossIssue) unresolvedLosses.push({ row, ref, issue: lossIssue })
    if ('issue' in location || lossIssue || !printedHex) continue
    counters.push({ id: `campaign-setup:${row}`, row, side, ref, printedHex, hex: location.hex,
      definition: definition.key, kind: definition.kind, face: entry.face ?? null,
      ...(loss.stepsLost === undefined ? {} : { stepsLost: loss.stepsLost }) })
  }

  const drawOrders: { row: number; side: Side; pool: string; hex: string; count?: number }[] = []
  const unresolvedDraws: { row: number; hex: string; pool: string; issue: HexIssue }[] = []
  for (const [index, entry] of (raw.random_draws ?? []).entries()) {
    const row = index + 1
    if (!isRecord(entry) || typeof entry.hex !== 'string' || typeof entry.pool !== 'string' || !entry.pool.trim()) {
      throw new Error(`Invalid campaign setup draw ${row}`)
    }
    const { pool, hex } = entry
    const count = entry.count
    if (count !== undefined && (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1)) throw new Error(`Invalid setup draw count at ${row}`)
    const side = readSide(entry.side, `draw ${row}`)
    const location = resolveLocation(hex, map, area)
    if ('issue' in location) unresolvedDraws.push({ row, pool, hex, issue: location.issue })
    else drawOrders.push({ row, pool, hex: location.hex, side, ...(count === undefined ? {} : { count }) })
  }
  return {
    total: raw.units.length, resolvedNonMarkers, counters, pendingMarkerRows, unresolvedSetup, unresolvedLosses,
    missingSetupHexes, outsideSetupArea, drawOrders, unresolvedDraws, formationHeadings,
  }
}
