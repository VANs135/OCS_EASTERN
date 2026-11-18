import { airbaseActiveCapacity } from '@ocs-eastern/series/airbase'
import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionHexDistance } from '../import/hex-id.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import { mayHipShoot } from '../ttw/air/mission-permission.ts'
import type { ScorpionBoxPiece } from './scorpion-box-pieces.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'

export type ScorpionAirBase = { kind: 'hex'; hex: string } | { kind: 'off-map-air' }

export function atAirBase(location: ScorpionBoxPiece['location'], base: ScorpionAirBase) {
  return location.kind === 'hex' ? base.kind === 'hex' && location.hex === base.hex : location.kind === base.kind
}

export function friendlyAirBases(state: Readonly<ScorpionInPlay>, side: Side): ScorpionAirBase[] {
  return [...state.airBases.filter((base) => base.side === side).map(({ hex }) => ({ kind: 'hex' as const, hex })),
    { kind: 'off-map-air' }]
}

/** TTW Scenarios p.53 and player ruling treat flights to or from the box as within normal range. */
export function inScorpionAirRange(from: ScorpionAirBase, to: ScorpionAirBase, range: number) {
  return from.kind !== 'hex' || to.kind !== 'hex' || scorpionHexDistance(from.hex, to.hex) <= range
}

export function printedAirRange(source: BackupUnit | undefined, reduced: boolean | undefined, definition: string) {
  const range = (reduced ? source?.faces.move : source?.faces.combat)?.stats.range
  if (typeof range !== 'number' || !Number.isFinite(range) || range <= 0) {
    throw new Error(`Missing printed aircraft range for ${definition}`)
  }
  return range
}

// TTW aircraft faces. The backup omits fractional transport ratings on these faces.
const printedTransport = new Map<string, readonly [number, number]>([
  ['Ge He.111H', [0.5, 0]], ['Ge He.177', [0.5, 0]], ['Ge Ju.52', [1, 0.5]], ['Sov Li.2', [1, 0.5]],
])

export function aircraftProfile(piece: ScorpionBoxPiece, { catalog }: ScorpionSetupAssets) {
  const source = catalog.definitions.get(piece.definition)?.source
  const stats = (piece.reduced ? source?.faces.move : source?.faces.combat)?.stats
  const range = printedAirRange(source, piece.reduced, piece.definition)
  const { airCombat, bombing } = stats ?? {}
  if (typeof airCombat !== 'number' || !Number.isFinite(airCombat) ||
    typeof bombing !== 'number' || !Number.isFinite(bombing)) {
    throw new Error(`Missing printed aircraft rating for ${piece.definition}`)
  }
  const airArmy = /^(\d+)(?:st|nd|rd|th) Air Army$/.exec(source?.org?.airGroup ?? '')?.[1] ?? null
  const fighter = source?.abilities?.includes('interception') === true
  const name = source?.name ?? ''
  const transport = typeof stats?.transport === 'number' ? stats.transport : (printedTransport.get(name)?.[piece.reduced ? 1 : 0] ?? 0)
  const airframe = /\b(Ju\.87|Hs\.129)[A-Z]?\b/.exec(name)?.[1] ?? ''
  const tankBuster = piece.side === 'axis' && /\b(?:Hs\.129|Ju\.87G)\b/.test(name)
  return { range, airCombat, bombing, airArmy, fighter, tankBuster, transport, hipShoot: mayHipShoot(piece.side, airframe) }
}

export function activeAirfieldExcess(state: Readonly<ScorpionInPlay>, side: Side, destination: ScorpionAirBase) {
  if (destination.kind !== 'hex') return null
  const level = state.airBases.find((base) => base.side === side && base.hex === destination.hex)?.level
  if (level === undefined) return null
  const active = state.pieces.filter((piece) => piece.kind === 'aircraft' && piece.active && piece.side === side &&
    atAirBase(piece.location, destination)).length
  const excess = active - airbaseActiveCapacity(level)
  return excess <= 0 ? null : { side, hex: destination.hex, excess }
}
