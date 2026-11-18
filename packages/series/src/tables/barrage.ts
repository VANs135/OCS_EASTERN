import type { Die, RollDie } from '../dice.ts'
import type { CrtTerrain } from './crt.ts'
import { lookupCell, matchRowIndex } from './lookup.ts'

export interface BarrageTable {
  columns: readonly string[]
  costs: readonly number[]
  matrix: readonly (readonly string[])[]
}

export function barrageColumn(table: BarrageTable, strength: number) {
  if (!Number.isFinite(strength) || strength < 1) throw new Error('Barrage needs at least one strength point')
  const initialColumn = matchRowIndex(table.columns, Math.round(strength), 'barrage strength')
  const cost = table.costs[initialColumn]
  if (!cost || !Number.isSafeInteger(cost)) throw new Error('Invalid Barrage Table supply cost')
  return { initialColumn, cost }
}

export function barrageDensity(units: readonly { re: number; formation?: string }[]) {
  const formations = new Map<string, number>()
  let total = 0
  for (const { re, formation } of units) {
    if (formation) formations.set(formation, (formations.get(formation) ?? 0) + re)
    else total += Math.min(re, 3)
  }
  for (const re of formations.values()) total += Math.min(re, 3)
  return total
}

interface GroundBarrageFacts {
  density: number
  terrain: CrtTerrain
  hedgehog: number
  spotter: boolean
  strategicTarget?: boolean
  air?: { shortRange: boolean }
  dieModifier?: number
  resultOverrides?: Readonly<Record<string, string>>
}

export function rollGroundBarrage(table: BarrageTable, initialColumn: number, facts: GroundBarrageFacts,
  roll: RollDie | { table: () => readonly [Die, Die]; halfLoss: RollDie }) {
  const { density, hedgehog, terrain, spotter, strategicTarget, air, dieModifier = 0, resultOverrides } = facts
  const shifts = {
    density: density <= 1 ? -1 : density <= 3 ? 0 : Math.min(Math.ceil(density) - 3, 4),
    terrain: terrain === 'Open' ? 0 : terrain === 'Extr Close' ? -2 : -1,
    hedgehog: hedgehog > 0 ? -1 : 0,
    spotter: spotter ? 0 : -3,
    strategicTarget: strategicTarget ? 3 : 0,
    ...(air ? { shortRange: Number(air.shortRange) } : {}),
  }
  const column = Math.max(0, Math.min(table.columns.length - 1, initialColumn +
    Object.values(shifts).reduce((total, shift) => total + shift, 0)))
  const dice = typeof roll === 'function' ? [roll(), roll()] as const : roll.table()
  const adjusted = Math.max(2, Math.min(12, dice[0] + dice[1] + dieModifier))
  const printedCode = lookupCell(table.matrix, adjusted - 2, column, 'barrage')
  const code = resultOverrides?.[printedCode] ?? printedCode
  const halfDie = code === '1/2' || (code === '[1/2]' && !air && hedgehog < 3 && spotter)
    ? (typeof roll === 'function' ? roll() : roll.halfLoss()) : null
  const loss = halfDie !== null ? Number(halfDie >= 4) : /^[1-3]$/.test(code) ? Number(code) : 0
  return { code, column, shifts, dice, halfDie, loss, disorganize: code !== '-',
    ...(dieModifier ? { dieModifier, adjusted, printedCode } : {}) }
}

export function rollFacilityBarrage(table: BarrageTable, column: number, roll: RollDie) {
  const die = roll()
  const code = lookupCell(table.matrix, die - 1, column, 'facility barrage')
  const result = /^(?:([12]) )?(?:(S|\*) )?\(([3-6])\)$/.exec(code)
  if (code !== '-' && !result) throw new Error('Invalid Barrage vs Facility result')
  return { die, code, damage: Number(result?.[1] ?? 0), aircraftLossAt: result ? Number(result[3]) : null,
    trainbusting: Boolean(result?.[2]) }
}
