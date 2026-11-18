import { scorpionHexId } from '../import/hex-id.ts'

// Native artwork pixels measured from the horizontal hex edges in Scorpion-Map-200929.png.
const columnPitch = 92.886
const rowPitch = 107.282
const north = 42.04
const south = 1832.5

export function scorpionHexLayout(hex: string) {
  const [column, row] = scorpionHexId(hex).slice(1).split('.').map(Number) as [number, number]
  const x = 429.14 + column * columnPitch
  const centerY = north + (17 - row + (column % 2) / 2) * rowPitch
  const top = Math.max(north, centerY - rowPitch / 2)
  const bottom = Math.min(south, centerY + rowPitch / 2)
  // The outer rows include cropped hexes. Fit the stack to the portion inside the printed border.
  const visibleHeight = bottom - top
  if (column < 1 || column > 22 || row < 1 || row > 17) throw new Error(`Hex outside the Scorpion artwork: ${hex}`)
  return { x, y: (top + bottom) / 2, scale: visibleHeight >= rowPitch - 0.01 ? 1 : visibleHeight / rowPitch }
}
