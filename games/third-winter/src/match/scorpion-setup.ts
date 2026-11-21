import { createRngState, pickIndex } from '@ocs-eastern/series/rng'
import type { RngState, Side } from '@ocs-eastern/series/state-types'
import { scorpionHexId } from '../import/hex-id.ts'
import { deployScorpionGroundCounter, scorpionGroundDeployment } from '../import/scorpion-deployment.ts'
import type { DeployedCounter, GroundSetupRow } from '../import/scorpion-deployment.ts'
import type { ScorpionMap } from '../import/scorpion-map.ts'
import type { BackupUnit } from '../import/unit-backup.ts'
import type { Definition } from '../import/unit-catalog.ts'
import { scorpionOpeningAirBases, scorpionOpeningDumps } from '../ttw/scorpion/setup-stores.ts'
import { placeScorpionOffMapAircraft, scorpionSetupBoxPieces } from './scorpion-box-pieces.ts'
import type { ScorpionBoxPiece } from './scorpion-box-pieces.ts'
import type { ScorpionBreakdownRules } from './scorpion-breakdowns.ts'
import type { ScorpionDropPlan } from './scorpion-drop-plan.ts'
import type { AlertCounter, SupplyDump } from './scorpion-reinforcement-state.ts'
import type { TransportCounterLimit } from './scorpion-transport-points.ts'

type UnitDefinition = Definition<BackupUnit>
export interface ScorpionSetupData {
  units: readonly GroundSetupRow[]
  air: readonly { ref: string }[]
  dead_pile: readonly { ref: string }[]
  pools: { alert: readonly { ref: string; count: number }[] }
}

export interface ScorpionSetupAssets {
  map: ScorpionMap
  breakdowns?: ScorpionBreakdownRules
  /** Verified physical stock for voluntary transport reorganization, if supplied by the scenario. */
  transportCounterLimits?: readonly TransportCounterLimit[]
  catalog: {
    definitions: ReadonlyMap<string, UnitDefinition>
    aliases: ReadonlyMap<string, readonly UnitDefinition[]>
  }
}

interface LossChoice {
  candidates: readonly [string, string]
  stepsLost: number
  selected?: string
}

export interface ScorpionSetup {
  seat: Side
  rng: RngState
  units: Readonly<Record<string, DeployedCounter>>
  pieces: readonly ScorpionBoxPiece[]
  lossChoices: readonly LossChoice[]
  drawnAlerts: readonly AlertCounter[]
  availableAlerts: readonly AlertCounter[]
  dumps: Readonly<Record<string, SupplyDump>>
  dropPlan?: ScorpionDropPlan | null
}

export type ScorpionSetupAction =
  | { type: 'base-aircraft'; id: string; base: { kind: 'off-map-air' } | { kind: 'hex'; hex: string } }
  | { type: 'place-setup-alert'; id: string; hex: string }
  | { type: 'choose-setup-loss'; id: string }
  | { type: 'confirm-setup' }

export function createScorpionSetup(data: ScorpionSetupData, { map, catalog }: ScorpionSetupAssets, seed: number): ScorpionSetup {
  const { units, lossChoices } = scorpionGroundDeployment(data.units, catalog.aliases, map)
  const pieces = scorpionSetupBoxPieces(data, catalog.aliases)
  const pool = data.pools.alert.flatMap(({ ref, count }) => {
    const aliases = catalog.aliases.get(ref)
    const definition = aliases?.length === 1 ? aliases[0] : undefined
    if (!definition?.source.abilities?.includes('alert_battalion') || definition.source.side !== 'axis' ||
      !Number.isSafeInteger(count) || count < 1) throw new Error(`Invalid Alert pool entry: ${ref}`)
    const onMap = Object.values(units).filter((unit) => unit.definition === definition.key).length
    if (onMap > count) throw new Error(`Alert pool is missing printed counters: ${ref}`)
    return Array.from({ length: count - onMap }, (_, index) => ({
      id: `alert:${definition.key}:${onMap + index + 1}`, definition: definition.key,
    }))
  })
  if (pool.length < 2 || new Set(pool.map(({ id }) => id)).size !== pool.length) throw new Error('Invalid setup Alert pool')
  const first = pickIndex(createRngState(seed), pool.length)
  const firstAlert = pool.splice(first.value, 1)[0]!
  const second = pickIndex(first.rng, pool.length)
  const secondAlert = pool.splice(second.value, 1)[0]!
  const dumps = Object.fromEntries(scorpionOpeningDumps.map(({ hex, side, tokens }) => {
    if (!map.hexes.has(hex)) throw new Error(`Missing opening dump hex ${hex}`)
    return [`${side}:hex:${hex}`, { side, tokens, location: 'on-map' as const }]
  }))
  for (const { hex } of scorpionOpeningAirBases) {
    if (!map.hexes.has(hex)) throw new Error(`Missing opening air base ${hex}`)
  }
  return { seat: 'axis', rng: second.rng, units, pieces, lossChoices, drawnAlerts: [firstAlert, secondAlert],
    availableAlerts: pool, dumps }
}

/** A null result hands the final confirmed position to the first player turn. */
export function applyScorpionSetup(
  state: Readonly<ScorpionSetup>, actor: Side, action: ScorpionSetupAction, assets: ScorpionSetupAssets,
): ScorpionSetup | null {
  if (actor !== state.seat) throw new Error('This side has not been invited to deploy')
  switch (action.type) {
    case 'base-aircraft': return { ...state, pieces: baseAircraft(state.pieces, actor, action) }
    case 'place-setup-alert': return placeAlert(state, action.id, action.hex, assets)
    case 'choose-setup-loss': return chooseLoss(state, action.id)
    case 'confirm-setup':
      if (state.pieces.some((piece) => piece.side === actor && piece.location.kind === 'air-setup') ||
        (actor === 'axis' && state.drawnAlerts.some(({ id }) => !Object.hasOwn(state.units, id))) ||
        (actor === 'soviet' && state.lossChoices.some((choice) => !choice.selected))) {
        throw new Error('Complete all required deployment choices before confirming')
      }
      return actor === 'axis' ? { ...state, seat: 'soviet' } : null
    default: throw new Error('Unknown Scorpion deployment action')
  }
}

function baseAircraft(
  pieces: readonly ScorpionBoxPiece[], actor: Side, action: Extract<ScorpionSetupAction, { type: 'base-aircraft' }>,
): readonly ScorpionBoxPiece[] {
  if (action.base.kind === 'off-map-air') return placeScorpionOffMapAircraft(pieces, actor, action.id)
  const aircraft = pieces.find(({ id }) => id === action.id)
  const hex = scorpionHexId(action.base.hex)
  const base = scorpionOpeningAirBases.find((entry) => entry.side === actor && entry.hex === hex)
  if (!aircraft || aircraft.side !== actor || aircraft.kind !== 'aircraft' || aircraft.location.kind === 'dead-pile' || !base) {
    throw new Error('Choose a friendly air base for this aircraft')
  }
  // OCS Set Up Notes E and 14.2a. Both full and reduced aircraft begin Active.
  const atBase = pieces.filter(({ id, location }) => id !== aircraft.id && location.kind === 'hex' && location.hex === hex)
  if (atBase.length >= airbaseActiveCapacity(base.level)) throw new Error('Active aircraft would overstack the air base')
  return pieces.map((piece) => piece.id === aircraft.id ? { ...piece, location: { kind: 'hex', hex } } : piece)
}

function placeAlert(state: Readonly<ScorpionSetup>, id: string, at: string, { catalog, map }: ScorpionSetupAssets): ScorpionSetup {
  const alert = state.seat === 'axis' ? state.drawnAlerts.find((counter) => counter.id === id) : undefined
  const definition = alert && catalog.definitions.get(alert.definition)
  const hex = scorpionHexId(at)
  const stack = Object.entries(state.units).filter(([key, unit]) => key !== id && unit.hex === hex)
  if (!definition || !map.hexes.has(hex) || !stack.some(([key, unit]) => key.startsWith('setup:') && unit.side === 'axis')) {
    throw new Error('A drawn Alert must be placed with a printed German ground unit')
  }
  const unit = deployScorpionGroundCounter(definition, hex, 0)
  const stackRe = stack.reduce((total, [, item]) => total + item.printedRe - item.stepsLost, unit.printedRe)
  if (stackRe > 10) throw new Error('Alert would overstack the hex')
  return { ...state, units: { ...state.units, [id]: unit } }
}

function chooseLoss(state: Readonly<ScorpionSetup>, id: string): ScorpionSetup {
  const choice = state.seat === 'soviet' ? state.lossChoices.find(({ candidates }) => candidates.includes(id)) : undefined
  if (!choice) throw new Error('Choose a Soviet unit from a printed step-loss pair')
  if (choice.selected === id) return state
  const units = { ...state.units }
  for (const candidate of choice.candidates) {
    units[candidate] = { ...units[candidate]!, stepsLost: candidate === id ? choice.stepsLost : 0 }
  }
  return { ...state, units, lossChoices: state.lossChoices.map((item) => item === choice ? { ...item, selected: id } : item) }
}
import { airbaseActiveCapacity } from '@ocs-eastern/series/airbase'
