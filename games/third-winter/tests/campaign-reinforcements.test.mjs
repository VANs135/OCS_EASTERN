import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignReinforcements } from '../src/import/campaign-reinforcements.ts'
import { campaignMapInPlayArea } from '../src/ttw/campaign/play-area.ts'
import { campaignReinforcementWindow } from '../src/ttw/campaign/reinforcement.ts'

const map = indexTtwCampaignMap({ items: [{ hex_id: 'D14.3' }, { hex_id: 'A1.1' }] }, { items: [] })
const aliases = new Map([
  ['Axis Unit', [{ key: 'land:id:1', kind: 'land', source: { side: 'axis' } }]],
  ['Soviet Unit', [{ key: 'land:id:2', kind: 'land', source: { side: 'soviet' } }]],
  ['Reserve Marker', [{ key: 'marker:id:3', kind: 'marker', source: { side: null } }]],
])

const group = (channel, entries, fields = {}) => ({
  turn: 1, phase: 'reinforce', side: 'axis', date: '1943-10-01', raw_date: '1 October', channel, entries, ...fields,
})
const axisUnit = { ref: 'Axis Unit' }
const cursor = { turn: 1, phasing: 'axis', phase: 'reinforcement' }

test('reinforcement window selects only the matching turn, phase and side in printed order', () => {
  const { schedule } = prepareCampaignReinforcements([
    group('kherson d14.03', [{ ...axisUnit, note: 'example source note' }]),
    group('any front hq', [{ ref: 'Soviet Unit' }], { side: 'soviet' }),
    group('withdraw', [axisUnit]),
    group('add to dead pile', [axisUnit], { turn: 2, date: '1943-10-05' }),
  ], aliases, map)

  const axis = campaignReinforcementWindow(schedule, cursor)
  assert.deepEqual(axis.map(({ id, operation }) => [id, operation]), [
    ['campaign-reinforcement:1:1', { kind: 'arrival', channel: { kind: 'fixed-hex', hex: 'D14.3', printedHex: 'D14.03' } }],
    ['campaign-reinforcement:3:1', { kind: 'withdraw' }],
  ])
  assert.equal(axis[0].note, 'example source note')
  assert.equal(axis[0].sourceDate, '1 October')
  assert.equal(campaignReinforcementWindow(schedule, { ...cursor, phasing: 'soviet' })[0].operation.channel.kind, 'front-hq')
  assert.equal(campaignReinforcementWindow(schedule, { ...cursor, turn: 2 })[0].operation.kind, 'dead-pile')
  assert.deepEqual(campaignReinforcementWindow(schedule, { ...cursor, turn: 3 }), [])
  assert.deepEqual(campaignReinforcementWindow(schedule, { ...cursor, phase: 'reaction' }), [])
})

test('reinforcements keep unrecognized rows pending and report invalid fixed hexes separately', () => {
  const area = campaignMapInPlayArea(map, { kind: 'hex-list', hexes: ['A1.1'] })
  const input = [
    group('any army or army group hq（map a/b 上的匈牙利单位）', [axisUnit]),
    group('kherson d14.03', [axisUnit]),
    group('any airbase', [{ ref: 'Soviet Unit' }, { ref: 'missing' }]),
    group('at any detrainable hex', [{ ref: null, note: 'example supply' }]),
    group('available', [{ ref: 'Reserve Marker' }]),
    group('special arrival', [axisUnit]),
    group('withdraw', []),
  ]
  const { entries } = prepareCampaignReinforcements(input, aliases, map, area)
  assert.deepEqual(entries[0].operation.channel, { kind: 'army-or-army-group-hq', panels: 'AB', nation: 'hungarian' })
  assert.deepEqual(entries.slice(1).map(({ status, issue }) => [status, issue]), [
    ['pending', 'outside-scenario'], ['pending', 'wrong-side'], ['pending', 'missing'],
    ['pending', 'narrative'], ['pending', 'marker'], ['pending', 'unclassified-channel'], ['pending', 'empty-group'],
  ])
  assert.equal(entries[7].entry, null)
  const croppedMap = indexTtwCampaignMap({ items: [{ hex_id: 'A1.1' }] }, { items: [] })
  assert.equal(prepareCampaignReinforcements([input[1]], aliases, croppedMap).entries[0].issue, 'missing-entry-hex')
})

test('malformed dates and missing references identify the invalid source row', () => {
  assert.throws(() => prepareCampaignReinforcements([group('withdraw', [axisUnit], { date: null })], aliases, map), /group at row 1/)
  assert.throws(() => prepareCampaignReinforcements([group('withdraw', [{}])], aliases, map), /entry at 1\.1/)
})
