import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignSetup } from '../src/import/campaign-setup.ts'
import { campaignMapInPlayArea } from '../src/ttw/campaign/play-area.ts'

const map = indexTtwCampaignMap({ items: [
  { hex_id: 'A2.00', seam_twin: 'C2.34', seam_primary: true },
  { hex_id: 'C2.34', seam_twin: 'A2.00', seam_primary: false },
  { hex_id: 'D1.1' },
] }, { items: [] })
const aliases = new Map([
  ['Example Division', [{ key: 'land:id:12', kind: 'land', source: { side: 'axis', re: 3 } }]],
  ['Step Loss 3', [{ key: 'marker:id:3', kind: 'marker', source: { side: null } }]],
])
const row = (fields = {}) => ({
  ref: 'Example Division', side: 'axis', at: { map: 'C', col: 2, row: 34 }, face: null, ...fields,
})

test('setup prepares canonical placements with distinct row identities and keeps marker-only rows pending', () => {
  const result = prepareCampaignSetup({
    units: [
      row({ src: 'Inf Div (EX; -2 steps)' }),
      row({ ref: 'Step Loss 3', src: 'Mtn Div (NW; -1 step)' }),
      row(),
    ],
    random_draws: [{ side: 'axis', pool: 'example', hex: 'C2.34' }],
  }, aliases, map, campaignMapInPlayArea(map, { kind: 'all-map' }))

  assert.deepEqual(result.counters.map(({ id, hex, stepsLost }) => [id, hex, stepsLost]), [
    ['campaign-setup:1', 'A2.0', 2],
    ['campaign-setup:3', 'A2.0', undefined],
  ])
  assert.deepEqual(result.pendingMarkerRows, [
    { row: 2, ref: 'Step Loss 3', side: 'axis', printedHex: 'C2.34', lossHint: 1 },
  ])
  assert.deepEqual(result.drawOrders, [{ row: 1, pool: 'example', hex: 'A2.0', side: 'axis' }])
})

test('setup reports loss ambiguity, out-of-scope locations and wrong-side references separately', () => {
  const area = campaignMapInPlayArea(map, { kind: 'hex-list', hexes: ['A2.00'] })
  const result = prepareCampaignSetup({ units: [
    row({ src: 'Inf Div (EX; -1 step) Inf Div (NW; -2 steps)' }),
    row({ src: 'Inf Div (EX; -3 steps)' }),
    row({ at: { map: 'D', col: 1, row: 1 } }),
    row({ side: 'soviet' }),
  ] }, aliases, map, area)
  assert.deepEqual(result.counters, [])
  assert.deepEqual(result.unresolvedLosses.map(({ issue }) => issue), ['ambiguous-loss-source', 'invalid-loss-capacity'])
  assert.deepEqual(result.outsideSetupArea.map(({ row }) => row), [3])
  assert.deepEqual(result.unresolvedSetup.map(({ issue }) => issue), ['wrong-side'])
})
