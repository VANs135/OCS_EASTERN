import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'
import { campaignRvgkOptions, forceExitCampaignRvgk } from '../src/match/campaign-rvgk.ts'

// TTW §3.5 RVGK 盒绑定：入盒（≤20 格战略可达）、释放（≤5 格）、强制出盒（≤5 触发/放≤3）、UI 投影。
// 线性地图 h0..h30，相邻互通；标记在 h0。
const map = { resolveHex: (h) => h, neighbors: (h) => {
  const n = Number(h)
  return [n - 1, n + 1].filter((x) => x >= 0 && x <= 30).map(String)
} }
const onMap = (id, hex) => ({ definition: id, kind: 'land', side: 'soviet', location: { kind: 'map', hex } })
const inBox = (id, box = 'rvgk-1', stepsLost = 0) => ({ definition: id, kind: 'land', side: 'soviet', location: { kind: 'box', box }, stepsLost })
function start({ counters = {}, phase = 'reinforcement', segment } = {}) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 10, counters, supplyDumps: {} }, 5)
  const record = { ...opened, state: { ...opened.state, cursor: { phase, phasing: 'soviet', first: 'axis' },
    movementSegment: segment, rvgkMarkers: { 'rvgk-1': '0', 'rvgk-2': '0' } } }
  const releaseFacts = { fullStrength: true, minimumsMaintained: true, enteredThisTurn: false, independent: false, withTankArmyHq: false, independentRe: 0, truckOrTrackMa: false }
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] },
    groundMovement: { map }, rvgkStratReachable: () => true, rvgkReleaseFacts: () => releaseFacts }
  return { record, context }
}
const submit = (record, context, action, side = 'soviet') =>
  submitCampaignMatch(record, side, { id: `rvgk:${record.revision}`, expectedRevision: record.revision, action }, context).record

test('on-map units within 20 hexes enter the box in the reinforcement phase (§3.5c)', () => {
  const { record, context } = start({ counters: { u1: onMap('u1', '10'), far: onMap('far', '25') } })
  const entered = submit(record, context, { type: 'enter-campaign-rvgk', counterId: 'u1', box: 'rvgk-1' })
  assert.deepEqual(entered.state.counters.u1.location, { kind: 'box', box: 'rvgk-1' })
  assert.throws(() => submit(record, context, { type: 'enter-campaign-rvgk', counterId: 'far', box: 'rvgk-1' }), /within 20 hexes/)
  const wrongPhase = start({ counters: { u1: onMap('u1', '10') }, phase: 'movement', segment: 'movement' })
  assert.throws(() => submit(wrongPhase.record, wrongPhase.context, { type: 'enter-campaign-rvgk', counterId: 'u1', box: 'rvgk-1' }), /reinforcement phase/)
})

test('release places units within 5 hexes at the movement phase start, gated by facts (§3.5d B)', () => {
  const { record, context } = start({ counters: { u1: inBox('u1') }, phase: 'movement', segment: 'movement' })
  const released = submit(record, context, { type: 'release-campaign-rvgk', counterId: 'u1', box: 'rvgk-1', hex: '3' })
  assert.deepEqual(released.state.counters.u1.location, { kind: 'map', hex: '3' })
  assert.throws(() => submit(record, context, { type: 'release-campaign-rvgk', counterId: 'u1', box: 'rvgk-1', hex: '8' }), /within 5 hexes/)
  const notFull = { ...context, rvgkReleaseFacts: () => ({ fullStrength: false, minimumsMaintained: true, enteredThisTurn: false, independent: false, withTankArmyHq: false, independentRe: 0, truckOrTrackMa: false }) }
  assert.throws(() => submit(record, notFull, { type: 'release-campaign-rvgk', counterId: 'u1', box: 'rvgk-1', hex: '3' }), /minimums, strength or independent/)
})

test('released Truck/Track MA units are fueled for free this phase; Leg units are not (§3.5d B)', () => {
  const { record, context } = start({ counters: { tank: inBox('tank'), foot: inBox('foot') }, phase: 'movement', segment: 'movement' })
  const truckFacts = { ...context, rvgkReleaseFacts: (_s, id) => ({ fullStrength: true, minimumsMaintained: true, enteredThisTurn: false,
    independent: false, withTankArmyHq: false, independentRe: 0, truckOrTrackMa: id === 'tank' }) }
  const released = submit(record, truckFacts, { type: 'release-campaign-rvgk', counterId: 'tank', box: 'rvgk-1', hex: '3' })
  assert.equal(released.state.counters.tank.fueled, true)
  const foot = submit(released, truckFacts, { type: 'release-campaign-rvgk', counterId: 'foot', box: 'rvgk-1', hex: '4' })
  assert.notEqual(foot.state.counters.foot.fueled, true)
})

test('forced exit triggers within 5 hexes and places within 3; UI projection lists box sections (§3.5d A)', () => {
  const { record } = start({ counters: { u1: inBox('u1'), u2: inBox('u2', 'rvgk-1', 1) } })
  // 轴心战斗单位在 h4（距标记 4≤5）触发强制出盒。
  const forced = forceExitCampaignRvgk(record.state, map, 'rvgk-1', '4', { u1: '2', u2: '3' })
  assert.deepEqual(forced.counters.u1.location, { kind: 'map', hex: '2' })
  assert.deepEqual(forced.counters.u2.location, { kind: 'map', hex: '3' })
  // 轴心在 h8（距标记 8>5）不触发。
  assert.equal(forceExitCampaignRvgk(record.state, map, 'rvgk-1', '8', {}), record.state)
  // 放置格超出 3 格拒绝。
  assert.throws(() => forceExitCampaignRvgk(record.state, map, 'rvgk-1', '4', { u1: '10', u2: '3' }), /within 3 hexes/)
  const options = campaignRvgkOptions(record.state, 'soviet')
  const box1 = options.find((o) => o.box === 'rvgk-1')
  assert.deepEqual(box1.ready, ['u1'])
  assert.deepEqual(box1.rebuilding, ['u2'])
  assert.equal(box1.markerHex, '0')
  assert.equal(campaignRvgkOptions(record.state, 'axis'), null)
})