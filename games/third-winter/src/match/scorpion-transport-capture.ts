import type { RollDie } from '@ocs-eastern/series/dice'
import type { Side } from '@ocs-eastern/series/state-types'
import { capturedAmount } from '@ocs-eastern/series/tables/capture'
import { deployScorpionGroundCounter } from '../import/scorpion-deployment.ts'
import { scorpionHexDistance, scorpionHexId } from '../import/hex-id.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'

type TransportClass = 'trucks' | 'wagons'
type TransportMember = { id: string; points: number; tokens: number }
export interface CapturedTransportGroup {
  kind: TransportClass
  die: number
  members: readonly TransportMember[]
  points: number
  tokens: number
}

export type TransportCaptureChoice = { id: string; takenPoints: number; takenTokens: number; displacedTo?: string }

export function rollScorpionTransportCapture(state: Readonly<ScorpionInPlay>, ids: readonly string[],
  assets: ScorpionSetupAssets, roll: RollDie): CapturedTransportGroup[] {
  const members: Record<TransportClass, TransportMember[]> = { trucks: [], wagons: [] }
  for (const id of ids) {
    const unit = state.units[id]!
    const capacity = assets.catalog.definitions.get(unit.definition)?.source.faces.combat?.stats.transport
    if (typeof capacity !== 'number' || !Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error(`Missing printed transport capacity for ${unit.definition}`)
    }
    members[unit.allowance > 10 ? 'trucks' : 'wagons'].push({
      id, points: capacity, tokens: unit.transportCargoTokens ?? (unit.organicTruck === 'full' ? capacity * 4 : 0),
    })
  }
  return (['trucks', 'wagons'] as const).flatMap((kind) => {
    if (!members[kind].length) return []
    const die = roll()
    return [{ kind, die, members: members[kind],
      points: capturedAmount(members[kind].reduce((total, unit) => total + unit.points, 0), kind, die),
      tokens: capturedAmount(members[kind].reduce((total, unit) => total + unit.tokens, 0), kind, die) }]
  })
}

export function settleScorpionTransports(state: Readonly<ScorpionInPlay>, choices: readonly TransportCaptureChoice[],
  assets: ScorpionSetupAssets): ScorpionInPlay {
  const capture = state.capture!
  const { hex, captor, owner, transports } = capture
  const selected = new Map(choices.map((choice) => [choice.id, choice]))
  const count = transports.reduce((total, group) => total + group.members.length, 0)
  if (choices.length !== count || selected.size !== count) throw new Error('Choose outcomes for every affected transport')
  const units = { ...state.units }
  const dumps = { ...state.dumps }

  function placeCapacity(member: TransportMember, kind: TransportClass, side: Side, at: string,
    points: number, tokens: number) {
    const source = state.units[member.id]!
    let cargo = tokens
    if (points === member.points && side === owner) {
      units[member.id] = { ...source, hex: at, reserve: undefined, transportCargoTokens: Math.min(cargo, points * 4) }
      cargo -= Math.min(cargo, points * 4)
    } else {
      const nation = side === 'axis' ? 'Ge' : 'Sov'
      const alias = `${nation} ${kind === 'trucks' ? 'Truck' : 'Wagon'}`
      const definition = assets.catalog.aliases.get(alias)?.[0]
      if (points && !definition) throw new Error(`Missing one-point transport counter: ${alias}`)
      for (let copy = 1; copy <= points; copy++) {
        const id = `captured:${state.captureHistory!.length}:${side}:${copy}:${member.id}`
        const carried = Math.min(cargo, 4)
        units[id] = { ...deployScorpionGroundCounter(definition!, at, 0), transportCargoTokens: carried }
        cargo -= carried
      }
    }
    if (cargo) {
      const key = `${side}:hex:${at}`
      dumps[key] = { side, location: 'on-map', tokens: (dumps[key]?.tokens ?? 0) + cargo }
    }
  }

  for (const group of transports) {
    let points = 0
    let tokens = 0
    for (const member of group.members) {
      const choice = selected.get(member.id)
      if (!choice || !Number.isSafeInteger(choice.takenPoints) || choice.takenPoints < 0 || choice.takenPoints > member.points ||
        !Number.isSafeInteger(choice.takenTokens) || choice.takenTokens < 0 || choice.takenTokens > member.tokens) {
        throw new Error('Invalid captured transport or cargo quantity')
      }
      points += choice.takenPoints
      tokens += choice.takenTokens
      const left = member.points - choice.takenPoints
      const remainingCargo = member.tokens - choice.takenTokens
      const at = choice.displacedTo && scorpionHexId(choice.displacedTo)
      const range = group.kind === 'trucks' ? 10 : 5
      if ((left || remainingCargo) && (!at || at === hex || !assets.map.hexes.has(at) || scorpionHexDistance(hex, at) > range)) {
        throw new Error('Choose an in-range displacement hex for the remaining transports and cargo')
      }
      delete units[member.id]
      if (choice.takenPoints || choice.takenTokens) placeCapacity(member, group.kind, captor, hex, choice.takenPoints, choice.takenTokens)
      if (left || remainingCargo) placeCapacity(member, group.kind, owner, at!, left, remainingCargo)
    }
    if (points !== group.points || tokens !== group.tokens) throw new Error('Allocate the exact transport and cargo totals from the capture roll')
  }
  return { ...state, units, dumps }
}
