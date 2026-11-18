import type { Die, RollDie } from '../dice.ts'
import type { CrtLike, CrtTerrain } from './crt.ts'
import { lookupCell, matchRowIndex } from './lookup.ts'

export interface CombatOutcome {
  loss: number
  option: number
}

export interface GroundCombatDice {
  surprise: () => readonly [Die, Die]
  shift: RollDie
  combat: () => readonly [Die, Die]
}

export function parseCombatResult(code: string) {
  const match = /^A(?:L([1-9]))?(?:o([1-9]))?(?:\s*e([1-5]))?(?:\s+D(?:L([1-9]))?(?:o([1-9]))?(DG)?)?$/.exec(code)
  if (!match || !match.slice(1).some(Boolean)) throw new Error(`Invalid OCS combat result ${code}`)
  return {
    attacker: { loss: Number(match[1] ?? 0), option: Number(match[2] ?? 0) },
    defender: { loss: Number(match[4] ?? 0), option: Number(match[5] ?? 0) },
    exploit: match[3] ? Number(match[3]) : null, disorganize: Boolean(match[6]),
  }
}

/** OCS 9.7–9.9. Round the ratio before flooring to a listed column. */
export function rollRegularCombat(table: CrtLike, terrain: CrtTerrain, attack: number, defend: number,
  modifier: number, hedgehog: number, dice: RollDie | GroundCombatDice, overrun = false) {
  const columns = table.terrainColumns[terrain]
  if (!columns?.length || attack < 0 || defend < 0 || !Number.isFinite(attack + defend)) throw new Error('Invalid combat odds')
  const odds = attack === defend ? 1 : defend === 0 ? Infinity : attack === 0 ? 0
    : attack > defend ? Math.round(attack / defend) : 1 / Math.round(defend / attack)
  let initialColumn = 0
  for (const [index, label] of columns.entries()) {
    const [a, b] = label.split(':').map(Number)
    if (!a || !b) throw new Error(`Invalid CRT column ${label}`)
    if (a / b <= odds) initialColumn = index
  }
  const rolls = typeof dice === 'function'
    ? { surprise: () => [dice(), dice()] as const, shift: dice, combat: () => [dice(), dice()] as const } : dice
  const surpriseDice = rolls.surprise()
  const surpriseTotal = surpriseDice[0] + surpriseDice[1] + modifier - (hedgehog > 0 ? 1 : 0)
  const shift = surpriseTotal >= (overrun ? 9 : 10) ? rolls.shift()
    : surpriseTotal <= (overrun ? 6 : 5) ? -rolls.shift() : 0
  const column = Math.max(0, Math.min(columns.length - 1, initialColumn + shift))
  const combatDice = rolls.combat()
  const row = matchRowIndex(table.diceRows, combatDice[0] + combatDice[1] + modifier - hedgehog, 'crt')
  const code = lookupCell(table.matrix, row, column, 'crt')
  return { code, initialColumn, column, row, surpriseDice, shift, combatDice, ...parseCombatResult(code) }
}
