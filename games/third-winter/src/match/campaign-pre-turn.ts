import { rollInitiativeContest } from '@ocs-eastern/series/initiative'
import { rollDie } from '@ocs-eastern/series/rng'
import type { Side } from '@ocs-eastern/series/state-types'
import { playerPhases } from '@ocs-eastern/series/turn'
import { drawCampaignEvent } from '../ttw/campaign/random-events.ts'
import { campaignWeather } from '../ttw/campaign/weather.ts'
import type { CampaignThawTiming } from '../ttw/campaign/weather.ts'
import type { CampaignCursor, CampaignPreTurnAction, CampaignPreTurnCheck, CampaignPreTurnRoll, CampaignTurnState } from './campaign-turn-state.ts'

function preTurnDice(state: Readonly<CampaignTurnState>, segment: CampaignPreTurnRoll['segment']) {
  let rng = state.rng
  const rolls: CampaignPreTurnRoll[] = []
  function roll(check: CampaignPreTurnCheck) {
    const before = rng.drawCount
    const draw = rollDie(rng)
    rng = draw.rng
    const previous = rolls.at(-1)
    if (previous?.check === check) {
      previous.dice.faces.push(draw.value)
      previous.dice.count++
      previous.dice.total += draw.value
      previous.after = rng.drawCount
    } else {
      rolls.push({ turn: state.turn, phase: 'pre-turn', segment, check, before, after: rng.drawCount,
        dice: { faces: [draw.value], count: 1, total: draw.value } })
    }
    return draw.value
  }
  return { roll, result: () => ({ rng, preTurnRolls: [...state.preTurnRolls, ...rolls] }) }
}

function firstPlayer(first: Side): CampaignCursor {
  return { first, phasing: first, phase: playerPhases[0] }
}

export function applyCampaignPreTurn(state: Readonly<CampaignTurnState>, actor: Side,
  action: CampaignPreTurnAction, thawTiming?: CampaignThawTiming): CampaignTurnState {
  const { cursor } = state
  if (cursor.phase !== 'pre-turn') throw new Error('Campaign pre-turn has ended')
  switch (action.type) {
    case 'determine-campaign-weather': {
      if (cursor.segment !== 'weather') throw new Error('Campaign weather is not due')
      const [, month, day] = state.when.date.split('-').map(Number)
      const dice = preTurnDice(state, 'weather')
      const result = campaignWeather({ month: month!, day: day! }, state.weatherHistory, dice.roll,
        state.opening?.weather, thawTiming)
      return { ...state, ...dice.result(), weather: result.weather, weatherHistory: result.state,
        ferries: result.removeFerries ? [] : state.ferries,
        cursor: result.endGame ? { phase: 'ended', reason: 'april-mud' } : { phase: 'pre-turn', segment: 'random-event' } }
    }
    case 'roll-campaign-event': {
      if (cursor.segment !== 'random-event' || cursor.event) throw new Error('The campaign event roll is not available')
      const dice = preTurnDice(state, 'random-event')
      const event = drawCampaignEvent(dice.roll)
      // Preserve a drawn event until its own effect has a rules handler. The initiative window stays closed.
      if (event) return { ...state, ...dice.result(), cursor: { ...cursor, event } }
      const next: CampaignCursor = state.weather?.ground === 'thaw' ? { phase: 'pre-turn', segment: 'simulcast' }
        : state.opening ? firstPlayer(state.opening.first) : { phase: 'pre-turn', segment: 'initiative', winner: null }
      return { ...state, ...dice.result(), cursor: next }
    }
    case 'roll-campaign-initiative': {
      if (cursor.segment !== 'initiative' || cursor.winner) throw new Error('Campaign initiative is not due')
      const dice = preTurnDice(state, 'initiative')
      const winner = rollInitiativeContest((side) => dice.roll(`${side}-initiative`))
      return { ...state, ...dice.result(), cursor: { ...cursor, winner } }
    }
    case 'choose-campaign-first':
      if (cursor.segment !== 'initiative' || cursor.winner !== actor) throw new Error('Only the initiative winner can choose the first player')
      if (action.first !== 'axis' && action.first !== 'soviet') throw new Error('Invalid first player')
      return { ...state, cursor: firstPlayer(action.first) }
  }
}
