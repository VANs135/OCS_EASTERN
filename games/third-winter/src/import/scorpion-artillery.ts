import type { BackupUnit } from './unit-backup.ts'
import type { Definition } from './unit-catalog.ts'

const printedMoveBarrage: Readonly<Record<string, number>> = {
  'TTW1 S4 R04 C17B.png': 10, 'TTW1 S4 R07 C18B.png': 10, 'TTW1 S4 R09 C18B.png': 9,
  'TTW1 S4 R14 C18B.png': 9, 'TTW1 S5 R01 C08B.png': 10, 'TTW1 S5 R01 C20B.png': 14,
  'TTW1 S5 R02 C08B.png': 10, 'TTW1 S5 R03 C09B.png': 9, 'TTW1 S5 R05 C12B.png': 13,
  'TTW1 S5 R07 C07B.png': 10, 'TTW1 S5 R10 C07B.png': 0, 'TTW1 S5 R11 C03B.png': 6,
  'TTW1 S5 R11 C04B.png': 6, 'TTW1 S5 R11 C06B.png': 9, 'TTW1 S5 R12 C07B.png': 4,
  'TTW1 S5 R12 C09B.png': 4, 'TTW1 S5 R13 C06B.png': 4, 'TTW1 S5 R13 C07B.png': 4,
  'TTW1 S5 R13 C08B.png': 4, 'TTW1 S2 R01 C18B.png': 4, 'TTW1 S2 R05 C18B.png': 6,
  'TTW1 S2 R06 C17B.png': 4, 'TTW1 S2 R08 C18B.png': 4, 'TTW1 S2 R11 C18B.png': 4,
  'TTW1 S3 R01 C10B.png': 6, 'TTW1 S3 R10 C03B.png': 4, 'TTW1 S3 R11 C14B.png': 6,
  'TTW1 S1 R02 C11B.png': 0, 'TTW1 S1 R14 C10B.png': 28, 'TTW1 S2 R09 C02B.png': 9,
  'TTW1 S2 R10 C04B.png': 28, 'TTW1 S2 R10 C05B.png': 28,
}

export interface ArtilleryFace {
  strength?: number
  range?: number
  independentRe: boolean
}

export function scorpionArtillery(definition: Definition<BackupUnit>, mode: 'combat' | 'move'): ArtilleryFace | undefined {
  const { source } = definition
  const combat = source.faces.combat?.stats
  if (definition.kind !== 'land' || typeof combat?.barrage !== 'number') return undefined
  const face = source.faces[mode]
  const strength = typeof face?.stats.barrage === 'number' ? face.stats.barrage
    : mode === 'move' && face?.asset ? printedMoveBarrage[face.asset] : undefined
  const range = face?.stats.range ?? (strength === undefined ? undefined : combat.range)
  return { strength, range: typeof range === 'number' ? range : undefined,
    independentRe: source.side === 'soviet' && (source.re ?? 0) > 1 }
}
