import type { Side } from '@ocs-eastern/series/state-types'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { Definition } from '../import/unit-catalog.ts'
import type { ScorpionBoxPiece } from '../match/scorpion-box-pieces.ts'
import type { SupplyDump } from '../match/scorpion-reinforcement-state.ts'
import { currentScorpionTurn } from '../match/scorpion-round.ts'
import type { ScorpionPlayerProgress } from '../match/scorpion-round.ts'
import { scorpionFirstTurn } from '../match/scorpion-session.ts'
import type { ScorpionSession } from '../match/scorpion-session.ts'
import type { ScorpionTurn } from '../ttw/scorpion/pre-turn.ts'
import { scorpionDates } from '../ttw/scorpion/weather.ts'
import type { SurfaceLayout } from './calibrated-surface.ts'
import { scorpionSupplyCounters } from './scorpion-supply-counters.ts'

const flightCell = { none: 23, limited: 24, normal: 25 } as const
const flightLabel = { none: '禁飞', limited: '飞行受限', normal: '正常飞行' } as const
const inventoryCells = { axis: { dead: 19, air: 20 }, soviet: { dead: 27, air: 26 } } as const

type DefinitionIndex = ReadonlyMap<string, Definition<BackupUnit>>
type AliasIndex = ReadonlyMap<string, readonly Definition<BackupUnit>[]>

export function scorpionSessionBoxFrame(
  state: Readonly<ScorpionSession>, catalog: { definitions: DefinitionIndex; aliases: AliasIndex }, viewer?: Side,
) {
  if (state.kind === 'setup') return scorpionBoxFrame(scorpionFirstTurn(), state.opening.pieces, catalog, undefined, viewer)
  return scorpionBoxFrame(state.turn, state.pieces, catalog,
    state.turn.step.kind === 'player-turn' ? state : undefined, viewer, state.dumps)
}

export function scorpionBoxFrame(
  turn: Readonly<ScorpionTurn>, pieces: readonly ScorpionBoxPiece[],
  catalog: { definitions: DefinitionIndex; aliases: AliasIndex },
  player?: ScorpionPlayerProgress, viewer?: Side, dumps: Readonly<Record<string, SupplyDump>> = {},
) {
  const current = currentScorpionTurn(turn, player)
  const date = scorpionDates[current.number - 1]
  if (!date || !Number.isSafeInteger(current.vp)) throw new Error('Invalid Scorpion record track state')

  function marker(cell: number, id: string, ref: string, label: string) {
    const matches = catalog.aliases.get(ref)
    const definition = matches?.length === 1 ? matches[0] : undefined
    const asset = definition?.source.faces.combat?.asset
    if (definition?.kind !== 'marker' || !asset) throw new Error(`Missing map marker: ${ref}`)
    return { cell, id, asset, label }
  }

  const trackers = [
    marker(10 + current.number, 'turn', 'Turn', `第 ${current.number} 回合　${date}`),
    marker(current.weather.ground === 'freeze' ? 21 : 22, 'ground', 'Ground',
      current.weather.ground === 'freeze' ? '冻结' : '解冻'),
    marker(flightCell[current.weather.flight], 'flight', 'Flight', flightLabel[current.weather.flight]),
    // The two end boxes are the printed overflow spaces. The label keeps the exact tally.
    marker(33 + Math.min(20, Math.max(-5, current.vp)), 'vp', 'Soviet VPs Tracker', `苏军净胜利分 ${current.vp}`),
  ]

  const inventories = (['axis', 'soviet'] as const).flatMap((side) => {
    const cells = inventoryCells[side]
    const sideName = side === 'axis' ? '轴心国' : '苏联'
    const boxes = [{ cell: cells.dead, label: `${sideName}死人堆`, kind: 'dead-pile' },
      { cell: cells.air, label: `${sideName}地图外空军`, kind: 'off-map-air' }] as const
    return boxes.map(({ cell, label, kind }) => {
      const hidden = kind === 'off-map-air' && viewer !== undefined && viewer !== side
      const counters = hidden ? [] : pieces.filter((piece) => piece.side === side && piece.location.kind === kind)
        .map((piece) => {
          const definition = catalog.definitions.get(piece.definition)
          const source = definition?.source
          const face = piece.reduced ? source?.faces.move : source?.faces.combat
          if (!source || source.side !== side || !face?.asset ||
            (kind === 'off-map-air' && (piece.kind !== 'aircraft' || definition?.kind !== 'aircraft'))) {
            throw new Error(`Invalid counter in ${label}: ${piece.id}`)
          }
          return { id: piece.id, asset: face.asset, label: source.name,
            ...(kind === 'off-map-air' && piece.active === false ? { badges: [{ text: '停', label: '非激活' }] } : {}) }
        })
      const dumpId = `${side}:air-box`
      const supply = dumps[dumpId]
      const stores = !hidden && kind === 'off-map-air' && supply?.side === side && supply.location === 'off-map'
        ? scorpionSupplyCounters(dumpId, supply.tokens, catalog.aliases) : []
      return { cell, label, counters: [...counters, ...stores], hidden }
    })
  })
  return { trackers, inventories }
}

export function scorpionSurfaceBoxes(surface: SurfaceLayout) {
  if (surface.width !== 3111 || surface.height !== 1969) throw new Error('Wrong calibration for the Scorpion artwork')
  return Array.from({ length: 43 }, (_, index) => {
    const id = index + 11
    const rect = surface.boxes.get(id)
    if (!rect) throw new Error(`Missing Scorpion map box ${id}`)
    return { id, ...rect }
  })
}
