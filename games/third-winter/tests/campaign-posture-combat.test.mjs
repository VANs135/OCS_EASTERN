import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openCampaignMatch, submitCampaignMatch } from '../src/match/campaign-match.ts'

// 批次 10 姿态接入战斗环（§3.3d B）：免防御补给、战斗步 2 后免费守势炮击、攻击补给 2SP/回合上限。
const hexes = ['A1.1', 'A2.1', 'A3.1', 'A4.1', 'A5.1']
const map = {
  resolveHex: (hex) => hexes.includes(hex) ? hex : undefined,
  neighbors(hex) { const i = hexes.indexOf(hex); return i < 0 ? [] : [hexes[i - 1], hexes[i + 1]].filter(Boolean) },
}
const distance = (a, b) => Math.abs(hexes.indexOf(a) - hexes.indexOf(b))
const rows = ['1 or less', '2-3', '4-5', '6-7', '8-9', '10-11', '12', '13+']
const cols = ['1:2', '1:1', '2:1', '3:1']
const table = { diceRows: rows, terrainColumns: { Open: cols, Close: cols, 'Very Close': cols, 'Extr Close': cols },
  matrix: rows.map(() => cols.map(() => 'A e3 DL1')) }
const barrage = { columns: ['12-16'], costs: [1], matrix: Array.from({ length: 11 }, () => ['2']) }
const unit = (side, hex, definition, props = {}) => ({ kind: 'land', side, definition, location: { kind: 'map', hex }, currentRe: 1, mode: 'combat', ...props })
const stepsOf = (state, id) => { const c = state.counters[id]; return c?.location.kind === 'map' && c.kind === 'land' ? c.currentRe ?? 1 : undefined }
const baseBoard = {
  map, distance, table,
  profileOf: (state, id) => ({ combat: true, attackCapable: true, inCombatMode: state.counters[id].mode === 'combat',
    outOfSupply: false, moveMa: 4, moveMobility: 'leg', drawMobility: 'leg', singleTransportPoint: false }),
  combatProfile: (state, id) => ({ strength: 3, combatClass: 'leg', antiTank: 0, actionRating: 3,
    printedRe: state.counters[id].currentRe ?? 1, artilleryDivision: false, attackCapable: true }),
  losses: { stepsOf, reAfterLoss: (state, id, losses) => state.counters[id].currentRe - losses },
  terrainAt: () => ['Open'], hedgehogAt: () => 0,
  canUseSupply: (_s, _side, _id, key) => key.startsWith('dump:'),
  stepCost: (_s, _id, from, to) => distance(from, to) === 1 ? 1 : null,
  stackingReAt: (state, hex) => Object.values(state.counters).reduce((sum, c) => sum + (c.location.kind === 'map' && c.location.hex === hex ? c.currentRe ?? 1 : 0), 0),
  exploitEligible: (state, id) => state.counters[id].exploiting === true,
}
function start(counters, combatExtra, dumps = { axis: { 'A2.1': 6 }, soviet: { 'A3.1': 2 } }) {
  const opened = openCampaignMatch({ when: { scenarioId: '01', date: '1943-10-05' }, turn: 2, counters, supplyDumps: dumps }, 623)
  const record = { ...opened, state: { ...opened.state, weather: { ground: 'dry', flight: 'none' },
    cursor: { phase: 'combat', phasing: 'axis', first: 'axis' }, lateTurnSegment: 'ground-combat' } }
  const context = { reinforcement: { schedule: new Map(), bindings: new Map(), resolveHex: map.resolveHex, arrivalSites: () => [] },
    combat: { ...baseBoard, ...combatExtra } }
  return { record, context }
}
const command = (record, action) => ({ id: `p:${record.revision}`, expectedRevision: record.revision, action })
const submit = (record, context, action, side = record.state.cursor.phasing) => submitCampaignMatch(record, side, command(record, action), context).record
const declare = (target, attackers, tokens) => ({ type: 'declare-campaign-combat', target, attackers,
  payments: attackers.map((unitId) => ({ unitId, source: { kind: 'dump', hex: 'A2.1' }, tokens })) })

test('regrouping defenders pay no defensive supply and inflict a free defensive barrage after step 2', () => {
  const { record, context } = start({ atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def') },
    { postureBenefitAt: (_s, hex, side) => side === 'soviet' && hex === 'A3.1', barrage })
  let r = submit(record, context, declare('A3.1', ['atk'], 1))
  assert.equal(r.state.combat.step, 'defender-supply')
  r = submit(r, context, { type: 'defend-campaign-combat', payments: [] }, 'soviet')
  assert.equal(r.state.combat.defenseSupplied, true)
  assert.equal(r.state.combat.step, 'attacker-rating')
  assert.equal(r.state.combat.defensiveBarrage.code, '2')
  assert.equal(r.state.combat.defensiveBarrage.loss, 1) // 攻方仅 1 步，全毁
  assert.deepEqual(r.state.counters.atk.location, { kind: 'dead-pile' })
})

test('regrouping defenders reject defensive supply payments', () => {
  const { record, context } = start({ atk: unit('axis', 'A2.1', 'atk'), def: unit('soviet', 'A3.1', 'def') },
    { postureBenefitAt: (_s, hex, side) => side === 'soviet' && hex === 'A3.1', barrage })
  const r = submit(record, context, declare('A3.1', ['atk'], 1))
  assert.throws(() => submit(r, context, { type: 'defend-campaign-combat', payments: [{ source: { kind: 'dump', hex: 'A3.1' }, tokens: 1 }] }, 'soviet'),
    /do not pay for defensive combat supply/)
})

test('a regrouping front is limited to 2 SP of attack supply per turn', () => {
  const benefit = (_s, _hex, side) => side === 'axis'
  const extra = { postureBenefitAt: benefit, frontOfHex: () => 'front-x', barrage }
  const ok = start({ atk: unit('axis', 'A2.1', 'atk', { currentRe: 2 }), def: unit('soviet', 'A3.1', 'def') }, extra)
  const r = submit(ok.record, ok.context, declare('A3.1', ['atk'], 2))
  assert.equal(r.state.frontAttackSupply.spent['front-x'], 2)
  const over = start({ atk: unit('axis', 'A2.1', 'atk', { currentRe: 3 }), def: unit('soviet', 'A3.1', 'def') }, extra)
  assert.throws(() => submit(over.record, over.context, declare('A3.1', ['atk'], 3)), /at most 2 SP on attack supply per turn/)
})