import type { BackupUnit } from '../import/unit-backup.ts'
import type { Definition } from '../import/unit-catalog.ts'
import type { KirovogradLosses } from '../ttw/campaign/kirovograd.ts'

/** What the destruction of one counter scores under Scenario Book p.62. */
export type KirovogradLossClass = 'axis-armor-formation' | 'soviet-armor-formation' | 'axis-army-hq' | 'axis-other-hq'

const armoredFormations = new Set(['armor', 'mech'])

/** Parent formation code and nation to the class the unit library gives that formation. Conflicting classes are a data error. */
export function kirovogradFormationClassOf(definitions: ReadonlyMap<string, Definition<BackupUnit>>) {
  const classes = new Map<string, string>()
  for (const { kind, source } of definitions.values()) {
    const code = source.org?.parentFmt
    const category = source.category
    if (kind !== 'formation' || !code || category === undefined) continue
    const key = JSON.stringify([source.nation ?? null, code])
    const known = classes.get(key)
    if (known !== undefined && known !== category) {
      throw new Error(`Conflicting formation classes for ${source.name}: ${known} and ${category}`)
    }
    classes.set(key, category)
  }
  return (unit: Readonly<BackupUnit>) => unit.org?.parentFmt ? classes.get(JSON.stringify([unit.nation ?? null, unit.org.parentFmt])) : undefined
}

/**
 * Scenario Book p.62. An Axis unit scores by the class of its parent formation, a Soviet unit by its own printed class.
 * Only members of a multi-unit formation score. Army Group HQs are not in this library; count them separately if one appears.
 */
export function kirovogradLossClass(definition: Definition<BackupUnit> | undefined,
  formationClassOf: (unit: Readonly<BackupUnit>) => string | undefined): KirovogradLossClass | undefined {
  if (!definition) return undefined
  const { kind, source } = definition
  if (source.side === 'axis' && kind === 'hq') return / Army$/.test(source.name) ? 'axis-army-hq' : 'axis-other-hq'
  if (kind !== 'land' || !source.org?.parentFmt) return undefined
  if (source.side === 'axis') return armoredFormations.has(formationClassOf(source) ?? '') ? 'axis-armor-formation' : undefined
  return armoredFormations.has(source.category ?? '') ? 'soviet-armor-formation' : undefined
}

/**
 * Formation codes that units carry but no formation record owns. Their members cannot be scored by formation,
 * so the gap is reported instead of being passed over in silence. Pass `used` to limit the report to one scenario.
 */
export function kirovogradFormationGaps(definitions: ReadonlyMap<string, Definition<BackupUnit>>, used?: ReadonlySet<string>) {
  const classOf = kirovogradFormationClassOf(definitions)
  const gaps = new Map<string, string[]>()
  for (const [key, { kind, source }] of definitions) {
    if ((used && !used.has(key)) || kind === 'formation' || !source.org?.parentFmt || classOf(source) !== undefined) continue
    const code = `${source.nation ?? '-'}:${source.org.parentFmt}`
    gaps.set(code, [...(gaps.get(code) ?? []), source.name])
  }
  return [...gaps].map(([code, units]) => ({ code, units: [...units].sort() }))
}

/** Count destruction events. A unit destroyed twice after a rebuild scores twice. */
export function kirovogradLosses(destroyed: readonly (KirovogradLossClass | undefined)[], armyGroupHq = 0): KirovogradLosses {
  const count = (wanted: KirovogradLossClass) => destroyed.filter((loss) => loss === wanted).length
  const army = count('axis-army-hq')
  const other = count('axis-other-hq')
  if (!Number.isSafeInteger(armyGroupHq) || armyGroupHq < 0) throw new Error('Invalid destroyed Army Group HQ count')
  return { axisArmorFormationUnits: count('axis-armor-formation'), sovietArmorUnits: count('soviet-armor-formation'),
    axisHq: { total: army + other + armyGroupHq, army, armyGroup: armyGroupHq } }
}
