export type Side = 'axis' | 'soviet'

export interface RngState {
  seed: number
  state: number
  drawCount: number
}

export interface DiceRoll {
  count: number
  faces: number[]
  total: number
}
