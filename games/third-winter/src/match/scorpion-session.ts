import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import type { Command, MatchRecord } from '@ocs-eastern/match-core/command-log'
import { pickIndex, rollDie } from '@ocs-eastern/series/rng'
import type { RngState, Side } from '@ocs-eastern/series/state-types'
import { deployScorpionGroundCounter } from '../import/scorpion-deployment.ts'
import type { DeployedCounter } from '../import/scorpion-deployment.ts'
import { openScorpionTurn } from '../ttw/scorpion/pre-turn.ts'
import type { ScorpionTurn } from '../ttw/scorpion/pre-turn.ts'
import { scorpionOpeningAirBases } from '../ttw/scorpion/setup-stores.ts'
import { scorpionWeather } from '../ttw/scorpion/weather.ts'
import type { ScorpionBoxPiece } from './scorpion-box-pieces.ts'
import { applyScorpionGroundMove } from './scorpion-movement.ts'
import type { MoveCommand, MovementBoard } from './scorpion-movement.ts'
import { startScorpionPlayerTurns } from './scorpion-player-turn.ts'
import { applyScorpionReinforcement } from './scorpion-reinforcement.ts'
import type { ReinforcementCommand } from './scorpion-reinforcement.ts'
import type { ReinforcementBoard, ReinforcementState } from './scorpion-reinforcement-state.ts'
import { applyScorpionSetup, createScorpionSetup } from './scorpion-setup.ts'
import type { ScorpionSetup, ScorpionSetupAction, ScorpionSetupAssets, ScorpionSetupData } from './scorpion-setup.ts'

export interface ScorpionInPlay extends ReinforcementState {
  kind: 'playing'
  turn: ScorpionTurn
  rng: RngState
  rerollHolder: Side | null
  airBases: readonly { hex: string; side: Side; level: number }[]
  units: Readonly<Record<string, DeployedCounter>>
  pieces: readonly ScorpionBoxPiece[]
  moved: readonly string[]
}

export type ScorpionSession = { kind: 'setup'; opening: ScorpionSetup } | ScorpionInPlay
export type ScorpionAction = ScorpionSetupAction | ReinforcementCommand | ({ type: 'ground-move' } & MoveCommand)
export type ScorpionSessionRecord = MatchRecord<ScorpionSession, ScorpionAction, Side>
interface BoardPolicies {
  reinforcements?: (state: Readonly<ScorpionInPlay>) => ReinforcementBoard
  movement?: (state: Readonly<ScorpionInPlay>) => Omit<MovementBoard, 'map' | 'weather'>
}

export function createScorpionSession(data: ScorpionSetupData, assets: ScorpionSetupAssets, seed: number): ScorpionSessionRecord {
  return { state: { kind: 'setup', opening: createScorpionSetup(data, assets, seed) }, revision: 0, receipts: [] }
}

export function submitScorpionSession(
  record: Readonly<ScorpionSessionRecord>, seat: Side, command: Readonly<Command<ScorpionAction>>,
  assets: ScorpionSetupAssets, board: BoardPolicies = {},
) {
  return acceptCommand(record, seat, command, (state, actor, action): ScorpionSession => {
    switch (action.type) {
      case 'base-aircraft':
      case 'place-setup-alert':
      case 'choose-setup-loss':
      case 'confirm-setup': {
        if (state.kind !== 'setup') throw new Error('Scorpion deployment is closed')
        const opening = applyScorpionSetup(state.opening, actor, action, assets)
        return opening ? { kind: 'setup', opening } : startMatch(state.opening)
      }
      case 'ground-move':
        if (state.kind !== 'playing' || state.victory || !board.movement) throw new Error('Scorpion movement is unavailable')
        return applyScorpionGroundMove(state, actor, action,
          { ...board.movement(state), map: assets.map, weather: state.turn.weather.ground })
      default:
        if (state.kind !== 'playing' || !board.reinforcements) throw new Error('Scorpion reinforcements are unavailable')
        return resolveReinforcements(state, actor, action, assets, board.reinforcements(state))
    }
  })
}

export function scorpionFirstTurn(): ScorpionTurn {
  const weather = scorpionWeather(1, false, () => { throw new Error('Scorpion opening weather is fixed') })
  return openScorpionTurn(1, weather, 0, 'soviet', 0, 'soviet')
}

function startMatch(opening: ScorpionSetup): ScorpionInPlay {
  const turn = scorpionFirstTurn()
  return { kind: 'playing', turn, cursor: startScorpionPlayerTurns(turn), rng: opening.rng,
    rerollHolder: 'soviet', airBases: scorpionOpeningAirBases, units: opening.units, pieces: opening.pieces,
    moved: [], dumps: opening.dumps,
    arrival: { placed: [], mobilized: [], sovietVp: turn.vp }, arrivalsOnMap: [], window: null,
    pax: { axis: 0, soviet: 0 }, availableAlerts: opening.availableAlerts, placedAlerts: [], victory: null }
}

function resolveReinforcements(
  state: Readonly<ScorpionInPlay>, actor: Side, action: ReinforcementCommand,
  { catalog, map }: ScorpionSetupAssets, board: ReinforcementBoard,
): ScorpionInPlay {
  let rng = state.rng
  const result = applyScorpionReinforcement(state, actor, action, board, () => {
    const draw = rollDie(rng)
    rng = draw.rng
    return draw.value
  }, (size) => {
    const draw = pickIndex(rng, size)
    rng = draw.rng
    return draw.value
  })
  let units = state.units
  const arrival = result.arrivalsOnMap[state.arrivalsOnMap.length]
  const alert = result.placedAlerts[state.placedAlerts.length]
  const placed = arrival ? { id: arrival.arrival.id, definition: arrival.arrival.definition, hex: arrival.hex,
    stepsLost: arrival.arrival.stepsLost ?? 0, organicTruck: arrival.arrival.organicTruck }
    : alert && { ...alert.counter, hex: alert.hex, stepsLost: 0, organicTruck: undefined }
  if (placed) {
    const definition = catalog.definitions.get(placed.definition)
    if (!definition || definition.source.side !== actor || !map.hexes.has(placed.hex) || Object.hasOwn(units, placed.id)) {
      throw new Error(`Invalid Scorpion arrival ${placed.id}`)
    }
    const counter = deployScorpionGroundCounter(definition, placed.hex, placed.stepsLost, placed.organicTruck)
    units = { ...units, [placed.id]: counter }
  }
  return { ...state, ...result, rng, units }
}
