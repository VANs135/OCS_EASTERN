import type { ScorpionSetupAssets } from '../match/scorpion-setup.ts'
import type { ScorpionSession } from '../match/scorpion-session.ts'
import { scorpionBarrageFronts } from '../ttw/scorpion/barrage-markers.ts'
import type { HexCounter } from './scorpion-map-counters.ts'

export const scorpionSovietAid = { asset: 'Soviet Off Map.jpg', width: 998, height: 1230 }

const readySlots = [{ x: 907, y: 943 }, { x: 947, y: 943 }] as const
const readyRefs = ['1st Ukr Arty Ready', '2nd Ukr Arty Ready'] as const

interface SurfaceCounter {
  id: string
  label: string
  asset: string
  x: number
  y: number
  size: number
}

export function scorpionBarrageMarkerFrame(state: Readonly<ScorpionSession>, catalog: ScorpionSetupAssets['catalog']) {
  const mapCounters: HexCounter[] = []
  const aidCounters: SurfaceCounter[] = []
  scorpionBarrageFronts.forEach((front, index) => {
    const unit = catalog.aliases.get(readyRefs[index]!)?.[0]
    if (unit?.kind !== 'marker' || !unit.source.faces.combat?.asset || !unit.source.faces.move?.asset) {
      throw new Error(`Missing Scorpion artillery marker faces for ${front}`)
    }
    const id = `artillery:${front}`
    const label = `第 ${index + 1} 乌克兰方面军炮击标记`
    const plan = state.kind === 'playing' ? state.frontBarrage : undefined
    if (plan?.front === front) {
      mapCounters.push({ id, hex: plan.center, label: `${label} · ${plan.center}`, asset: unit.source.faces.combat.asset })
      return
    }
    const box = state.kind === 'playing' ? state.barrageRecovery?.[front] : undefined
    if (box) {
      aidCounters.push({ id, label: `${label} · 恢复格 ${box}`, asset: unit.source.faces.move.asset,
        x: 245 + (box - 1) * 75, y: 962 + index * 62, size: 44 })
      return
    }
    const status = state.kind === 'playing' && state.turn.number > 1 ? '剧本使用时限已过' : '就绪'
    aidCounters.push({ id, label: `${label} · ${status}`, asset: unit.source.faces.combat.asset,
      ...readySlots[index]!, size: 35 })
  })
  return { mapCounters, aidCounters }
}
