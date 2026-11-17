export type CatalogKind = 'land' | 'hq' | 'transport' | 'aircraft' | 'air-army-hq' |
  'luftflotte-hq' | 'formation' | 'marker'

export interface SourceUnit {
  id?: string | number | null
  name: string
}

export interface Definition<Unit extends SourceUnit = SourceUnit> {
  key: string
  kind: CatalogKind
  sourceFile: string
  sourceId: string | null
  source: Readonly<Unit>
}

/** Keep original face data and provenance. Old names are import aliases scoped to TTW. */
export function unitCatalog<Unit extends SourceUnit>(
  records: readonly { kind: CatalogKind; file: string; rows: readonly Unit[] }[],
) {
  const definitions = new Map<string, Definition<Unit>>()
  const aliases = new Map<string, Definition<Unit>[]>()
  const rawIds = new Map<string, Definition<Unit>[]>()
  for (const { kind, file, rows } of records) {
    for (const source of rows) {
      if (!source.name?.trim()) throw new Error(`Unnamed definition in ${file}`)
      const sourceId = source.id == null || String(source.id).trim() === '' ? null : String(source.id).trim()
      // Missing marker IDs are keyed by their source name until assigned permanent IDs.
      const key = sourceId === null ? `${kind}:name:${source.name}` : `${kind}:id:${sourceId}`
      if (definitions.has(key)) throw new Error(`Conflicting definition key ${key} in ${file}`)
      const item = { key, kind, sourceFile: file, sourceId, source }
      definitions.set(key, item)
      indexDefinition(aliases, source.name, item)
      if (sourceId !== null) indexDefinition(rawIds, sourceId, item)
    }
  }
  return { definitions, aliases, rawIds }
}

function indexDefinition<Unit extends SourceUnit>(
  index: Map<string, Definition<Unit>[]>, key: string, item: Definition<Unit>,
) {
  const matches = index.get(key)
  if (matches) matches.push(item)
  else index.set(key, [item])
}
