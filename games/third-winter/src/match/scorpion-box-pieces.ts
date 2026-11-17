import type { Side } from '@ocs-eastern/series/state-types'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { Definition } from '../import/unit-catalog.ts'

export type ScorpionPieceLocation =
  | { kind: 'hex'; hex: string }
  | { kind: 'air-setup' | 'dead-pile' | 'off-map-air' }

export interface ScorpionBoxPiece {
  id: string
  side: Side
  kind: 'aircraft' | 'ground'
  definition: string
  location: ScorpionPieceLocation
  reduced?: boolean
  active?: boolean
}

/** TTW Scenarios pp.54–56. Aircraft leave the setup list only once a basing choice has been made. */
export function scorpionSetupBoxPieces(
  setup: { air: readonly { ref: string }[]; dead_pile: readonly { ref: string }[] },
  aliases: ReadonlyMap<string, readonly Definition<BackupUnit>[]>,
): ScorpionBoxPiece[] {
  const reducedGroups = new Set(['Sov Pe.2', 'Sov IL.4', 'Sov Yak.9'])
  const copies = new Map<string, number>()

  function piece(ref: string, location: 'air-setup' | 'dead-pile'): ScorpionBoxPiece {
    const matches = aliases.get(ref)
    const definition = matches?.length === 1 ? matches[0] : undefined
    const kind = location === 'air-setup' ? 'aircraft' : 'land'
    if (!definition?.source.side || definition.kind !== kind) throw new Error(`Invalid Scorpion setup counter: ${ref}`)
    const copy = (copies.get(definition.key) ?? 0) + 1
    copies.set(definition.key, copy)
    return { id: `${location}:${definition.key}:${copy}`, side: definition.source.side, definition: definition.key,
      kind: location === 'air-setup' ? 'aircraft' : 'ground', location: { kind: location },
      reduced: reducedGroups.has(ref) && copy === 1, active: location === 'air-setup' ? true : undefined }
  }

  return [...setup.dead_pile.map(({ ref }) => piece(ref, 'dead-pile')),
    ...setup.air.map(({ ref }) => piece(ref, 'air-setup'))]
}

/** TTW Scenarios p.53 permits either side to base an aircraft in its off-map box. */
export function placeScorpionOffMapAircraft(
  pieces: readonly ScorpionBoxPiece[], actor: Side, id: string,
): ScorpionBoxPiece[] {
  const piece = pieces.find((item) => item.id === id)
  if (!piece || piece.side !== actor || piece.kind !== 'aircraft' || piece.location.kind === 'dead-pile') {
    throw new Error('This aircraft cannot be placed off-map during setup')
  }
  return pieces.map((item) => item.id === id ? { ...item, location: { kind: 'off-map-air' } } : item)
}
