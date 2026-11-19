import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { scorpionMap } from '../src/import/scorpion-map.ts'
import { submitScorpionSession } from '../src/match/scorpion-session.ts'
import { localChoices } from '../desktop/local/actions.mjs'
import { localMenu } from '../desktop/local/interaction.mjs'
import { advanceChoices, advanceDraft, defenseSupplyChoices, defenseSupplyDraft, defendingStackCost, terrainChoices, terrainDraft } from '../desktop/local/combat-draft.mjs'
import { artilleryChoices, artilleryDraft, frontBarrageDraft, frontChoices } from '../desktop/local/barrage-draft.mjs'
import { scorpionBarrageMarkerFrame } from '../src/view/scorpion-barrage-markers.ts'

// Acceptance boards for 第一批第 2、3 项 of 2026-11-19 后续开发方案. The rules layer already charges
// and settles; these cases pin that the player-facing draft offers exactly the rows the rule layer
// accepts, and that every confirmed row lands in one command with one debit.

const pairs = [['s10.01', 's10.02'], ['s10.02', 's10.03'], ['s15.08', 's15.09'], ['s15.09', 's15.10']]
const map = scorpionMap([...new Set(pairs.flat())].map((hex_id) => ({ hex_id, on_map: true, terrains_present: ['Open'] })),
  [...pairs.filter(([hex_a, hex_b]) => !(hex_a === 's10.01' && hex_b === 's10.02'))
    .map(([hex_a, hex_b]) => ({ hex_a, hex_b, edge_terrain: 'none', road_present: false, rail_present: false, bridge: false })),
    // A minor river on the western approach, so one origin can name the river instead of the terrain.
    { hex_a: 's10.01', hex_b: 's10.02', edge_terrain: 'river', river_class: 'minor', road_present: false, rail_present: false, bridge: false }])
const definitions = new Map(Array.from({ length: 8 }, (_, index) => [`counter-${index}`, { source: { name: `算子 ${index}` } }]))
const assets = { map, catalog: { definitions, aliases: new Map() } }
const columns = ['1:5', '1:4', '1:3', '1:2', '1:1', '2:1', '3:1', '4:1', '5:1', '7:1', '9:1', '11:1', '13:1']
function combatTable(code = 'Ae4 DL1o1') {
  return { diceRows: ['1 or less', '2-14', '15 or more'], terrainColumns: { Open: columns, Close: columns },
    matrix: Array.from({ length: 3 }, () => [...columns, ...columns].map(() => code)) }
}
function artilleryTable(code = '-') {
  return { columns: ['1 or less', '2', '3-4', '5-7', '8-11', '12-16', '17-24', '25+'], costs: [1, 1, 2, 2, 2, 3, 3, 4],
    matrix: Array.from({ length: 11 }, () => Array(8).fill(code)) }
}

const data = { assets, board: { supplyRail: { railGauge: () => 'axis' }, barrage: artilleryTable(), combat: { table: combatTable() } } }

const unit = (side, hex, extra = {}) => ({ side, hex, printedRe: 1, stepsLost: 0, actionRating: 4, strength: 4,
  combatClass: 'other', antiTank: 0, attackCapable: true, fueled: false, combat: true, mobility: 'leg', allowance: 3,
  definition: `counter-${extra.index ?? 0}`, ...extra })

function fixture(phase, units, dumps = { 'soviet:hex:s10.01': { side: 'soviet', location: 'on-map', tokens: 10 } }) {
  return { revision: 0, receipts: [], state: { kind: 'playing', units,
    cursor: { turn: 1, first: 'soviet', phasing: 'soviet', phase, retention: 'soviet' },
    turn: { number: 1, weather: { ground: 'freeze', flight: 'limited' }, vp: 0, thawSeen: false,
      step: { kind: 'player-turn', first: 'soviet', retention: 'soviet' } },
    rng: createRngState(1), dumps, moved: [], pieces: [], availableAlerts: [], railControl: {}, rerollHolder: null,
    airBases: [], combat: null, arrivalsOnMap: [], placedAlerts: [], window: null,
    combatTargets: [], combatAttackers: [], arrival: { placed: [], mobilized: [], sovietVp: 0 }, victory: null } }
}

const submit = (record, side, action, option = data.board) => submitScorpionSession(record, side,
  { id: `board-${record.revision}-${action.type}`, expectedRevision: record.revision, action }, assets, option).record

// ── 验收盘面 1：守方整堆支付，成本按整堆 RE 计（OCS 12.4 / 13.2g）─────────────────────────
test('board 1: defending stack cost is 2T once the stack totals more than 1 RE', () => {
  assert.equal(defendingStackCost([unit('axis', 's10.02')]), 1, 'a single 1 RE defender costs 1T')
  assert.equal(defendingStackCost([unit('axis', 's10.02', { printedRe: 2 })]), 2)
  assert.equal(defendingStackCost([unit('axis', 's10.02'), unit('axis', 's10.02', { outOfSupply: true })]), 2,
    'two 1 RE defenders total 2 RE and cost 2T')
  assert.equal(defendingStackCost([unit('axis', 's10.02', { printedRe: 3, stepsLost: 2 })]), 1,
    'a division reduced to 1 RE left costs 1T again')
})

// ── 验收盘面 2：多来源扣账 —— 补给堆 + 运输点同一次确认，各只扣一次 ──────────────────────────
test('board 2: one confirmation pays a defending stack from a dump and a transport point together', () => {
  const target = 's10.02'
  const record = fixture('combat', { attacker: unit('soviet', 's10.01', { strength: 12 }),
    first: unit('axis', target, { formation: 'one' }), second: unit('axis', target, { formation: 'two' }),
    truck: unit('axis', target, { combat: false, organicTruck: 'full', formation: 'one' }) })
  record.state.dumps['axis:hex:s10.02'] = { side: 'axis', location: 'on-map', tokens: 3 }
  const opened = submit(record, 'soviet', { type: 'declare-combat', target, attackers: ['attacker'],
    payments: [{ unitId: 'attacker', dumpId: 'soviet:hex:s10.01', tokens: 1 }] })
  const draft = defenseSupplyDraft(opened.state, 'axis', data, ['first', 'second'])
  assert.equal(draft.cost, 2)
  const mixed = draft.payments.find(({ payments }) => payments.length === 2)
  assert.ok(mixed, 'the draft keeps a split that draws on two sources')
  const rows = defenseSupplyChoices(draft)
  const confirmed = rows.find(({ payments }) => payments.length === 2)
  assert.match(confirmed.label, /\+/, 'the label names both sources so the player sees the split')
  const supplied = submit(opened, 'axis', { type: 'defend-combat', payments: confirmed.payments })
  assert.equal(supplied.state.combat.defenseSupplied, true)
  const dump = Object.fromEntries(confirmed.payments.map(({ dumpId, tokens }) => [dumpId, tokens]))
  assert.equal(supplied.state.dumps['axis:hex:s10.02'].tokens, 3 - (dump['axis:hex:s10.02'] ?? 0))
  assert.equal(supplied.state.units.truck.transportCargoTokens, 4 - (dump.truck ?? 0), 'the transport point is debited only for its own tokens')
})

// ── 验收盘面 3：两个各 1 RE 的守军仅有 1T —— 只能整堆自付或不付，不能半付 ────────────────────
test('board 3: two 1 RE defenders with only 1T are offered no partly-paid row', () => {
  const target = 's10.02'
  const record = fixture('combat', { attacker: unit('soviet', 's10.01', { strength: 12 }),
    first: unit('axis', target), second: unit('axis', target, { outOfSupply: true }) })
  record.state.dumps['axis:hex:s10.02'] = { side: 'axis', location: 'on-map', tokens: 1 }
  const opened = submit(record, 'soviet', { type: 'declare-combat', target, attackers: ['attacker'],
    payments: [{ unitId: 'attacker', dumpId: 'soviet:hex:s10.01', tokens: 1 }] })
  const draft = defenseSupplyDraft(opened.state, 'axis', data, [])
  assert.equal(draft.cost, 2)
  assert.deepEqual(draft.payments, [], '1T cannot pay a 2T stack, so the draft offers no on-map row')
  // OCS 12.10h: each defender may fall back on its own stocks, and the whole stack may do so at once.
  assert.deepEqual(draft.stockUnitIds, ['first', 'second'])
  const rows = defenseSupplyChoices(draft)
  assert.ok(rows.some(({ internalUnitIds }) => internalUnitIds.length === 2), 'the whole stack can self-supply in one command')
  const both = submit(opened, 'axis', { type: 'defend-combat', payments: [], internalUnitIds: ['first', 'second'] })
  assert.equal(both.state.units.first.internalStocks, 'low')
  assert.equal(both.state.units.second.internalStocks, 'low')
  assert.equal(both.state.dumps['axis:hex:s10.02'].tokens, 1, 'the unused token stays on the map, it is not wasted')
  assert.throws(() => submit(opened, 'axis', { type: 'defend-combat', payments: [{ dumpId: 'axis:hex:s10.02', tokens: 1 }] }),
    /full defending stack cost/, 'a partly paid stack is still refused by the rules layer')
})

// ── 验收盘面 4：逐枚决定是否动用部队储备，已耗尽的不列 ────────────────────────────────────
test('board 4: internal-stock rows list only defenders that still have stocks and are short on supply', () => {
  const target = 's10.02'
  const record = fixture('combat', { attacker: unit('soviet', 's10.01', { strength: 12 }),
    ready: unit('axis', target), exhausted: unit('axis', target, { internalStocks: 'exhausted' }) })
  record.state.dumps['axis:hex:s10.02'] = { side: 'axis', location: 'on-map', tokens: 1 }
  const opened = submit(record, 'soviet', { type: 'declare-combat', target, attackers: ['attacker'],
    payments: [{ unitId: 'attacker', dumpId: 'soviet:hex:s10.01', tokens: 1 }] })
  const draft = defenseSupplyDraft(opened.state, 'axis', data, [])
  assert.deepEqual(draft.stockUnitIds, ['ready'], 'an exhausted counter is never offered as a self-supplier')
  const one = submit(opened, 'axis', { type: 'defend-combat', payments: [], internalUnitIds: ['ready'] })
  assert.equal(one.state.units.ready.internalStocks, 'low')
  assert.throws(() => submit(opened, 'axis', { type: 'defend-combat', payments: [], internalUnitIds: ['exhausted'] }),
    /exhausted/)
})

// ── 验收盘面 5：攻方分别选择来路地形或河流 ────────────────────────────────────────────────
test('board 5: each attacking origin names its own terrain or the river it crosses', () => {
  const target = 's10.02'
  const record = fixture('combat', { west: unit('soviet', 's10.01'), north: unit('soviet', 's10.03'),
    defender: unit('axis', target) })
  record.state.dumps['soviet:hex:s10.01'].tokens = 10
  record.state.dumps['soviet:hex:s10.03'] = { side: 'soviet', location: 'on-map', tokens: 10 }
  // The defender still has to answer its own supply step before either side picks Action Ratings.
  record.state.dumps['axis:hex:s10.02'] = { side: 'axis', location: 'on-map', tokens: 2 }
  const opened = submit(record, 'soviet', { type: 'declare-combat', target, attackers: ['west', 'north'],
    payments: [{ unitId: 'west', dumpId: 'soviet:hex:s10.01', tokens: 1 }, { unitId: 'north', dumpId: 'soviet:hex:s10.03', tokens: 1 }] })
  const answered = submit(opened, 'axis', { type: 'defend-combat', payments: [{ dumpId: 'axis:hex:s10.02', tokens: 1 }] })
  const settled = submit(answered, 'soviet', { type: 'select-combat-rating', unitId: 'west' })
  const rated = submit(settled, 'axis', { type: 'select-combat-rating', unitId: 'defender' })
  const draft = terrainDraft(rated.state, 'axis', data)
  assert.deepEqual(draft.origins.sort(), ['s10.01', 's10.03'])
  const rows = terrainChoices(draft)
  const river = rows.find(({ attackingTerrain }) => attackingTerrain['s10.01'] === 'minor-river')
  assert.ok(river, 'the origin across the minor river can name the river instead of the printed terrain')
  assert.equal(river.attackingTerrain['s10.03'], 'Open', 'the other origin keeps its own choice')
  assert.ok(rows.some(({ attackingTerrain }) => attackingTerrain['s10.01'] === 'Open' && attackingTerrain['s10.03'] === 'Open'))
  const resolved = submit(rated, 'axis', { type: 'choose-combat-terrain', terrain: river.terrain, attackingTerrain: river.attackingTerrain })
  assert.ok(resolved.state.combat.roll, 'the resolution produces a dice result')
  assert.equal(resolved.state.combat.step, 'attacker-result')
  // OCS 9.7-9.9: surprise always takes two dice, combat always two, and a shift (when the surprise total
  // reaches the shift threshold) takes one more. So a resolution costs four or five draws either way,
  // and the terrain row the defender picked does not change that.
  const draws = resolved.state.rng.drawCount - rated.state.rng.drawCount
  assert.ok(draws === 4 || draws === 5, `a combat resolution draws four or five dice, got ${draws}`)
})

// ── 验收盘面 6：多枚推进 —— 一次确认带整批，地图与骰序一致 ──────────────────────────────
test('board 6: a batch of surviving attackers advances in one command and keeps the dice order', () => {
  const target = 's10.02'
  const record = fixture('combat', { one: unit('soviet', 's10.01'), two: unit('soviet', 's10.03'),
    three: unit('soviet', 's10.03', { index: 1 }) })
  record.state.combat = { target, attacker: 'soviet', attackers: ['one', 'two', 'three'], defenders: [], heldAtStart: { axis: [], soviet: [] },
    hedgehog: 0, step: 'advance' }
  const draft = advanceDraft(record.state, 'soviet')
  assert.deepEqual(draft.survivors, ['one', 'two', 'three'])
  assert.equal(draft.room, 10)
  const rows = advanceChoices(draft, (id) => id)
  const batch = rows.find(({ unitIds }) => unitIds.length === 3)
  assert.ok(batch, 'three surviving counters that fit the 10 RE limit are offered as one batch')
  const advanced = submit(record, 'soviet', { type: 'advance-after-combat', unitIds: batch.unitIds })
  assert.equal(advanced.state.combat, null)
  assert.deepEqual(batch.unitIds.map((id) => advanced.state.units[id].hex), [target, target, target])
  assert.equal(advanced.state.rng.drawCount, record.state.rng.drawCount, 'advancing rolls no dice')
  assert.equal(advanced.state.turn.vp, record.state.turn.vp, 'no victory points move without a capture')
  // One counter alone is still offered, and opting out stays available.
  assert.ok(rows.some(({ unitIds }) => unitIds.length === 0), 'the attacker may still decline to advance')
  assert.ok(rows.some(({ unitIds }) => unitIds.length === 1))
})

test('board 6: advancing onto a captured dump settles the seizure once and moves the same dice count', () => {
  const target = 's10.02'
  const record = fixture('combat', { one: unit('soviet', 's10.01'), two: unit('soviet', 's10.03') })
  // 8T of Axis supply waits in the hex: an attack-capable unit entering it must take the capture die.
  record.state.dumps['axis:hex:s10.02'] = { side: 'axis', location: 'on-map', tokens: 8 }
  record.state.combat = { target, attacker: 'soviet', attackers: ['one', 'two'], defenders: [], heldAtStart: { axis: [], soviet: [] },
    hedgehog: 0, step: 'advance' }
  const rows = advanceChoices(advanceDraft(record.state, 'soviet'), (id) => id)
  const batch = rows.find(({ unitIds }) => unitIds.length === 2)
  const result = submitScorpionSession(record, 'soviet', { id: 'capture-once', expectedRevision: record.revision,
    action: { type: 'advance-after-combat', unitIds: batch.unitIds } }, assets, data.board).record
  const history = result.state.captureHistory ?? []
  assert.equal(history.length, 1, 'the two counters advance as one batch and take one capture die between them')
  assert.equal(history[0].hex, target)
  assert.equal(history[0].captor, 'soviet')
  assert.ok(history[0].dump, 'the Axis dump in the hex was seized')
  assert.equal(result.state.dumps['axis:hex:s10.02'], undefined, 'the seized dump leaves the Axis ledger')
  const kept = result.state.dumps['soviet:hex:s10.02']?.tokens ?? 0
  assert.equal(kept + history[0].dump.destroyed, 8, 'every seized token is either kept or destroyed, never counted twice')
  assert.equal(result.state.rng.drawCount, record.state.rng.drawCount + 1, 'exactly one die settles the dump')
  assert.ok(history[0].dump.die >= 1 && history[0].dump.die <= 6, 'the recorded capture die is one printed die')
  // The seize is a supply event, not a combat result: no victory point moves for it.
  assert.equal(result.state.turn.vp, record.state.turn.vp)
  assert.equal(result.state.arrival.sovietVp, record.state.arrival.sovietVp)
})

test('board 6b: the batch is withheld when the target cannot hold that many RE', () => {
  const target = 's10.02'
  const record = fixture('combat', { big: unit('soviet', 's10.01', { printedRe: 7 }), small: unit('soviet', 's10.03', { printedRe: 4 }) })
  record.state.combat = { target, attacker: 'soviet', attackers: ['big', 'small'], defenders: [], heldAtStart: { axis: [], soviet: [] },
    hedgehog: 0, step: 'advance' }
  const rows = advanceChoices(advanceDraft(record.state, 'soviet'), (id) => id)
  assert.equal(rows.filter(({ unitIds }) => unitIds.length > 1).length, 0, '7 + 4 RE exceeds the stacking limit of 10')
  assert.ok(rows.some(({ unitIds }) => unitIds.length === 1))
  assert.throws(() => submit(record, 'soviet', { type: 'advance-after-combat', unitIds: ['big', 'small'] }), /stacking/)
})

// ── 验收盘面 7：联合射击 —— 两门炮经共同司令部付款，只扣一次 ───────────────────────────
test('board 7: two batteries fire together and pay the column once through a common HQ', () => {
  const target = 's10.03'
  const record = fixture('combat', { first: unit('soviet', 's10.01', { artillery: { strength: 8, range: 2 } }),
    second: unit('soviet', 's10.02', { artillery: { strength: 8, range: 2 } }),
    hq: unit('soviet', 's10.01', { headquarters: { throwRange: 2, mobility: 'truck', kessel: false } }),
    defender: unit('axis', target) })
  // Two dumps of 2T each: the combined volley sits in the 12-16 column and costs 3T, so neither dump
  // alone can pay it and no single dump is shared by both batteries. Only HQ delivery can back the volley.
  record.state.dumps['soviet:hex:s10.01'] = { side: 'soviet', location: 'on-map', tokens: 2 }
  record.state.dumps['soviet:hex:s10.02'] = { side: 'soviet', location: 'on-map', tokens: 2 }
  const draft = artilleryDraft(record.state, 'soviet', target, data, [])
  assert.equal(draft.available, true)
  const joined = draft.rows.find(({ fields }) => fields.batteries.length === 2)
  assert.ok(joined, 'two batteries in range are offered as one volley')
  assert.equal(joined.fields.supply.kind, 'hq', 'no single dump covers the column, so the volley is paid through one HQ')
  assert.equal(joined.cost, 3, '16 barrage strength sits in the 12-16 column, which costs 3T')
  assert.equal(joined.fields.supply.payments.length, 2, 'both dumps feed the one HQ delivery')
  assert.equal(joined.fields.supply.payments.reduce((total, { tokens }) => total + tokens, 0), joined.cost,
    'the two payments add up to the column cost, not to twice the cost')
  const choices = artilleryChoices(draft).filter(({ batteries }) => batteries.length === 2)
  const fired = submit(record, 'soviet', { type: 'declare-artillery-barrage', target, batteries: choices[0].batteries,
    supply: choices[0].supply }, { ...data.board, barrage: artilleryTable('-') })
  assert.equal(fired.state.barrage.batteries.length, 2)
  const left = fired.state.dumps['soviet:hex:s10.01'].tokens + fired.state.dumps['soviet:hex:s10.02'].tokens
  assert.equal(left, 4 - fired.state.barrage.cost, 'the column is charged exactly once across both dumps')
})

test('board 7b: the draft names why a hex cannot be barraged this phase', () => {
  const target = 's10.03'
  const record = fixture('movement', { battery: unit('soviet', 's10.01', { artillery: { strength: 8, range: 2 } }),
    defender: unit('axis', target) })
  const draft = artilleryDraft(record.state, 'soviet', target, data)
  assert.equal(draft.available, false)
  assert.match(draft.reason, /阶段/)
  // A single dump any one battery can draw is still a legal single-battery volley in the right phase.
  const combatPhase = fixture('combat', { battery: unit('soviet', 's10.01', { artillery: { strength: 8, range: 2 } }),
    defender: unit('axis', target) })
  const single = artilleryDraft(combatPhase.state, 'soviet', target, data)
  assert.equal(single.available, true)
  assert.deepEqual(single.batteries, ['battery'])
})

// ── 验收盘面 8：方面军炮击 —— 标记从辅助卡到地图、翻面进恢复格并按回合推进 ────────────────
test('board 8: the front marker is drafted from the aid card and walks a centre plus two adjacent targets', () => {
  const aidCatalog = { aliases: new Map(['1st Ukr Arty Ready', '2nd Ukr Arty Ready'].map((ref) =>
    [ref, [{ kind: 'marker', source: { faces: { combat: { asset: `${ref}.png` }, move: { asset: `${ref}-spent.png` } } } }]])) }
  const frame = (state) => scorpionBarrageMarkerFrame(state, aidCatalog)
  const record = fixture('movement', {
    army: unit('soviet', 's10.01', { headquarters: { throwRange: 2, mobility: 'truck', kessel: false } }),
    artillery: unit('soviet', 's10.01', { printedRe: 2, artillery: { strength: 28, range: 2, independentRe: true } }),
    target: unit('axis', 's10.02'), adjacent: unit('axis', 's10.03') })
  const front = 'first-ukrainian'
  assert.equal(frame(record.state).aidCounters.length, 2)
  // The marker is clicked on the aid card first: that is what makes a front draggable at all.
  const blank = frontBarrageDraft(record.state, 'soviet', data, front, undefined)
  assert.equal(blank.available, false, 'without a centre the draft only lists the hexes it may occupy')
  assert.ok(blank.centers.includes('s10.02'))
  const draft = frontBarrageDraft(record.state, 'soviet', data, front, 's10.02')
  assert.equal(draft.available, true)
  assert.deepEqual(draft.targets.sort(), ['s10.02', 's10.03'])
  const rows = frontChoices(draft)
  assert.ok(rows.length >= 1)
  assert.equal(rows[0].volleys.length, 2, 'one centre plus two adjacent targets is the可用盘面 the spec asks for')
  const fired = submit(record, 'soviet', { type: 'declare-front-barrage', front, center: 's10.02', hqId: rows[0].hqId,
    volleys: rows[0].volleys }, { ...data.board, barrage: artilleryTable('-') })
  assert.equal(fired.state.dumps['soviet:hex:s10.01'].tokens, 10, 'TTW 3.4a: the marker costs no supply')
  assert.equal(frame(fired.state).mapCounters[0].id, `artillery:${front}`, 'the marker leaves the card for its sector')
  const terrain = { type: 'choose-barrage-terrain', terrain: 'Open' }
  let settled = submit(fired, 'axis', terrain, { ...data.board, barrage: artilleryTable('-') })
  assert.equal(settled.state.barrage.target, 's10.03', 'the second volley follows automatically')
  settled = submit(settled, 'axis', terrain, { ...data.board, barrage: artilleryTable('-') })
  assert.equal(frame(settled.state).mapCounters.length, 0)
  assert.match(frame(settled.state).aidCounters.find(({ id }) => id === `artillery:${front}`).asset, /-spent/)
  assert.equal(settled.state.barrageRecovery[front], 1, 'the flipped marker goes to recovery box 1')
  assert.equal(frontBarrageDraft(settled.state, 'soviet', data, front, 's10.02').reason, '这枚标记已翻面，正在恢复格')
  // TTW 3.4b: Soviet reinforcement of the named turn puts it back in the ready slot.
  const later = { ...settled, state: { ...settled.state, cursor: { ...settled.state.cursor, turn: 2, phase: 'reinforcement' },
    arrivalsOnMap: [], placedAlerts: [], window: { stage: 'variable', variableTokens: 0 } } }
  const reinforced = submit(later, 'soviet', { type: 'complete-reinforcement' }, { ...data.board, reinforcements: () => ({}) })
  assert.equal(reinforced.state.barrageRecovery[front], 2, 'the recovery box advances one per turn')
})

// ── 验收盘面 8c：方面军炮击的战损按规则结算一次 ────────────────────────────────────────
test('board 8c: a front volley that scores a loss takes exactly one allocation for the whole stack', () => {
  // A '2' result: the target stack loses two steps, and the defender allocates them once. Two 1-step
  // defenders means each counter takes one, so the stack does not shrink twice over.
  const table = { columns: ['1 or less', '2', '3-4', '5-7', '8-11', '12-16', '17-24', '25+'], costs: [1, 1, 2, 2, 2, 3, 3, 4],
    matrix: Array.from({ length: 11 }, () => Array(8).fill('2')) }
  const record = fixture('movement', {
    army: unit('soviet', 's10.01', { headquarters: { throwRange: 2, mobility: 'truck', kessel: false } }),
    artillery: unit('soviet', 's10.01', { printedRe: 2, artillery: { strength: 28, range: 2, independentRe: true } }),
    hinted: unit('axis', 's10.02'), other: unit('axis', 's10.02', { index: 1 }), adjacent: unit('axis', 's10.03', { index: 2 }) })
  const front = 'first-ukrainian'
  const draft = frontBarrageDraft(record.state, 'soviet', data, front, 's10.02')
  const rows = frontChoices(draft)
  const fired = submit(record, 'soviet', { type: 'declare-front-barrage', front, center: 's10.02', hqId: rows[0].hqId,
    volleys: rows[0].volleys }, { ...data.board, barrage: table })
  assert.equal(fired.state.barrage.roll, undefined, 'declaring only prepares the volley; nothing is rolled yet')
  const lost = submit(fired, 'axis', { type: 'choose-barrage-terrain', terrain: 'Open' }, { ...data.board, barrage: table })
  assert.equal(lost.state.barrage.target, 's10.02')
  assert.equal(lost.state.barrage.lossesDue, 2, 'the column-2 result reads as two mandatory steps')
  const settled = submit(lost, 'axis', { type: 'assign-barrage-loss', allocation: [
    { unitId: 'hinted', steps: 1 }, { unitId: 'other', steps: 1 }] }, { ...data.board, barrage: table })
  assert.equal(lost.state.barrageHistory.at(-1).roll.code, '2', 'one barrage roll is taken and recorded')
  // Each step is charged once: both defenders are gone after the one allocation.
  assert.equal(settled.state.units.hinted, undefined)
  assert.equal(settled.state.units.other, undefined)
  // The marker still owes its second volley, which is exactly why the barrage slot is not yet clear.
  assert.equal(settled.state.barrage.target, 's10.03', 'the second volley takes the slot after the first is settled')
  assert.equal(settled.state.frontBarrage.remaining.length, 0)
  assert.throws(() => submit(lost, 'axis', { type: 'assign-barrage-loss', allocation: [
    { unitId: 'hinted', steps: 2 }, { unitId: 'other', steps: 1 }] }, { ...data.board, barrage: table }),
    /exactly the mandatory barrage losses/, 'the same loss cannot be taken twice')
})

test('board 8b: a marker is refused outside Soviet turn one and reports the reason in the draft', () => {
  const record = fixture('movement', { army: unit('soviet', 's10.01', { headquarters: { throwRange: 2, mobility: 'truck', kessel: false } }),
    artillery: unit('soviet', 's10.01', { printedRe: 2, artillery: { strength: 28, range: 2, independentRe: true } }),
    target: unit('axis', 's10.02') })
  record.state.cursor.turn = 2
  assert.equal(frontBarrageDraft(record.state, 'soviet', data, 'first-ukrainian', 's10.02').reason, '本作只在第 1 回合可用')
  const axis = { ...record.state, cursor: { ...record.state.cursor, turn: 1, phasing: 'axis' } }
  assert.equal(frontBarrageDraft(axis, 'soviet', data, 'first-ukrainian', 's10.02').reason, '只在苏军回合放置')
  assert.equal(frontChoices(frontBarrageDraft(record.state, 'soviet', data, 'first-ukrainian', 's10.02')).length, 0)
})

// ── 桌面入口：右键目标格列候选，菜单里能出现联合射击与方面军炮击 ────────────────────────
test('the right-click menu on a target hex carries combined fire, and the aid marker carries the front barrage', () => {
  const record = fixture('combat', { first: unit('soviet', 's10.01', { artillery: { strength: 8, range: 2 } }),
    second: unit('soviet', 's10.02', { artillery: { strength: 8, range: 2 } }),
    hq: unit('soviet', 's10.01', { headquarters: { throwRange: 2, mobility: 'truck', kessel: false } }),
    defender: unit('axis', 's10.03') })
  record.state.dumps['soviet:hex:s10.02'] = { side: 'soviet', location: 'on-map', tokens: 4 }
  const menu = localMenu(record.state, 'soviet', { unitId: 'first' }, { hex: 's10.03', ownIds: [], labels: {} }, data,
    (selection) => localChoices(record.state, 'soviet', selection, data))
  const joined = menu.filter(({ actions }) => actions[0].type === 'declare-artillery-barrage' && actions[0].batteries.length === 2)
  assert.ok(joined.length >= 1)
  assert.equal(joined[0].group, '射击')
  const front = fixture('movement', { army: unit('soviet', 's10.01', { headquarters: { throwRange: 2, mobility: 'truck', kessel: false } }),
    artillery: unit('soviet', 's10.01', { printedRe: 2, artillery: { strength: 28, range: 2, independentRe: true } }),
    target: unit('axis', 's10.02') })
  const rows = localChoices(front.state, 'soviet', { unitId: 'army', hex: 's10.02' }, data)
    .filter(({ actions }) => actions[0].type === 'declare-front-barrage')
  assert.equal(rows.length, 1, 'a centre-hex click offers the front barrage command')
  assert.match(rows[0].label, /方面军炮击/)
})
