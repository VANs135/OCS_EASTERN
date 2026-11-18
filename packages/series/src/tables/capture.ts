import type { Die } from '../dice.ts'

type CaptureCategory = 'dump' | 'trucks' | 'wagons'
const capturePercent: Readonly<Record<CaptureCategory, readonly number[]>> = {
  dump: [0, 25, 25, 50, 50, 75],
  trucks: [0, 0, 25, 50, 50, 75],
  wagons: [0, 0, 25, 50, 75, 100],
}

export function capturedAmount(quantity: number, category: CaptureCategory, die: Die) {
  return Math.round(quantity * capturePercent[category][die - 1]! / 100)
}

export function airBaseCaptureLoss(die: Die, active: boolean, afterCombat: boolean) {
  return die + (active ? 2 : 0) + (afterCombat ? 2 : 0) <= 6
}
