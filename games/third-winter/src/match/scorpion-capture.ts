import { rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import { airBaseCaptureLoss, capturedAmount } from '@ocs-eastern/series/tables/capture'
import { scorpionHexDistance, scorpionHexId } from '../import/hex-id.ts'
import { printedAirRange } from './scorpion-air-bases.ts'
import type { ScorpionAirBase } from './scorpion-air-bases.ts'
import type { ScorpionBoxPiece } from './scorpion-box-pieces.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { rollScorpionTransportCapture, settleScorpionTransports } from './scorpion-transport-capture.ts'
import type { CapturedTransportGroup, TransportCaptureChoice } from './scorpion-transport-capture.ts'

type AirDisplacement = { id: string; destinations: readonly ScorpionAirBase[] }

export interface ScorpionCaptureWindow {
  hex: string
  captor: Side
  owner: Side
  aircraft: readonly AirDisplacement[]
  transports: readonly CapturedTransportGroup[]
}

export interface ScorpionCaptureReport {
  hex: string
  captor: Side
  dump?: { die: number; taken: number; destroyed: number }
  aircraft: readonly { id: string; die: number; loss: boolean; eliminated: boolean }[]
  transports: readonly CapturedTransportGroup[]
}

export type SettleScorpionCapture = { type: 'settle-capture'; aircraft: readonly { id: string; destination: ScorpionAirBase }[];
  transports?: readonly TransportCaptureChoice[] }

const opposite = (side: Side): Side => side === 'axis' ? 'soviet' : 'axis'

function scorpionCaptureAt(state: Readonly<ScorpionInPlay>, side: Side, hex: string) {
  const owner = opposite(side)
  const dump = state.dumps[`${owner}:hex:${hex}`]
  const transports = Object.entries(state.units).filter(([, unit]) => !unit.combat && unit.side === owner && unit.hex === hex)
    .map(([id]) => id)
  return { owner, dump, transports,
    airBase: state.airBases?.some((base) => base.side === owner && base.hex === hex),
    aircraft: state.pieces.filter((piece) => piece.kind === 'aircraft' && piece.side === owner &&
      piece.location.kind === 'hex' && piece.location.hex === hex),
  }
}

function assertScorpionCaptor(state: Readonly<ScorpionInPlay>, side: Side, hex: string, ids: readonly string[]) {
  const objects = scorpionCaptureAt(state, side, hex)
  if ((objects.dump?.tokens || objects.airBase || objects.aircraft.length || objects.transports.length) &&
    !ids.some((id) => state.units[id]?.side === side && state.units[id]!.attackCapable)) {
    throw new Error('Entry into a hex with enemy stores or an air base needs an attack-capable unit')
  }
  return objects
}

export function resolveScorpionMoveEntries(state: Readonly<ScorpionInPlay>, side: Side, hexes: readonly string[],
  ids: readonly string[], assets: ScorpionSetupAssets): ScorpionInPlay {
  let moved = state
  for (const [index, hex] of hexes.entries()) {
    moved = resolveScorpionEntry(moved, side, hex, ids, assets, false)
    if (moved.capture && index !== hexes.length - 1) throw new Error('End this move at the pending capture hex')
  }
  return moved
}

export function resolveScorpionEntry(state: Readonly<ScorpionInPlay>, side: Side, hex: string, ids: readonly string[],
  assets: ScorpionSetupAssets, afterCombat: boolean): ScorpionInPlay {
  const { owner, dump, airBase, aircraft, transports } = assertScorpionCaptor(state, side, hex, ids)
  if (!dump?.tokens && !airBase && !aircraft.length && !transports.length) return state
  if (state.capture) throw new Error('Resolve the previous special capture first')
  let rng = state.rng
  const roll = () => {
    const draw = rollDie(rng)
    rng = draw.rng
    return draw.value
  }
  const dumps = { ...state.dumps }
  const transportResults = rollScorpionTransportCapture(state, transports, assets, roll)
  let dumpResult: ScorpionCaptureReport['dump']
  if (dump?.tokens) {
    const die = roll()
    const taken = capturedAmount(dump.tokens, 'dump', die)
    delete dumps[`${owner}:hex:${hex}`]
    const key = `${side}:hex:${hex}`
    if (taken) dumps[key] = { side, location: 'on-map', tokens: (dumps[key]?.tokens ?? 0) + taken }
    dumpResult = { die, taken, destroyed: dump.tokens - taken }
  }
  const airBases = airBase ? state.airBases.map((base) =>
    base.side === owner && base.hex === hex ? { ...base, side } : base) : state.airBases
  const displaced: AirDisplacement[] = []
  const aircraftResults: ScorpionCaptureReport['aircraft'][number][] = []
  const atRisk = new Set(aircraft.map((piece) => piece.id))
  const pieces = state.pieces.map((piece) => {
    if (!atRisk.has(piece.id)) return piece
    const die = roll()
    const loss = airBaseCaptureLoss(die, piece.active === true, afterCombat)
    const reduced = Boolean(piece.reduced || loss)
    const destinations = loss && piece.reduced ? [] : airDestinations(piece, reduced, hex, airBases, assets)
    aircraftResults.push({ id: piece.id, die, loss, eliminated: !destinations.length })
    if (!destinations.length) return { ...piece, active: false, reduced, location: { kind: 'dead-pile' as const } }
    displaced.push({ id: piece.id, destinations })
    return { ...piece, active: false, reduced }
  })
  const capture = displaced.length || transportResults.length
    ? { hex, captor: side, owner, aircraft: displaced, transports: transportResults } : null
  return { ...state, rng, dumps, airBases, pieces, capture,
    captureHistory: [...(state.captureHistory ?? []), { hex, captor: side, dump: dumpResult,
      aircraft: aircraftResults, transports: transportResults }] }
}

export function settleScorpionCapture(state: Readonly<ScorpionInPlay>, side: Side, action: SettleScorpionCapture,
  assets: ScorpionSetupAssets): ScorpionInPlay {
  const capture = state.capture
  if (!capture || capture.owner !== side || capture.aircraft.length !== action.aircraft.length) {
    throw new Error('The original owner must resolve every pending displacement')
  }
  const chosen = new Map(action.aircraft.map(({ id, destination }) => [id, destination.kind === 'hex'
    ? { kind: 'hex' as const, hex: scorpionHexId(destination.hex) } : destination]))
  if (chosen.size !== capture.aircraft.length || capture.aircraft.some(({ id, destinations }) => {
    const destination = chosen.get(id)
    return !destinations.some((allowed) => destination?.kind === allowed.kind &&
      (allowed.kind === 'off-map-air' || (destination.kind === 'hex' && destination.hex === allowed.hex)))
  })) throw new Error('Choose a legal displacement destination for each surviving aircraft')
  const pieces = state.pieces.map((piece) => {
    const location = chosen.get(piece.id)
    return location ? { ...piece, location, active: false } : piece
  })
  const settled = settleScorpionTransports(state, action.transports ?? [], assets)
  return { ...settled, pieces, capture: null }
}

function airDestinations(piece: ScorpionBoxPiece, reduced: boolean, from: string, airBases: ScorpionInPlay['airBases'],
  { catalog }: ScorpionSetupAssets): ScorpionAirBase[] {
  const range = printedAirRange(catalog.definitions.get(piece.definition)?.source, reduced, piece.definition)
  return [...airBases.filter((base) => base.side === piece.side && base.hex !== from &&
    scorpionHexDistance(from, base.hex) <= range * 2).map((base) => ({ kind: 'hex' as const, hex: base.hex })),
  { kind: 'off-map-air' }]
}
