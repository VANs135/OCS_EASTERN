import { scorpionGroundProfile } from './ground-profile.ts'
import type { GroundProfile } from './ground-profile.ts'
import { scorpionPrintedHex } from './hex-id.ts'
import type { ScorpionMap } from './scorpion-map.ts'
import type { BackupUnit } from './unit-backup.ts'
import type { Definition } from './unit-catalog.ts'
import type { Mobility } from '@ocs-eastern/series/ground-map'
import type { InternalStocks } from '@ocs-eastern/series/internal-stocks'
import { scorpionCombatSymbols } from './scorpion-combat-symbols.ts'

export interface GroundSetupRow {
  ref: string
  at: { col: number; row: number }
  face?: 'reduced'
}

export interface DeployedCounter extends GroundProfile {
  definition: string
  hex: string
  printedRe: number
  actionRating: number
  attackCapable: boolean
  strength: number
  combatClass: 'armor' | 'mech' | 'other'
  antiTank: 0 | 1 | 2
  disorganized?: boolean
  moveMode?: boolean
  exploit?: boolean
  reserve?: string
  released?: boolean
  formation?: string
  headquarters?: { throwRange: number; mobility: Mobility; kessel: boolean }
  traceDrawMobility?: Mobility
  outOfSupply?: boolean
  internalStocks?: InternalStocks
  stepsLost: number
  fueled: boolean
  organicTruck?: 'full' | 'empty'
}

type Aliases = ReadonlyMap<string, readonly Definition<BackupUnit>[]>

// TTW Scenarios pp.54–55. Combine the available 2-point and 1-point truck counters for the 3-point stack.
const printedTransports = [
  { ref: 'Sov 5.Gd Tk Truck', hex: 's2.16', organicTruck: 'full' },
  { ref: 'Sov 5.Mech Truck', hex: 's4.15', organicTruck: 'full' },
  { ref: 'Sov 29.Tk Truck', hex: 's20.03', organicTruck: 'full' },
  { ref: 'Sov 18.Tk Truck', hex: 's20.04', organicTruck: 'full' },
  { ref: 'Ge 14.Pz Truck', hex: 's13.05', organicTruck: 'full' },
  { ref: 'Sov Truck 2/45', hex: 's5.16' },
  { ref: 'Sov Truck 2/45', hex: 's21.04' },
  { ref: 'Sov Truck', hex: 's21.04' },
] as const

// TTW Scenarios pp.54–56. Each of these Soviet pairs has one loss and leaves the unit choice open.
const lossPairs = [
  ['Sov 232 Rifle Div', 'Sov 340 Rifle Div'],
  ['Sov 213 Rifle Div', 'Sov 252 Rifle Div'],
  ['Sov 66 Gd Rifle Div', 'Sov 69 Gd Rifle Div'],
] as const
const multipleLosses: ReadonlyMap<string, number> = new Map([
  ['Ge 75 Inf Div', 2], ['Ge 198 Inf Div', 2], ['Ge 34 Inf Div', 2], ['Ge 88 Inf Div', 3],
  ['Ge 112 Inf Div', 2], ['Ge 106 Inf Div', 2], ['Ge 167 Inf Div', 3], ['Ge 57 Inf Div', 2],
])

export function deployScorpionGroundCounter(
  definition: Definition<BackupUnit>, hex: string, stepsLost: number, organicTruck?: 'full' | 'empty',
): DeployedCounter {
  const profile = scorpionGroundProfile(definition, 'combat')
  const printedRe = profile?.combat ? definition.source.re : 0
  // The merged TTW backup stores the printed ground Action Rating in artRange.
  const stats = definition.source.faces.combat?.stats
  const rating = profile?.combat ? stats?.artRange : 0
  const formation = definition.source.org?.parentFmt
  if (!profile || printedRe == null || stepsLost < 0 || !Number.isSafeInteger(stepsLost) ||
    (stepsLost > 0 && stepsLost >= printedRe) || typeof rating !== 'number' || !Number.isInteger(rating) || rating < 0 || rating > 5) {
    throw new Error(`Invalid ground counter: ${definition.source.name}`)
  }
  const range = stats?.dropRange
  const kessel = definition.source.abilities?.includes('kessel_supply') === true
  if (definition.kind === 'hq' && (typeof range !== 'number' || !Number.isInteger(range) || range < 0)) {
    throw new Error(`Missing throw range: ${definition.source.name}`)
  }
  // Scorpion HQ counters have black throw values, except the two white Kessel HQs.
  const headquarters = definition.kind === 'hq' && typeof range === 'number'
    ? { throwRange: range, mobility: kessel ? 'leg' as const : 'truck' as const, kessel } : undefined
  const attackCapable = typeof stats?.attack === 'number' && stats.attack > 0 &&
    stats.defensiveOnly !== true && !headquarters && typeof stats.barrage !== 'number' && profile.combat
  const strength = headquarters ? (kessel ? 2 : 5) : typeof stats?.barrage === 'number' ? 1 :
    typeof stats?.attack === 'number' ? stats.attack : 0
  return { ...profile, definition: definition.key, hex, printedRe, actionRating: rating, attackCapable,
    strength, ...scorpionCombatSymbols(definition), formation: typeof formation === 'string' && formation ? formation : undefined, headquarters,
    traceDrawMobility: headquarters?.mobility, stepsLost, fueled: false, organicTruck }
}

/** Project the listed ground counters onto the new map, retaining each physical copy. */
export function scorpionGroundDeployment(setup: readonly GroundSetupRow[], aliases: Aliases, map: ScorpionMap) {
  const units: Record<string, DeployedCounter> = {}
  const byRef = new Map<string, string[]>()

  function add(ref: string, hex: string, stepsLost: number, organicTruck?: 'full') {
    const candidates = aliases.get(ref)
    const definition = candidates?.length === 1 ? candidates[0] : undefined
    if (!definition || !map.hexes.has(hex)) {
      throw new Error(`Invalid Scorpion ground deployment: ${ref} at ${hex}`)
    }
    const copies = byRef.get(definition.source.name) ?? []
    const id = `setup:${definition.key}:${copies.length + 1}`
    units[id] = deployScorpionGroundCounter(definition, hex, stepsLost, organicTruck)
    copies.push(id)
    byRef.set(definition.source.name, copies)
  }

  for (const row of setup) {
    if (row.face !== undefined && row.face !== 'reduced') throw new Error(`Unknown setup face for ${row.ref}`)
    const choice = lossPairs.some((pair) => pair.some((ref) => ref === row.ref))
    const stepsLost = choice || row.face !== 'reduced' ? 0 : multipleLosses.get(row.ref) ?? 1
    add(row.ref, scorpionPrintedHex(row.at.col, row.at.row), stepsLost)
  }
  for (const row of printedTransports) {
    // A later scenario export may include a printed truck already.
    const matching = (byRef.get(row.ref) ?? []).filter((id) => units[id]?.hex === row.hex)
    if (matching.length > 1) throw new Error(`Duplicate Scorpion transport deployment: ${row.ref} at ${row.hex}`)
    const existing = matching[0] && units[matching[0]]
    const load = 'organicTruck' in row ? row.organicTruck : undefined
    if (existing) existing.organicTruck = load
    else add(row.ref, row.hex, 0, load)
  }
  const lossChoices = lossPairs.map((pair) => {
    const [a, b] = pair.map((ref) => byRef.get(ref))
    if (a?.length !== 1 || b?.length !== 1 || units[a[0]!]?.hex !== units[b[0]!]?.hex) {
      throw new Error(`Invalid Scorpion setup loss choice: ${pair.join(' / ')}`)
    }
    return { candidates: [a[0]!, b[0]!] as const, stepsLost: 1 }
  })
  return { units, lossChoices }
}
