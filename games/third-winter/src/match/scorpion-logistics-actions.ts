import type { Side } from '@ocs-eastern/series/state-types'
import { assignScorpionAttrition, checkScorpionAttrition } from './scorpion-attrition.ts'
import type { AssignAttrition } from './scorpion-attrition.ts'
import { workScorpionAirfield } from './scorpion-airfield-work.ts'
import type { ScorpionAirfieldWork } from './scorpion-airfield-work.ts'
import { scorpionRegularBarrageTargets } from './scorpion-barrage-timing.ts'
import { changeScorpionExtender } from './scorpion-extender.ts'
import type { ScorpionExtenderCommand } from './scorpion-extender.ts'
import { buyScorpionFuel } from './scorpion-fuel.ts'
import type { ScorpionFuelAction } from './scorpion-fuel.ts'
import { workScorpionHedgehog } from './scorpion-hedgehogs.ts'
import type { HedgehogWork } from './scorpion-hedgehogs.ts'
import { advanceScorpionPhase } from './scorpion-player-turn.ts'
import { assertScorpionMovementEnd } from './scorpion-reserves.ts'
import type { ScorpionInPlay, ScorpionSession } from './scorpion-session.ts'
import type { ScorpionSetupAssets } from './scorpion-setup.ts'
import { assertScorpionPhaseStacking } from './scorpion-stacking.ts'
import { recoverScorpionStocks, settleScorpionStockRecovery } from './scorpion-stock-recovery.ts'
import type { RecoverInternalStocks } from './scorpion-stock-recovery.ts'
import { feedScorpionUnits, openScorpionSupply, scorpionSupplyDecision, selectTraceAnchor } from './scorpion-supply-phase.ts'
import type { FeedUnits } from './scorpion-supply-phase.ts'
import type { SupplyRailBoard } from './scorpion-supply-position.ts'
import { advanceScorpionThaw } from './scorpion-thaw.ts'
import { handleScorpionTransport } from './scorpion-transport-load.ts'
import type { ScorpionTransportLoad } from './scorpion-transport-load.ts'
import { repackScorpionTransport } from './scorpion-transport-points.ts'
import type { RepackTransport } from './scorpion-transport-points.ts'

type SupplyAction = { type: 'choose-formation-trace'; formation: string; anchor: string }
  | FeedUnits | RecoverInternalStocks | { type: 'check-attrition' } | AssignAttrition | { type: 'complete-supply' }

export type ScorpionLogisticsAction = { type: 'complete-movement' } | SupplyAction | ScorpionFuelAction
  | ScorpionTransportLoad | RepackTransport | ScorpionExtenderCommand | HedgehogWork | ScorpionAirfieldWork

interface LogisticsContext {
  assets: ScorpionSetupAssets
  supplyRail?: SupplyRailBoard
  hedgehogAt?: (hex: string) => number
  stackingExempt?: ReadonlySet<string>
}

/** The session owns pending decisions and receipts. This module settles logistics commands. */
export function applyScorpionLogisticsAction(state: Readonly<ScorpionSession>, actor: Side,
  action: ScorpionLogisticsAction, context: LogisticsContext): ScorpionInPlay {
  const { assets, supplyRail, hedgehogAt, stackingExempt } = context
  switch (action.type) {
    case 'work-hedgehog':
    case 'work-airfield': {
      if (state.kind !== 'playing' || state.combat || state.turn.step.kind !== 'player-turn') throw new Error('Construction is unavailable')
      if (scorpionRegularBarrageTargets(state).size) throw new Error('The Movement Segment has ended')
      const ready = { ...state, overrunMarch: null, groundCaptureMove: null }
      return action.type === 'work-airfield' ? workScorpionAirfield(ready, actor, action, assets, supplyRail) :
        workScorpionHedgehog(ready, actor, action, assets, supplyRail, hedgehogAt)
    }
    case 'complete-movement':
      if (state.kind !== 'playing' || state.combat || state.turn.step.kind !== 'player-turn') throw new Error('Scorpion supply is unavailable')
      assertScorpionMovementEnd(state, actor, hedgehogAt, stackingExempt)
      if (state.cursor.simulcast && state.cursor.phase === 'movement' && state.cursor.phasing === actor) {
        return advanceScorpionThaw(state, actor, assets.map, supplyRail)
      }
      return openScorpionSupply({ ...state, overrunMarch: null, groundCaptureMove: null }, actor, assets.map, supplyRail)
    case 'fuel-formation':
    case 'fuel-headquarters':
    case 'fuel-from-paused-transport':
      if (state.kind !== 'playing') throw new Error('Start the Scorpion match first')
      return buyScorpionFuel(state, actor, action, assets.map, supplyRail)
    case 'load-transport':
    case 'unload-transport':
      if (state.kind !== 'playing') throw new Error('Start the Scorpion match first')
      return handleScorpionTransport(state, actor, action, assets)
    case 'repack-transport':
      if (state.kind !== 'playing') throw new Error('Start the Scorpion match first')
      return repackScorpionTransport(state, actor, action, assets)
    case 'form-extender':
    case 'dismantle-extender':
    case 'collapse-extender':
      if (state.kind !== 'playing') throw new Error('Start the Scorpion match first')
      return changeScorpionExtender(state, actor, action, assets, supplyRail)
    default:
      return applySupplyAction(state, actor, action, context)
  }
}

function applySupplyAction(state: Readonly<ScorpionSession>, actor: Side, action: SupplyAction,
  { assets, supplyRail, stackingExempt }: LogisticsContext): ScorpionInPlay {
  if (state.kind !== 'playing' || state.victory || state.cursor.phase !== 'supply' ||
    actor !== state.cursor.phasing || !state.supply) throw new Error('Scorpion supply is unavailable')

  const window = state.supply
  switch (action.type) {
    case 'choose-formation-trace':
      if (scorpionSupplyDecision(state, actor, assets.map, supplyRail)?.segment === 'stock-recovery') {
        throw new Error('Recover affordable internal stocks before confirming formation trace')
      }
      return selectTraceAnchor(state, window, action.formation, action.anchor)
    case 'recover-internal-stocks':
      return recoverScorpionStocks(state, action, assets.map, supplyRail)
    case 'feed-units':
    case 'check-attrition': {
      const recovered = settleScorpionStockRecovery(state, assets.map, supplyRail)
      return action.type === 'feed-units' ? feedScorpionUnits(recovered, window, action, assets.map, supplyRail)
        : checkScorpionAttrition(recovered, window)
    }
    case 'assign-attrition':
      return assignScorpionAttrition(state, window, action, assets)
    case 'complete-supply': {
      if (scorpionSupplyDecision(state, actor, assets.map, supplyRail)?.step !== 'complete-supply') {
        throw new Error('Resolve attrition before leaving supply')
      }
      assertScorpionPhaseStacking(state, actor, stackingExempt)
      if (state.cursor.simulcast) return advanceScorpionThaw(state, actor, assets.map, supplyRail)
      const cursor = advanceScorpionPhase(state.cursor, actor)
      if (!cursor || cursor.phase !== 'reaction') throw new Error('Invalid supply phase completion')
      return { ...state, cursor, supply: null }
    }
  }
}
