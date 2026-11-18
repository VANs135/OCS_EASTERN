export const scorpionBarrageFronts = ['first-ukrainian', 'second-ukrainian'] as const
export type ScorpionBarrageFront = typeof scorpionBarrageFronts[number]
export type ScorpionBarrageRecovery = Readonly<Partial<Record<ScorpionBarrageFront, number>>>

export function scorpionBarrageFrontAt(hex: string): ScorpionBarrageFront {
  return Number(hex.slice(1).split('.')[0]) <= 8 ? 'second-ukrainian' : 'first-ukrainian'
}

export function advanceScorpionBarrageRecovery(recovery: ScorpionBarrageRecovery): ScorpionBarrageRecovery {
  return Object.fromEntries(scorpionBarrageFronts.flatMap((front) => {
    const box = recovery[front]
    return box && box < 9 ? [[front, box + 1]] : []
  }))
}
