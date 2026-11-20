import { loadThirdWinterUnits } from './unit-backup.ts'
import { loadThirdWinterV2Units } from './unit-v2.ts'

const scenarioNames = [
  ['Ge Wallonian SS Mot Inf Rgt', 'Ge Wall SS Mot Inf Rgt'],
  ['Ge 4-4-3 拆分单位', 'Ge 4-4-3 Brkdwn'],
  ['Ge 3-3-3 拆分单位', 'Ge 3-3-3 Brkdwn'],
  ['Sov Gd 3-4-3 拆分单位', 'Sov Gd 3-4-3 Brkdwn'],
  ['Sov Gd 3-3-3 拆分单位', 'Sov Gd 3-3-3 Brkdwn'],
  ['Sov 3-3-3 拆分单位', 'Sov 3-3-3 Brkdwn'],
  ['Sov 3-2-2 拆分单位', 'Sov 3-2-2 Brkdwn'],
] as const

/** Reconcile names in the Scorpion setup with the printed counters in the TTW catalog. */
export async function loadScorpionUnits(readJson: (file: string) => Promise<unknown>, schema: 'legacy' | 'v2' = 'legacy') {
  const catalog = await (schema === 'v2' ? loadThirdWinterV2Units : loadThirdWinterUnits)(readJson)
  for (const [reference, name] of scenarioNames) {
    const preferred = catalog.aliases.get(schema === 'v2' ? reference : name)
    const other = catalog.aliases.get(schema === 'v2' ? name : reference)
    if (preferred?.length !== 1 || preferred[0]?.kind !== 'land' ||
      (other && (other.length !== 1 || other[0] !== preferred[0]))) {
      throw new Error(`Cannot reconcile the Scorpion unit reference ${reference}`)
    }
    catalog.aliases.set(reference, preferred)
    if (schema === 'v2') catalog.aliases.set(name, preferred)
  }
  return catalog
}
