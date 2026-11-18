import { transportHandlingCost } from '@ocs-eastern/series/ground-logistics'
import type { Side } from '@ocs-eastern/series/state-types'
import { actingSide } from '@ocs-eastern/series/turn'
import { scorpionRegularBarrageTargets } from './scorpion-barrage-timing.ts'
import { creditScorpionUnloadedSupply, scorpionUnloadedTokens } from './scorpion-dumps.ts'
import { scorpionGroundActivity } from './scorpion-ground-activity.ts'
import { canMoveInPhase, scorpionMovementAllowance } from './scorpion-movement.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { carriedScorpionTokens, usableDump } from './scorpion-sp-payment.ts'

export type ScorpionTransportLoad = { type: 'load-transport' | 'unload-transport'; unitId: string; tokens: number }

/** OCS 12.2 and 13.2a/f/g. Cargo and handling MP are settled together. */
export function handleScorpionTransport(state: Readonly<ScorpionInPlay>, side: Side, action: ScorpionTransportLoad,
  { catalog }: ScorpionSetupAssets): ScorpionInPlay {
  const { unitId, tokens } = action
  const { phase, phasing } = state.cursor
  const unit = Object.hasOwn(state.units, unitId) ? state.units[unitId] : undefined
  const activity = scorpionGroundActivity(state)
  const current = activity.transport?.unitId === unitId ? activity.transport : undefined
  const definition = unit && catalog.definitions.get(unit.definition)
  const points = definition?.source.faces.combat?.stats.transport
  if (state.turn.step.kind !== 'player-turn' || state.combat || side !== actingSide(phasing, phase) ||
    state.turn.weather.ground === 'thaw' || scorpionRegularBarrageTargets(state).size ||
    (phase === 'exploitation' && state.combatTargets.length) || !unit || unit.combat || unit.side !== side ||
    !canMoveInPhase(unit, phase) || (state.moved.includes(unitId) && !current) ||
    typeof points !== 'number' || !Number.isSafeInteger(points) || points < 1) {
    throw new Error('Choose a friendly transport in its active Movement Segment before it finishes moving')
  }
  const cost = transportHandlingCost(unit.allowance)
  const spent = (activity.spent[unitId] ?? 0) + cost
  if (spent > scorpionMovementAllowance(unit, phase)) throw new Error('Insufficient MP for transport handling')
  if (!Number.isSafeInteger(tokens) || tokens < 1) throw new Error('Choose whole cargo tokens')
  const carried = carriedScorpionTokens(unit)
  const key = `${side}:hex:${unit.hex}`
  let dumps = state.dumps
  if (action.type === 'load-transport') {
    const { dump } = usableDump(state, side, key)
    const available = dump.tokens - scorpionUnloadedTokens(state, key, dump)
    if (tokens > available || carried + tokens > points * 4) throw new Error('Insufficient loadable supply or transport capacity')
    // Loading spends only eligible stock. Keep the unloading stamp on the rest of the dump.
    dumps = { ...dumps, [key]: { ...dump, tokens: dump.tokens - tokens } }
  } else {
    if (unit.organicTruck) throw new Error('Organic trucks cannot unload supply onto the map')
    if (tokens > carried) throw new Error('The transport does not carry that many tokens')
    if (!(state.dumps[key]?.tokens || state.airBases?.some((base) => base.side === side && base.hex === unit.hex) ||
      Object.values(state.units).some((counter) => counter.combat && counter.side === side && counter.hex === unit.hex))) {
      throw new Error('Unload where a friendly combat unit, air base, or supply dump is present')
    }
    dumps = creditScorpionUnloadedSupply(state, side, { kind: 'hex', hex: unit.hex }, tokens)
  }
  const transportCargoTokens = carried + (action.type === 'load-transport' ? tokens : -tokens)
  return { ...state, dumps, units: { ...state.units, [unitId]: { ...unit, transportCargoTokens } },
    moved: [...new Set([...state.moved, unitId])], overrunMarch: null, groundCaptureMove: null,
    groundActivity: { ...activity, spent: { ...activity.spent, [unitId]: spent }, transport: current ?? { unitId, enteredHex: false } } }
}
