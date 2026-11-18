import { rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import { airBaseCaptureLoss, capturedAmount } from '@ocs-eastern/series/tables/capture'
import { scorpionHexDistance, scorpionHexId } from '../import/hex-id.ts'
import { printedAirRange } from './scorpion-air-bases.ts'
import type { ScorpionAirBase } from './scorpion-air-bases.ts'
import type { ScorpionBoxPiece } from './scorpion-box-pieces.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { flipScorpionExtender, scorpionExtenderDisplacements } from './scorpion-extender.ts'
import type { ExtenderDisplacement } from './scorpion-extender.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'
import { rollScorpionTransportCapture, settleScorpionTransports } from './scorpion-transport-capture.ts'
import type { CapturedTransportGroup, TransportCaptureChoice } from './scorpion-transport-capture.ts'

type AirDisplacement = { id: string; destinations: readonly ScorpionAirBase[] }

export interface ScorpionCaptureWindow {
  hex: string
  captor: Side
  owner: Side
  aircraft: readonly AirDisplacement[]
  transports: readonly CapturedTransportGroup[]
  extenders?: readonly ExtenderDisplacement[]
}

export interface ScorpionCaptureReport {
  hex: string
  captor: Side
  dump?: { die: number; taken: number; destroyed: number }
  aircraft: readonly { id: string; die: number; loss: boolean; eliminated: boolean }[]
  transports: readonly CapturedTransportGroup[]
  extenders?: readonly ExtenderDisplacement[]
}

export type SettleScorpionCapture = { type: 'settle-capture'; aircraft: readonly { id: string; destination: ScorpionAirBase }[];
  transports?: readonly TransportCaptureChoice[]; extenders?: readonly { id: string; destination: string }[] }

const opposite = (side: Side): Side => side === 'axis' ? 'soviet' : 'axis'

export function scorpionCaptureAt(state: Readonly<ScorpionInPlay>, side: Side, hex: string) {
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
  ids: readonly string[], assets: ScorpionSetupAssets, railroad?: SupplyRailBoard): ScorpionInPlay {
  let moved = state
  for (const [index, hex] of hexes.entries()) {
    moved = resolveScorpionEntry(moved, side, hex, ids, assets, false, railroad)
    if (moved.capture && index !== hexes.length - 1) throw new Error('End this move at the pending capture hex')
  }
  return moved
}

export function resolveScorpionEntry(state: Readonly<ScorpionInPlay>, side: Side, hex: string, ids: readonly string[],
  assets: ScorpionSetupAssets, afterCombat: boolean, railroad?: SupplyRailBoard): ScorpionInPlay {
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
  const extenders = scorpionExtenderDisplacements(state, owner, transports.filter((id) => state.units[id]?.extender), assets.map, railroad)
  const displacedExtenders = extenders.filter(({ destinations }) => destinations.length)
  let flipped = state
  for (const extender of extenders) if (!extender.destinations.length) flipped = flipScorpionExtender(flipped, extender.id, hex, false)
  const transportResults = rollScorpionTransportCapture(flipped,
    transports.filter((id) => !displacedExtenders.some((extender) => extender.id === id)), assets, roll)
  let dumpResult: ScorpionCaptureReport['dump']
  if (dump?.tokens) {
    const die = roll()
    const taken = capturedAmount(dump.tokens, 'dump', die)
    delete dumps[`${owner}:hex:${hex}`]
    const key = `${side}:hex:${hex}`
    if (taken) dumps[key] = { ...dumps[key], side, location: 'on-map', tokens: (dumps[key]?.tokens ?? 0) + taken }
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
  const capture = displaced.length || transportResults.length || displacedExtenders.length
    ? { hex, captor: side, owner, aircraft: displaced, transports: transportResults,
      ...(displacedExtenders.length ? { extenders: displacedExtenders } : {}) } : null
  return { ...flipped, rng, dumps, airBases, pieces, capture,
    captureHistory: [...(state.captureHistory ?? []), { hex, captor: side, dump: dumpResult,
      aircraft: aircraftResults, transports: transportResults, ...(extenders.length ? { extenders } : {}) }] }
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
  const destinations = new Map(action.extenders?.map(({ id, destination }) => [id, scorpionHexId(destination)]))
  const pending = capture.extenders ?? []
  if (destinations.size !== (action.extenders?.length ?? 0) || destinations.size !== pending.length ||
    pending.some(({ id, destinations: allowed }) => !allowed.includes(destinations.get(id) ?? ''))) {
    throw new Error('Choose a supplied displacement hex for each collapsing Extender')
  }
  let settled = settleScorpionTransports(state, action.transports ?? [], assets)
  for (const [id, destination] of destinations) settled = flipScorpionExtender(settled, id, destination, false)
  const history = settled.captureHistory
  const latest = history?.at(-1)
  const captureHistory = pending.length && latest && history ? [...history.slice(0, -1), { ...latest,
    extenders: latest.extenders?.map((entry) => ({ ...entry, displacedTo: destinations.get(entry.id) })) }] : history
  return { ...settled, pieces, capture: null, captureHistory }
}

function airDestinations(piece: ScorpionBoxPiece, reduced: boolean, from: string, airBases: ScorpionInPlay['airBases'],
  { catalog }: ScorpionSetupAssets): ScorpionAirBase[] {
  const range = printedAirRange(catalog.definitions.get(piece.definition)?.source, reduced, piece.definition)
  return [...airBases.filter((base) => base.side === piece.side && base.hex !== from &&
    scorpionHexDistance(from, base.hex) <= range * 2).map((base) => ({ kind: 'hex' as const, hex: base.hex })),
  { kind: 'off-map-air' }]
}
