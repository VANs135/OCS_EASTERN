import type { Mobility } from '@ocs-eastern/series/ground-map'
import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionPrintedMovement } from './scorpion-printed-movement.ts'
import type { BackupUnit } from './unit-backup.ts'
import type { Definition } from './unit-catalog.ts'

const movementColors: Readonly<Record<string, Mobility>> = {
  white: 'leg', black: 'truck', red: 'track',
  // 铁路 HQ 的地面 MA 为 0；其补给绘制按铁路/轮式处理，地面移动由 railOnly 单独拦住。
  rail: 'truck',
}

export interface GroundProfile {
  side: Side
  combat: boolean
  mobility: Mobility
  allowance: number
}

/** OCS 3.1a. Read the selected mode's printed movement value and color. */
export function scorpionGroundProfile(
  { source, kind }: Definition<BackupUnit>, mode: 'combat' | 'move',
): GroundProfile | null {
  if (!source.side || (kind !== 'land' && kind !== 'hq' && kind !== 'transport')) return null
  const transport = kind === 'transport' || source.abilities?.includes('organic_truck') === true
  const face = source.faces[mode] ?? (transport ? source.faces.combat : null)
  const allowance = face?.stats.move
  const printedColor = face?.asset ? scorpionPrintedMovement[face.asset] : undefined
  const faceColor = face?.maColor && face.maColor !== 'unknown' ? face.maColor : undefined
  // TTW's V2 counter OCR left some back-side ma_color null. category is the
  // source's own unit class and supplies the printed movement color in that case.
  const category = (source as { category?: string | null }).category
  const inferredColor = category === 'mech' || category === 'at' || category === 'recon' ? 'black'
    : category === 'armor' ? 'red' : category === 'infantry' ? 'white' : undefined
  const color = printedColor ?? faceColor ?? inferredColor
  if (typeof allowance !== 'number' || !Number.isFinite(allowance) || allowance < 0 ||
    !color || !Object.hasOwn(movementColors, color)) return null
  return { side: source.side, combat: !transport, allowance, mobility: movementColors[color]! }
}
