import { scorpionHexDistance } from '../src/import/hex-id.ts'
import { remainingSteps } from '../src/match/scorpion-losses.ts'
import { submitScorpionDemo } from './scorpion-demo-commands.mjs'
import { scorpionSupplyPosition } from '../src/match/scorpion-supply-position.ts'
import { scorpionBarrageFrontAt } from '../src/ttw/scorpion/barrage-markers.ts'
import { scorpionSupplyNetwork } from '../src/ttw/scorpion/supply-trace.ts'

export function sampleScorpionFrontBarrage(start, assets, board) {
  const { map } = assets
  const { units } = start.state
  const network = scorpionSupplyNetwork(map, scorpionSupplyPosition(start.state, map, 'soviet'))
  const friendly = Object.entries(units).filter(([, unit]) => unit.side === 'soviet' && unit.combat)
  const headquarters = friendly.filter(([, unit]) => unit.headquarters)
  const targets = new Set(Object.values(units).filter((unit) => unit.side === 'axis' && unit.combat).map((unit) => unit.hex))
  for (const center of targets) {
    if (!friendly.some(([, unit]) => map.neighbors(center).includes(unit.hex))) continue
    const [hqId] = headquarters.find(([id]) => network.inThrowRange(id, center)) ?? []
    const [battery] = friendly.find(([, unit]) => unit.artillery?.strength > 0 && unit.reserve === undefined &&
      !unit.disorganized && !unit.moveMode && scorpionHexDistance(unit.hex, center) <= unit.artillery.range) ?? []
    if (!hqId || !battery) continue
    const front = scorpionBarrageFrontAt(center)
    const submit = (record, side, action) => submitScorpionDemo(record, side,
      { id: `front-barrage-example-${record.revision}`, expectedRevision: record.revision, action }, assets, board).record
    const deployed = submit(start, 'soviet', { type: 'declare-front-barrage', front, center, hqId,
      volleys: [{ target: center, batteries: [{ unitId: battery }] }] })
    let finished = submit(deployed, 'axis', { type: 'choose-barrage-terrain', terrain: map.hexes.get(center).terrains[0] })
    const result = finished.state.barrageHistory.at(-1)
    if (result.lossesDue) {
      let remainder = result.lossesDue
      const allocation = []
      for (const [id, unit] of Object.entries(finished.state.units)) {
        if (!remainder) break
        if (unit.side !== 'axis' || !unit.combat || unit.hex !== center) continue
        const steps = Math.min(remainder, remainingSteps(unit))
        allocation.push({ unitId: id, steps })
        remainder -= steps
      }
      finished = submit(finished, 'axis', { type: 'assign-barrage-loss', allocation })
    }
    return { deployed, finished, front, center, result }
  }
  throw new Error('No legal turn-one target for the Scorpion front barrage example')
}
