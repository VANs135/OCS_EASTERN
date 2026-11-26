import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignHasBulkFuel, campaignUnitFuelReady } from '../src/match/campaign-fuel.ts'

// 通规 §12.5c-B/12.5e：投递基点固定后，其投递距离内所有独立单位一并获得燃料（须在独立单位移动前确定）。
const map = { resolveHex: (h) => h, neighbors: (h) => [`${Number(h) - 1}`, `${Number(h) + 1}`] }
const land = (id, hex, side = 'soviet') => ({ definition: id, kind: 'land', side, location: { kind: 'map', hex } })
function start(moved = []) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 10, counters: {
    hq: { definition: 'hq', kind: 'hq', side: 'soviet', location: { kind: 'map', hex: '10' } },
    ind: land('ind', '13'), ind2: land('ind2', '13'), mid: land('mid', '12'), out: land('out', '17'),
    line: land('line', '13'), enemy: land('enemy', '11', 'axis') },
  supplyDumps: { soviet: { 10: 8 }, axis: {} } }, 6)
  const state = { ...opened.state, cursor: { phase: 'movement', phasing: 'soviet', first: 'axis' },
    movementSegment: 'movement', groundMovement: { moved } }
  return { record: { ...opened, state }, context: {
    reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] },
    groundMovement: { map, endBlockers: () => [] },
    hqThrowRange: (_s, id) => id === 'hq' ? 3 : undefined,
    hqFuelIndependent: (_s, id) => id === 'ind' || id === 'ind2' || id === 'mid' || id === 'out' } }
}
let seq = 0
const submit = (record, context, action) => submitCampaignMatch(record, 'soviet',
  { id: `hqfuel-${seq++}`, expectedRevision: record.revision, action }, context).record

test('HQ fuel covers every independent unit inside the throw area, not just one hex (§12.5c-B/12.5e)', () => {
  const { record, context } = start()
  const fueled = submit(record, context, { type: 'fuel-campaign-headquarters', headquartersId: 'hq',
    deliveryHex: '13', payments: [{ key: 'dump:10', tokens: 4 }] })
  // units at the delivery hex and one hex away are both inside the three-hex throw area
  assert.deepEqual(fueled.state.headquartersFuel[0].recipients, ['ind', 'ind2', 'mid'])
  assert.equal(campaignHasBulkFuel(fueled.state, 'ind'), true)
  assert.equal(campaignUnitFuelReady(fueled.state, 'mid'), true)
  // outside the throw area, non-independent, and enemy counters stay uncovered
  assert.equal(campaignHasBulkFuel(fueled.state, 'out'), false)
  assert.equal(campaignHasBulkFuel(fueled.state, 'line'), false)
  assert.equal(campaignHasBulkFuel(fueled.state, 'enemy'), false)
  // the HQ itself is covered as before
  assert.equal(campaignHasBulkFuel(fueled.state, 'hq'), true)
  assert.equal(fueled.state.supplyDumps.soviet['10'], 4)
})

test('the delivery base must be inside the throw range and fixed before the independent units move (§12.5e)', () => {
  const { record, context } = start()
  assert.throws(() => submit(record, context, { type: 'fuel-campaign-headquarters', headquartersId: 'hq',
    deliveryHex: '20', payments: [{ key: 'dump:10', tokens: 4 }] }), /throw range/)
  // without an injected throw range the delivery cannot be resolved
  const { record: bare, context: bareContext } = start()
  assert.throws(() => submit(bare, { ...bareContext, hqThrowRange: undefined },
    { type: 'fuel-campaign-headquarters', headquartersId: 'hq', deliveryHex: '13',
      payments: [{ key: 'dump:10', tokens: 4 }] }), /throw range is unavailable/)
  // an independent unit that already moved this phase cannot be covered retroactively
  const moved = start(['mid'])
  assert.throws(() => submit(moved.record, moved.context, { type: 'fuel-campaign-headquarters', headquartersId: 'hq',
    deliveryHex: '13', payments: [{ key: 'dump:10', tokens: 4 }] }), /先确定投递位置/)
})
