// Scenario setup choices: fixed setup is copied verbatim; pools whose printed
// instruction says "any" remain explicit choices. A preset is a reviewed
// default selection, not the only legal one; callers may submit their own
// candidate hexes and the same validator checks both.

import type { Side } from '@ocs-eastern/series/state-types'
import type { CampaignAliases } from '../import/campaign-reference.ts'
import type { TtwCampaignMapIndex } from '../import/campaign-map-index.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { Definition } from '../import/unit-catalog.ts'

export type CampaignOpeningChoiceKind = 'supply' | 'hedgehog' | 'transport' | 'fortress' | 'unit'

export interface CampaignOpeningChoice {
  /** Stable setup prompt ID, derived from the pool key and row. */
  id: string
  side: Side
  kind: CampaignOpeningChoiceKind
  count: number
  candidates: readonly string[]
  /** Reviewed one-click default; every entry is also a legal candidate. */
  preset: readonly string[]
  uniqueHex: boolean
  label: string
  source: string
  placement: string
  tokensPerPlacement?: number
  level?: 1 | 2
  /** Catalog key for transport/fortress/unit choices. */
  definition?: string
}

export type CampaignOpeningChoicePlacements = Readonly<Record<string, readonly string[]>>

export interface CampaignOpeningChoiceContext {
  aliases: CampaignAliases
  definitions: ReadonlyMap<string, Definition<BackupUnit>>
  map: TtwCampaignMapIndex
  /** Play-area set; omitted means the whole indexed map. */
  availableHexes?: ReadonlySet<string>
  fixedCounters: readonly { side: Side; definition: string; hex: string }[]
  fixedHedgehogs?: ReadonlySet<string>
  /** Scenario-specific reviewed default, e.g. the Romanian fortress city or transport cluster. */
  preferredPreset?: Readonly<Record<string, readonly string[]>>
}

function rows(value: unknown): Record<string, unknown>[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Invalid setup pool rows')
  return value.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid setup pool row')
    return entry as Record<string, unknown>
  })
}

function sideForRow(entry: Record<string, unknown>, context: CampaignOpeningChoiceContext): Side {
  if (entry.side === 'axis' || entry.side === 'soviet') return entry.side
  if (typeof entry.ref === 'string') {
    const sides = [...new Set((context.aliases.get(entry.ref) ?? [])
      .map((definition) => definition.source.side).filter((side): side is Side => side === 'axis' || side === 'soviet'))]
    if (sides.length === 1) return sides[0]!
  }
  throw new Error(`Setup pool row has no unambiguous side: ${String(entry.ref)}`)
}

function countOf(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid setup pool count: ${label}`)
  return value
}

function playable(hex: string, context: CampaignOpeningChoiceContext) {
  return context.availableHexes === undefined || context.availableHexes.has(hex)
}

function hqCandidates(context: CampaignOpeningChoiceContext, side: Side, kinds: readonly string[]) {
  return [...new Set(context.fixedCounters.filter((counter) => counter.side === side &&
    kinds.includes(context.definitions.get(counter.definition)?.source.hqKind ?? '')).map((counter) => counter.hex))]
    .filter((hex) => playable(hex, context)).sort()
}

function cityCandidates(context: CampaignOpeningChoiceContext) {
  return [...new Set(context.map.cities.flatMap(({ hexes }) => hexes))]
    .filter((hex) => playable(hex, context)).sort()
}

function bMajorCandidates(context: CampaignOpeningChoiceContext) {
  return [...context.map.onMapHexes].filter((hex) => {
    if (!hex.startsWith('B') || !playable(hex, context)) return false
    return context.map.neighbors(hex).some((to) =>
      context.map.connection(hex, to)?.sourceEdges.some((edge) => edge.river_class === 'major'))
  }).sort()
}

function candidatesFor(placement: string, context: CampaignOpeningChoiceContext, side: Side, kind: CampaignOpeningChoiceKind) {
  const text = placement.toLowerCase()
  if (kind === 'hedgehog' || text.includes('adjacent to dnepr')) return bMajorCandidates(context).filter((hex) =>
    kind !== 'hedgehog' || !context.fixedHedgehogs?.has(hex))
  if (text.includes('any front') && text.includes('army')) return hqCandidates(context, side, ['front', 'army'])
  if (text.includes('any army or corps')) return hqCandidates(context, side, ['army', 'corps'])
  if (text.includes('front hq') || text.includes('any_front_hq')) return hqCandidates(context, side, ['front'])
  // "place at fortifications" names a category, not a hex set; do not
  // substitute every city hex until the scenario supplies the approved sites.
  if (text.includes('fortification')) throw new Error(`Unresolved setup placement: ${placement}`)
  if (kind === 'fortress') return cityCandidates(context)
  if (text.includes('any city')) return cityCandidates(context)
  throw new Error(`Unsupported setup placement: ${placement}`)
}

function definitionFor(ref: string, side: Side, context: CampaignOpeningChoiceContext): Definition<BackupUnit> {
  const found = context.aliases.get(ref)?.find((definition) => definition.source.side === side &&
    definition.kind !== 'marker' && definition.kind !== 'formation')
  if (found) return found
  if (ref === 'Truck Points') {
    const truck = context.aliases.get('Axis Truck')?.find((definition) =>
      definition.kind === 'transport' && definition.source.side === side)
    if (truck) return truck
  }
  if (ref === 'Wagon Points') {
    const wagon = context.aliases.get('Axis Wagon')?.find((definition) =>
      definition.kind === 'transport' && definition.source.side === side)
    if (wagon) return wagon
  }
  throw new Error(`Missing setup pool definition: ${ref}`)
}

function presetFor(choice: Omit<CampaignOpeningChoice, 'preset'>, preferred?: readonly string[],
  used?: Set<string>) {
  const candidates = choice.candidates
  if (!candidates.length) throw new Error(`Setup choice has no legal destination: ${choice.id}`)
  const blocked = choice.kind === 'fortress' || choice.kind === 'hedgehog' ? used : undefined
  const available = blocked ? candidates.filter((hex) => !blocked.has(hex)) : candidates
  if (choice.uniqueHex && choice.count > available.length) {
    throw new Error(`Setup choice has fewer unique destinations than counters: ${choice.id}`)
  }
  if (!available.length) throw new Error(`Setup choice has no unused preset destination: ${choice.id}`)
  if (preferred?.length) {
    if (!preferred.every((hex) => candidates.includes(hex))) {
      throw new Error(`Setup choice preset is not a legal destination: ${choice.id}`)
    }
    const repeated = Array.from({ length: choice.count }, (_, index) => preferred[index % preferred.length]!)
    if (choice.uniqueHex && new Set(repeated).size !== repeated.length) {
      throw new Error(`Setup choice preset repeats a unique destination: ${choice.id}`)
    }
    for (const hex of repeated) blocked?.add(hex)
    return repeated
  }
  const repeated = Array.from({ length: choice.count }, (_, index) => available[index % available.length]!)
  for (const hex of repeated) blocked?.add(hex)
  return repeated
}

/** Extract only pools that grant a player placement decision. Alert draws and later-use pools stay out. */
export function buildCampaignOpeningChoices(rawPools: unknown, context: CampaignOpeningChoiceContext): CampaignOpeningChoice[] {
  if (rawPools === undefined) return []
  if (rawPools === null || typeof rawPools !== 'object' || Array.isArray(rawPools)) {
    throw new Error('Invalid setup pools')
  }
  const pools = rawPools as Record<string, unknown>
  const choices: CampaignOpeningChoice[] = []
  const presetUsed = new Map<string, Set<string>>()
  const add = (choice: Omit<CampaignOpeningChoice, 'preset'>) => {
    const key = `${choice.side}:${choice.kind}`
    const used = presetUsed.get(key) ?? new Set<string>()
    presetUsed.set(key, used)
    choices.push({ ...choice, preset: presetFor(choice, context.preferredPreset?.[choice.id], used) })
  }

  for (const [index, entry] of rows(pools.supply).entries()) {
    const side = sideForRow(entry, context)
    const count = countOf(entry.sp, `supply[${index}]`)
    const placement = String(entry.placement ?? '')
    add({ id: `setup:supply:${index + 1}`, side, kind: 'supply', count,
      candidates: candidatesFor(placement, context, side, 'supply'), uniqueHex: false,
      label: `${side} supply: ${count} SP`, source: `pools.supply[${index}]`, placement, tokensPerPlacement: 4 })
  }

  for (const [index, entry] of rows(pools.markers).entries()) {
    if (typeof entry.ref !== 'string' || !/^hedgehog\s+\d+$/i.test(entry.ref)) continue
    const side = sideForRow(entry, context)
    const count = countOf(entry.count, `markers[${index}]`)
    const level = Number(/^hedgehog\s+(\d+)$/i.exec(entry.ref)?.[1])
    if (level !== 1 && level !== 2) throw new Error(`Invalid hedgehog level: ${entry.ref}`)
    const placement = String(entry.placement ?? '')
    add({ id: `setup:markers:${index + 1}`, side, kind: 'hedgehog', count,
      candidates: candidatesFor(placement, context, side, 'hedgehog'), uniqueHex: true,
      label: `${side} hedgehogs: ${count}×level ${level}`, source: `pools.markers[${index}]`, placement, level })
  }

  for (const [index, entry] of rows(pools.transport).entries()) {
    if (typeof entry.ref !== 'string' || !/truck|wagon/i.test(entry.ref)) continue
    const side = sideForRow(entry, context)
    const count = countOf(entry.count, `transport[${index}]`)
    const definition = definitionFor(entry.ref, side, context)
    const placement = String(entry.placement ?? '')
    add({ id: `setup:transport:${index + 1}`, side, kind: 'transport', count,
      candidates: candidatesFor(placement, context, side, 'transport'), uniqueHex: false,
      label: `${side} ${entry.ref}: ${count}`, source: `pools.transport[${index}]`, placement,
      definition: definition.key })
  }

  for (const [index, entry] of rows(pools.fortress).entries()) {
    if (typeof entry.ref !== 'string') throw new Error(`Invalid fortress pool row ${index}`)
    const side = sideForRow(entry, context)
    const count = countOf(entry.count, `fortress[${index}]`)
    const definition = definitionFor(entry.ref, side, context)
    const placement = String(entry.placement ?? '')
    add({ id: `setup:fortress:${index + 1}`, side, kind: 'fortress', count,
      candidates: candidatesFor(placement, context, side, 'fortress'), uniqueHex: false,
      label: `${side} ${entry.ref}: ${count}`, source: `pools.fortress[${index}]`, placement,
      definition: definition.key })
  }

  for (const [index, entry] of rows(pools.front_hq).entries()) {
    if (typeof entry.ref !== 'string') throw new Error(`Invalid front_hq pool row ${index}`)
    const side = sideForRow(entry, context)
    const count = countOf(entry.count, `front_hq[${index}]`)
    const definition = definitionFor(entry.ref, side, context)
    const placement = String(entry.entry ?? entry.placement ?? 'any_front_hq')
    add({ id: `setup:front-hq:${index + 1}`, side, kind: 'unit', count,
      candidates: candidatesFor(placement, context, side, 'unit'), uniqueHex: false,
      label: `${side} ${entry.ref}: ${count}`, source: `pools.front_hq[${index}]`, placement,
      definition: definition.key })
  }

  return choices
}

/** One-click default selections. */
export function presetCampaignOpeningChoices(choices: readonly CampaignOpeningChoice[]) {
  return Object.fromEntries(choices.map((choice) => [choice.id, [...choice.preset]]))
}

/** Validate player selections; omitted choices fall back to their reviewed preset. */
export function resolveCampaignOpeningChoices(choices: readonly CampaignOpeningChoice[],
  placements?: CampaignOpeningChoicePlacements) {
  const known = new Set(choices.map(({ id }) => id))
  for (const id of Object.keys(placements ?? {})) {
    if (!known.has(id)) throw new Error(`Unknown setup choice: ${id}`)
  }
  const resolved: Record<string, readonly string[]> = {}
  for (const choice of choices) {
    const hexes = placements && Object.hasOwn(placements, choice.id) ? placements[choice.id] : choice.preset
    if (!hexes || hexes.length !== choice.count) throw new Error(`Setup choice ${choice.id} needs ${choice.count} placements`)
    if (choice.uniqueHex && new Set(hexes).size !== hexes.length) throw new Error(`Setup choice ${choice.id} requires distinct hexes`)
    for (const hex of hexes) {
      if (!choice.candidates.includes(hex)) throw new Error(`Setup choice ${choice.id} rejects destination ${hex}`)
    }
    resolved[choice.id] = [...hexes]
  }
  return resolved
}
