import { loadThirdWinterUnits } from './unit-backup.ts'

/** The VASSAL scenario export uses the Walloon regiment's earlier name. */
export async function loadScorpionUnits(readJson: (file: string) => Promise<unknown>) {
  const catalog = await loadThirdWinterUnits(readJson)
  const wall = catalog.definitions.get('land:id:4154')
  const oldName = 'Ge Wallonian SS Mot Inf Rgt'
  if (wall?.source.side !== 'axis' || wall.source.name !== 'Ge Wall SS Mot Inf Rgt' || catalog.aliases.has(oldName)) {
    throw new Error('Cannot reconcile the Scorpion Walloon regiment reference')
  }
  catalog.aliases.set(oldName, [wall])
  return catalog
}
