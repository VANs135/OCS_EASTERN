import type { Side } from '@ocs-eastern/series/state-types'
import { deployScorpionGroundCounter } from '../import/scorpion-deployment.ts'
import type { DeployedCounter } from '../import/scorpion-deployment.ts'
import { scorpionHexDistance, scorpionHexId } from '../import/hex-id.ts'
import { scorpionModeFace } from '../import/scorpion-mode-face.ts'
import type { GroundFace } from '../import/scorpion-mode-face.ts'
import { scorpionSupplySources } from '../ttw/scorpion/initial-map.ts'
import { scorpionSupplyNetwork } from '../ttw/scorpion/supply-trace.ts'
import { scorpionStepCost } from '../ttw/scorpion/terrain-cost.ts'
import { scorpionGroundActivity } from './scorpion-ground-activity.ts'
import { recordScorpionGroundControl } from './scorpion-hex-control.ts'
import { scorpionPhaseOccupancy } from './scorpion-phase-occupancy.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { scorpionEnemyZoc, scorpionSupplyPosition } from './scorpion-supply-position.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

export interface ScorpionRemnantPlacement { divisionId: string; hex: string }
export type RebuildScorpionRemnant = { type: 'rebuild-remnant'; remnantId: string; face?: GroundFace }

// Scenario booklet p.55 supplies two interchangeable battalions. Use the first two printed counters.
const scorpionRemnantDefinitions = ['land:id:3999', 'land:id:4499'] as const

export class ScorpionRemnantChoice extends Error {
  readonly division: string
  readonly candidates: readonly string[]

  constructor(division: string, candidates: readonly string[]) {
    super(`Choose a remnant hex for ${division}: ${candidates.join(', ')}`)
    this.division = division
    this.candidates = candidates
  }
}

function isParentDivision(catalog: ScorpionSetupAssets['catalog'], unit: DeployedCounter) {
  const definition = catalog.definitions.get(unit.definition)
  const stats = definition?.source.faces.combat?.stats
  return definition?.source.name.startsWith('Ge ') && definition.source.side === 'axis' && definition.source.category === 'infantry' &&
    definition.source.re === 4 && stats?.attack === 16 && stats.artRange === 4 && stats.move === 3
}

/** TTW 2.4d. Exactly two hexes away and west of the division, following a legal leg path. */
export function scorpionRemnantDestinations(state: Readonly<ScorpionInPlay>, from: string,
  { map }: ScorpionSetupAssets): readonly string[] {
  const occupied = new Set(scorpionPhaseOccupancy(state).occupied.soviet)
  const friendlyCombat = new Set<string>()
  const friendlyRe = new Map<string, number>()
  for (const unit of Object.values(state.units)) if (unit.side === 'axis') {
    friendlyRe.set(unit.hex, (friendlyRe.get(unit.hex) ?? 0) + unit.printedRe - unit.stepsLost)
    if (unit.combat) friendlyCombat.add(unit.hex)
  }
  const zoc = scorpionEnemyZoc(state, map, 'axis')
  const weather = state.turn.weather.ground === 'freeze' ? 'freeze' : 'dry'
  const column = (hex: string) => Number(hex.slice(1).split('.')[0])
  const open = (a: string, b: string) => !occupied.has(b) && !scorpionSupplySources.soviet.some((hex) => hex === b) &&
    (!zoc.has(b) || friendlyCombat.has(b)) && scorpionStepCost(map, a, b, 'leg', weather) !== null
  const destinations = map.neighbors(from).filter((near) => open(from, near)).flatMap((near) =>
    map.neighbors(near).filter((hex) => column(hex) < column(from) && scorpionHexDistance(from, hex) === 2 &&
      (friendlyRe.get(hex) ?? 0) + 1 <= 10 && open(near, hex)))
  return [...new Set(destinations)].sort()
}

export function placeScorpionRemnant(state: ScorpionInPlay, divisionId: string, division: DeployedCounter,
  requested: string | undefined, assets: ScorpionSetupAssets): ScorpionInPlay {
  const active = new Set(Object.values(state.units).map((unit) => unit.definition))
  const key = isParentDivision(assets.catalog, division) ? scorpionRemnantDefinitions.find((definition) => !active.has(definition)) : undefined
  const choices = key ? scorpionRemnantDestinations(state, division.hex, assets) : []
  if (!key || !choices.length) {
    if (requested !== undefined) throw new Error(`Division ${divisionId} cannot place a remnant`)
    return state
  }
  const hex = requested === undefined ? choices.length === 1 ? choices[0]! : '' : scorpionHexId(requested)
  if (!choices.includes(hex)) throw new ScorpionRemnantChoice(divisionId, choices)
  const definition = assets.catalog.definitions.get(key)
  if (!definition) throw new Error(`Missing Scorpion remnant counter ${key}`)
  const id = `remnant:${definition.key}`
  const deployed = deployScorpionGroundCounter(definition, hex, 0)
  const counter = division.moveMode ? scorpionModeFace(deployed, definition, 'move') : deployed
  const { disorganized, reserve, exploit, exploitRating, released, outOfSupply, internalStocks } = division
  const units = { ...state.units, [id]: { ...counter, remnantOf: divisionId, disorganized, reserve, exploit, exploitRating,
    released, outOfSupply, internalStocks } }
  const activity = scorpionGroundActivity(state)
  const inheritId = (ids: readonly string[]) => [...ids.filter((entry) => entry !== id), ...(ids.includes(divisionId) ? [id] : [])]
  return recordScorpionGroundControl({ ...state, units, moved: inheritId(state.moved), groundActivity: { ...activity,
    airlifted: inheritId(activity.airlifted), spent: { ...activity.spent, [id]: activity.spent[divisionId] ?? 0 } } }, 'axis', hex, assets.map)
}

/** TTW 2.4d and 1.7a. Exchange the battalion and one Pax for the parent at one step. */
export function rebuildScorpionRemnant(state: Readonly<ScorpionInPlay>, side: Side, action: RebuildScorpionRemnant,
  { map, catalog }: ScorpionSetupAssets, rail?: SupplyRailBoard): ScorpionInPlay {
  if (side !== 'axis' || state.cursor.phasing !== side || state.cursor.phase !== 'reinforcement' ||
    !state.window || state.pax.axis < 1) throw new Error('Remnant rebuilding requires an Axis reinforcement Pax')
  const remnant = state.units[action.remnantId]
  const parent = state.pieces.find((piece) => piece.id === remnant?.remnantOf && piece.side === side && piece.location.kind === 'dead-pile')
  const hqPresent = Object.values(state.units).some((unit) => unit.side === side && unit.hex === remnant?.hex &&
    unit.headquarters && !unit.headquarters.kessel && !unit.moveMode && !unit.reserve &&
    catalog.definitions.get(unit.definition)?.source.name.startsWith('Ge HQ '))
  if (!remnant || !parent || !hqPresent || scorpionEnemyZoc(state, map, side).has(remnant.hex) ||
    !scorpionSupplyNetwork(map, scorpionSupplyPosition(state, map, side, rail)).trace(remnant.hex).length) {
    throw new Error('Choose a remnant stacked with an eligible supplied Axis Corps or Army HQ outside enemy ZOC')
  }
  const definition = catalog.definitions.get(parent.definition)
  if (!definition?.source.re || (action.face !== undefined && action.face !== 'move' && action.face !== 'combat')) {
    throw new Error('Invalid rebuilt division or mode')
  }
  const deployed = deployScorpionGroundCounter(definition, remnant.hex, definition.source.re - 1)
  const units = { ...state.units, [parent.id]: scorpionModeFace(deployed, definition, action.face ?? 'combat') }
  delete units[action.remnantId]
  return { ...state, units, pieces: state.pieces.filter(({ id }) => id !== parent.id), pax: { ...state.pax, axis: state.pax.axis - 1 } }
}
