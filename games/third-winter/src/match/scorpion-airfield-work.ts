import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionHexId } from '../import/hex-id.ts'
import { activeAirfieldExcess } from './scorpion-air-bases.ts'
import { scorpionCanEngineerAt, scorpionStationaryCombatWorker } from './scorpion-engineering.ts'
import type { ScorpionInPlay } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { scorpionSpPayment, totalTokens } from './scorpion-sp-payment.ts'
import type { SupplyPayment } from './scorpion-sp-payment.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'

export interface ScorpionAirfield {
  hex: string
  side: Side
  /** Ordinary air bases are levels 1–3. OCS 15.2 strips have zero Flak and an identified counter. */
  level: number
  strip?: string
}

export type ScorpionAirfieldWork = { type: 'work-airfield'; operation: 'build' | 'reduce' | 'build-strip';
  hex: string; unitIds: readonly string[]; payments?: readonly SupplyPayment[] }

export function scorpionAirstripPool(state: Pick<ScorpionInPlay, 'airBases'>, catalog: ScorpionSetupAssets['catalog']) {
  const inUse = new Set(state.airBases.map(({ strip }) => strip))
  return [...catalog.definitions.values()].filter(({ key, kind, source }) =>
    kind === 'marker' && /^Air Strip \d+$/.test(source.name) && !inUse.has(key))
}

/** OCS 13.8d and 15.2–4, TTW 2.2h. Construction applies immediately. */
export function workScorpionAirfield(state: Readonly<ScorpionInPlay>, side: Side, action: ScorpionAirfieldWork,
  { map, catalog }: ScorpionSetupAssets, rail?: SupplyRailBoard): ScorpionInPlay {
  if (state.cursor.phase !== 'movement' || state.cursor.phasing !== side) {
    throw new Error('Airfield work is available in your Movement Phase')
  }
  const { operation, unitIds, payments = [] } = action
  const hex = scorpionHexId(action.hex)
  const current = state.airBases.find((base) => base.hex === hex)
  if (!map.hexes.has(hex) || (current && current.side !== side) ||
    Object.values(state.units).some((unit) => unit.side !== side && unit.hex === hex)) {
    throw new Error('Choose a legal friendly hex for airfield work')
  }
  if (!unitIds.length || new Set(unitIds).size !== unitIds.length) throw new Error('Choose distinct airfield workers')
  const workers = unitIds.map((id) => scorpionStationaryCombatWorker(state, side, id))
  const engineer = unitIds.length === 1 && scorpionCanEngineerAt(state, side, unitIds[0]!, hex, map)
  const turn = state.cursor.turn
  let level: number
  let cost: number
  let strip: string | undefined
  switch (operation) {
    case 'build': {
      if (!engineer) throw new Error('Building an air base requires one eligible engineer')
      if ((current?.level ?? 0) >= 3 || state.airfieldBuiltAt?.[hex] === turn) {
        throw new Error('An air base can gain one level per turn up to level three')
      }
      level = (current?.level ?? 0) + 1
      cost = current?.strip ? 3 : 4
      break
    }
    case 'reduce': {
      if (!current || current.level <= 1 || state.airfieldReducedAt?.[hex] === turn) {
        throw new Error('A friendly air base can be reduced once per phase and never below level one')
      }
      const local = workers.every((unit) => unit && unit.hex === hex && !unit.disorganized) &&
        workers.reduce((re, unit) => re + unit!.printedRe - unit!.stepsLost, 0) >= 1
      if (!engineer && !local) throw new Error('Reduction requires an engineer or a stationary local combat RE')
      level = current.level - 1
      cost = 0
      break
    }
    case 'build-strip': {
      if (side !== 'axis' || !engineer || current) throw new Error('An Axis engineer may build a strip in a hex without an airfield')
      strip = scorpionAirstripPool(state, catalog)[0]?.key
      if (!strip) throw new Error('No air strip counter remains in the pool')
      level = 0
      cost = 1
      break
    }
    default: throw new Error('Unknown airfield operation')
  }
  if (totalTokens(payments) !== cost) throw new Error(`Airfield work requires exactly ${cost}T`)
  const ledger = cost ? scorpionSpPayment(state, side, map, rail) : undefined
  ledger?.spend(payments, ({ dumpId }) => ledger.canUse(workers[0]!, dumpId))
  const airfield = { hex, side, level, ...(strip ? { strip } : {}) }
  const airBases = [...state.airBases.filter((base) => base !== current), airfield]
  const updated = { ...state, ...ledger?.settle(), airBases, moved: [...state.moved, ...unitIds],
    ...(operation === 'build' ? { airfieldBuiltAt: { ...state.airfieldBuiltAt, [hex]: turn } } : {}),
    ...(operation === 'reduce' ? { airfieldReducedAt: { ...state.airfieldReducedAt, [hex]: turn } } : {}) }
  return { ...updated, airfieldCapacityChoice: activeAirfieldExcess(updated, side, { kind: 'hex', hex }) }
}
