import { scorpionHexId } from '../import/hex-id.ts'

// Native artwork pixels measured from the horizontal hex edges in Scorpion-Map-200929.png.
const columnPitch = 92.886
const rowPitch = 107.282
const north = 42.04
const south = 1832.5
const west = 463
const east = 2536

function center(column: number, row: number) {
  return { x: 429.14 + column * columnPitch, y: north + (17 - row + (column % 2) / 2) * rowPitch }
}

export function scorpionHexLayout(hex: string) {
  const [column, row] = scorpionHexId(hex).slice(1).split('.').map(Number) as [number, number]
  const { x, y: centerY } = center(column, row)
  const top = Math.max(north, centerY - rowPitch / 2)
  const bottom = Math.min(south, centerY + rowPitch / 2)
  // The outer rows include cropped hexes. Fit the stack to the portion inside the printed border.
  const visibleHeight = bottom - top
  if (column < 1 || column > 22 || row < 1 || row > 17) throw new Error(`Hex outside the Scorpion artwork: ${hex}`)
  return { x, y: (top + bottom) / 2, scale: visibleHeight >= rowPitch - 0.01 ? 1 : visibleHeight / rowPitch }
}

/** Hit-test the printed polygon. Hit-testing uses its original center even at the clipped rows. */
export function scorpionHexAt(x: number, y: number): string | null {
  if (!Number.isFinite(x + y) || x < west || x > east || y < north || y > south) return null
  const radius = columnPitch * 2 / 3
  const halfHeight = rowPitch / 2
  for (let column = 1; column <= 22; column++) for (let row = 1; row <= 17; row++) {
    const point = center(column, row)
    const dx = Math.abs(x - point.x)
    const dy = Math.abs(y - point.y)
    if (dy <= halfHeight && dx <= radius * (1 - dy / rowPitch)) return `s${column}.${String(row).padStart(2, '0')}`
  }
  return null
}
