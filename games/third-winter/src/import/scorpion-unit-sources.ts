import { loadThirdWinterUnits } from './unit-backup.ts'

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
export async function loadScorpionUnits(readJson: (file: string) => Promise<unknown>) {
  const catalog = await loadThirdWinterUnits(readJson)
  for (const [reference, name] of scenarioNames) {
    const matches = catalog.aliases.get(name)
    const existing = catalog.aliases.get(reference)
    if (matches?.length !== 1 || matches[0]?.kind !== 'land' || (existing && (existing.length !== 1 || existing[0] !== matches[0]))) {
      throw new Error(`Cannot reconcile the Scorpion unit reference ${reference}`)
    }
    catalog.aliases.set(reference, matches)
  }
  return catalog
}
