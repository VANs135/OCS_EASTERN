import type { Side } from '@ocs-eastern/series/state-types'
import { unitCatalog } from './unit-catalog.ts'
import type { CatalogKind, SourceUnit } from './unit-catalog.ts'

const groundKinds = ['ground', 'hq', 'transport', 'formation'] as const
const airKinds = ['air', 'airhq', 'luft'] as const
type BackupKind = typeof groundKinds[number] | typeof airKinds[number] | 'marker'

const catalogKind: Readonly<Record<BackupKind, CatalogKind>> = {
  ground: 'land', hq: 'hq', transport: 'transport', formation: 'formation',
  air: 'aircraft', airhq: 'air-army-hq', luft: 'luftflotte-hq', marker: 'marker',
}

const files = [
  { file: 'units.axis.json', kinds: groundKinds, side: 'axis' },
  { file: 'units.soviet.json', kinds: groundKinds, side: 'soviet' },
  { file: 'units.air.json', kinds: airKinds, side: null },
  { file: 'units.marker.json', kinds: ['marker'], side: null },
] as const

export interface BackupFace {
  asset: string | null
  maColor: string | null
  stats: Readonly<Record<string, unknown>>
}

export interface BackupUnit extends SourceUnit {
  side: Side | null
  /** Nation abbreviation of the v2 library, e.g. Ge, Hun or Rum. The old backup has none. */
  nation?: string
  re?: number | null
  org?: { parentFmt?: string | null; airGroup?: string | null } | null
  category?: string
  kind?: Exclude<BackupKind, 'marker'>
  faces: { combat: BackupFace | null; move: BackupFace | null }
  abilities?: readonly string[]
  multiInstance?: boolean
  instancePool?: string
}

export async function loadThirdWinterUnits(readJson: (file: string) => Promise<unknown>) {
  const tables = await Promise.all(files.map(async (entry) => {
    const payload = await readJson(entry.file)
    if (!record(payload) || payload.version !== 1 || !Array.isArray(payload.units) || payload.units.length === 0) {
      throw new Error(`Expected a nonempty Third Winter unit table, version 1: ${entry.file}`)
    }
    return (payload.units as unknown[]).map((raw) => {
      if (!isUnit(raw)) throw new Error(`Invalid unit row in ${entry.file}`)
      const kind = raw.kind ?? 'marker'
      const kinds: readonly string[] = entry.kinds
      if (!kinds.includes(kind) || (entry.side !== null && raw.side !== entry.side) ||
        (kind !== 'marker' && raw.side === null)) {
        throw new Error(`Wrong unit kind or side in ${entry.file}: ${raw.name}`)
      }
      return { kind: catalogKind[kind], file: entry.file, rows: [raw] }
    })
  }))
  return unitCatalog(tables.flat())
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFace(value: unknown): value is BackupFace | null {
  return value === null || (record(value) && record(value.stats) &&
    (value.asset === null || typeof value.asset === 'string') &&
    (value.maColor === null || typeof value.maColor === 'string'))
}

function isUnit(value: unknown): value is BackupUnit {
  return record(value) && typeof value.name === 'string' &&
    (value.id == null || typeof value.id === 'number' || typeof value.id === 'string') &&
    (value.side === 'soviet' || value.side === 'axis' || value.side === null) &&
    (value.re == null || (typeof value.re === 'number' && Number.isFinite(value.re) && value.re >= 0)) &&
    (value.kind === undefined || typeof value.kind === 'string') &&
    record(value.faces) && isFace(value.faces.combat) && isFace(value.faces.move) &&
    (value.abilities === undefined || (Array.isArray(value.abilities) &&
      value.abilities.every((ability: unknown) => typeof ability === 'string')))
}
