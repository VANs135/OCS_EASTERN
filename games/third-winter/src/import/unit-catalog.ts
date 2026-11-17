export const catalogSources = [
  ['land', 'units_inf_div.json', 'units'],
  ['hq', 'units_hq.json', 'units'],
  ['transport', 'units_transport.json', 'units'],
  ['aircraft', 'units_air.json', 'units'],
  ['air-army-hq', 'units_air_army_hq.json', 'units'],
  ['luftflotte-hq', 'units_luftflotte_hq.json', 'units'],
  ['formation', 'units_formation.json', 'units'],
  ['marker', 'units_markers.json', 'markers'],
] as const

type CatalogKind = (typeof catalogSources)[number][0]

interface SourceUnit {
  id?: string | number | null
  name: string
}

export interface Definition {
  key: string
  kind: CatalogKind
  sourceFile: string
  sourceId: string | null
  source: Readonly<SourceUnit>
}

/** Keep original face data and provenance. Old names are import aliases scoped to TTW. */
export function unitCatalog(records: readonly { kind: CatalogKind; file: string; rows: readonly SourceUnit[] }[]) {
  const definitions = new Map<string, Definition>()
  const aliases = new Map<string, Definition[]>()
  const rawIds = new Map<string, Definition[]>()
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

function indexDefinition(index: Map<string, Definition[]>, key: string, item: Definition) {
  const matches = index.get(key)
  if (matches) matches.push(item)
  else index.set(key, [item])
}
