import type { scorpionBreakdownStock } from '../match/scorpion-breakdowns.ts'
import type { ScorpionSetupAssets } from '../match/scorpion-setup.ts'

type Box = { x: number; y: number; w: number; h: number }
type Counter = { id: string; label: string; asset: string; x: number; y: number; size: number }
type Card = { counters: Counter[]; captions: { x: number; y: number; text: string }[] }

export function scorpionBreakdownCardViews(stock: ReturnType<typeof scorpionBreakdownStock>, catalog: ScorpionSetupAssets['catalog'],
  boxes?: ReadonlyMap<string, Box>) {
  const cards: Record<string, Card> = {}
  if (!boxes) return cards
  for (const { definition, side, copies, availableIds } of stock) {
    const box = boxes.get(definition)
    const source = catalog.definitions.get(definition)?.source
    if (!box || !source) continue
    const key = `${side}-breakdowns`
    const card = cards[key] ??= { counters: [], captions: [] }
    const asset = source.faces.combat?.asset
    const size = Math.min(box.w, box.h) * 0.75
    const spacing = availableIds.length > 1 ? Math.min(7, (box.w - size) / (availableIds.length - 1)) : 0
    const first = box.x + (box.w - spacing * (availableIds.length - 1)) / 2
    if (asset) availableIds.forEach((id, index) => card.counters.push({ id, asset,
      label: `${source.name} · 可用 ${availableIds.length}/${copies}`, x: first + spacing * index, y: box.y + box.h / 2, size }))
    if (!asset || !availableIds.length) card.captions.push({ x: box.x, y: box.y, text: `${availableIds.length}/${copies}` })
  }
  return cards
}
