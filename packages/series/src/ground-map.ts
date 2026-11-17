export type Mobility = 'track' | 'truck' | 'leg'
export type StepCost = number | 'all' | null

export interface GroundMap<Edge> {
  neighbors: (hex: string) => readonly string[]
  edge: (from: string, to: string) => Edge | undefined
}

export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}
