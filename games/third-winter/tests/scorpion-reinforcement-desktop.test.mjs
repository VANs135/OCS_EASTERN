import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { localChoices } from '../desktop/local/actions.mjs'

// The desktop layer filtered scheduled arrivals by entry-hex availability too, which hid the
// blocked obligation from the player entirely. These choices are what the local client renders.
const blocked = { id: '3:soviet:blocked', side: 'soviet', turn: 3, destinations: ['s2.16'], definition: 'unit' }
const open = { id: '3:soviet:open', side: 'soviet', turn: 3, destinations: ['s22.02'], definition: 'unit' }
const later = { id: '4:soviet:later', side: 'soviet', turn: 4, destinations: ['s22.02'], definition: 'unit' }
const definitions = new Map([blocked, open, later].map(({ definition }) => [definition, { source: { name: 'Sov Gd' } }]))

function stateAt(openIds, extra = {}) {
  return {
    kind: 'play', victory: null, turn: { step: { kind: 'player-turn' }, weather: { ground: 'freeze' } },
    cursor: { turn: 3, first: 'soviet', phasing: 'soviet', phase: 'reinforcement', retention: 'closed' },
    window: { stage: 'scheduled', fixedTokens: 0, fixedDestinations: [], variableTokens: 0, pendingAlert: null, dice: null },
    arrival: { placed: [], mobilized: [], sovietVp: 0 }, arrivalsOnMap: [], units: {}, pieces: [], dumps: {},
    ...extra,
  }
}

function dataWith(openIds, catalog = [blocked, open, later]) {
  const board = { catalog, arrivalDestinations: (arrival) => openIds.includes(arrival.id) ? arrival.destinations : [] }
  return { assets: { catalog: { definitions }, map: { hexes: new Map() } }, board: { reinforcements: () => board } }
}

test('a blocked scheduled arrival is announced to the player instead of vanishing from the choices', () => {
  // Only the blocked unit is due this turn, so exactly one forfeiture notice plus the phase end.
  const choices = localChoices(stateAt([]), 'soviet', {}, dataWith([], [blocked, later]))
  const forfeit = choices.filter(({ actions }) => actions.some(({ type }) => type === 'finish-scheduled-arrivals'))
  assert.equal(forfeit.length, 2, 'one choice names the blocked unit, the other completes the phase')
  assert.match(forfeit[0].label, /无法入场：3:soviet:blocked/)
  assert.match(forfeit[0].label, /印刷入场格全部被敌方占据/)
  assert.ok(choices.every(({ actions }) => actions.every(({ type }) => type !== 'place-arrival')),
    'a blocked unit must not offer a placement it cannot legally make')
})

test('when a placement is still possible the player cannot end the phase yet', () => {
  const choices = localChoices(stateAt([open.id]), 'soviet', {}, dataWith([open.id]))
  assert.ok(choices.some(({ actions }) => actions.some(({ type, hex }) => type === 'place-arrival' && hex === 's22.02')))
  assert.ok(choices.every(({ actions }) => actions.every(({ type }) => type !== 'finish-scheduled-arrivals')))
})
