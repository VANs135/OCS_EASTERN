import type { ScorpionSetupAssets } from '../match/scorpion-setup.ts'

export function scorpionSupplyCounters(id: string, tokens: number, aliases: ScorpionSetupAssets['catalog']['aliases']) {
  const counters = []
  while (tokens > 0) {
    const points = Math.min(5, Math.floor(tokens / 4))
    const used = points ? points * 4 : tokens
    const label = points ? `${points} SP` : `${used}T`
    const ref = points ? `Supply Point ${points}` : `Supply Ton ${used}T`
    const matches = aliases.get(ref)
    const asset = matches?.length === 1 ? matches[0]!.source.faces.combat?.asset : undefined
    if (!asset) throw new Error(`Missing supply counter ${ref}`)
    counters.push({ id: `${id}:${counters.length + 1}`, label, asset })
    tokens -= used
  }
  return counters
}
