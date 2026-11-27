import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLocalScorpion, projectLocalScorpion } from '../desktop/local/controller.mjs'
import { loadLocalScorpion } from '../desktop/local/data.mjs'
import { readLocalJson } from '../desktop/local/store.mjs'
import { scorpionHexLayout } from '../src/view/scorpion-grid-layout.ts'
import { sampleScorpionOpening } from './scorpion-sample-opening.mjs'
import { scorpionSupplyNetwork } from '../src/ttw/scorpion/supply-trace.ts'
import { scorpionSupplyPosition } from '../src/match/scorpion-supply-position.ts'
import { scorpionAxisSources, scorpionSovietSources } from '../src/ttw/scorpion/initial-map.ts'
import { scorpionStepCost } from '../src/ttw/scorpion/terrain-cost.ts'
import { remainingSteps } from '../src/match/scorpion-losses.ts'

const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))
const argv = process.argv.slice(2)
const extended = argv.includes('--extended')
const [root, output = join(dist, 'godot', extended ? '08-scorpion-extended.json' : '08-scorpion.json'), tables = dist] =
  argv.filter((arg) => arg !== '--extended')
if (!root) throw new Error('请提供第三冬资料库目录，可另传输出路径和图表目录')

const seed = 19440126
const data = await loadLocalScorpion(resolve(root), resolve(tables))
const opening = sampleScorpionOpening(data.setup, data.assets, seed)
const directory = await mkdtemp(join(tmpdir(), 'ocs-godot-scorpion-'))
const savePath = join(directory, 'oracle.json')
const keys = new Map()
const records = {}
const steps = []
let match

function controlKey(key) {
  if (!keys.has(key)) keys.set(key, `control-${keys.size + 1}`)
  return keys.get(key)
}

function project(rawView) {
  const view = projectLocalScorpion(rawView)
  const controls = (entries) => entries?.map((entry) => ({ ...entry, key: controlKey(entry.key) }))
  return { ...view, actions: controls(view.actions), menu: controls(view.menu) }
}

async function capture(rawView) {
  const { record } = await readLocalJson(savePath)
  assert.equal(record.revision, rawView.revision)
  const normalized = { ...record, receipts: record.receipts.map((receipt) => ({ ...receipt, id: `receipt-${receipt.revision}` })) }
  if (records[record.revision]) assert.deepEqual(normalized, records[record.revision])
  else records[record.revision] = normalized
  return project(rawView)
}

async function send(kind, fields = {}, errorPattern) {
  const request = { kind, revision: match.view().revision, ...fields }
  const normalized = kind === 'apply' ? { ...request, key: controlKey(request.key) } : request
  if (errorPattern) {
    let errorMessage
    await assert.rejects(match.dispatch(request), (error) => {
      assert.match(error.message, errorPattern)
      errorMessage = error.message
      return true
    })
    steps.push({ request: normalized, errorMessage, view: await capture(match.view()) })
    return
  }
  const view = await match.dispatch(request)
  steps.push({ request: normalized, view: await capture(view) })
  return view
}

function apply(type) {
  const { actions, headline } = match.view()
  const control = actions.find(({ actions }) => actions.some((action) => action.type === type))
  assert.ok(control, `${headline} 缺少 ${type}`)
  return send('apply', { key: control.key })
}

function has(type) {
  return match.view().actions.some(({ actions }) => actions.some((action) => action.type === type))
}

function click(kind, hex, fields = {}) {
  return send(kind, { ...scorpionHexLayout(hex), ...fields })
}

// —— 扩档（--extended）：第 1 回合战斗段之后的正规战斗、换手整备/增援与第 2 回合 ——

async function latestState() {
  return (await readLocalJson(savePath)).record.state
}

/** 排空战斗/重掷/撤退等待决窗口；夺取在自动结算策略下随同一条命令落定。 */
async function drainPending() {
  for (;;) {
    const state = await latestState()
    if (state.reroll) {
      await send('command', { action: { type: 'resolve-reroll', decision: 'keep' } })
      continue
    }
    if (state.combat?.retreat) {
      await send('command', { action: { type: 'continue-combat-retreat' } })
      continue
    }
    if (state.capture) throw new Error('存在待手动结算的夺取窗口，扩档路径未覆盖')
    break
  }
}

function pickCombatant(state, side) {
  const map = data.assets.map
  const enemy = side === 'soviet' ? 'axis' : 'soviet'
  const enemySources = side === 'soviet' ? scorpionAxisSources : scorpionSovietSources
  const network = scorpionSupplyNetwork(map, scorpionSupplyPosition(state, map, side))
  for (const [unitId, unit] of Object.entries(state.units)) {
    if (unit.side !== side || !unit.attackCapable || unit.reserve || unit.mobility !== 'leg') continue
    const dumpId = Object.keys(state.dumps).find((id) => id.startsWith(`${side}:hex:`) &&
      state.dumps[id].tokens >= remainingSteps(unit) && network.canUseDump(unit.hex, id.split(':')[2]))
    const target = map.neighbors(unit.hex).find((hex) => {
      if (map.edge(unit.hex, hex)?.river || enemySources.includes(hex)) return false
      return Object.values(state.units).some((e) => e.side === enemy && e.combat && e.hex === hex)
    })
    if (dumpId && target) return { unitId, unit, dumpId, target }
  }
  return null
}

async function resolveCombatSide(role) {
  const state = await latestState()
  const battle = state.combat
  const slots = role === 'attacker' ? battle.attackers : battle.defenders
  const leader = role === 'attacker' ? battle.attackerLeader : battle.defenderLeader
  const ordered = [leader, ...slots.filter((id) => id !== leader)]
  const counts = new Map(ordered.map((id) => [id, remainingSteps(state.units[id])]))
  const rolled = battle.roll
  const hard = Math.min(rolled[role].loss, [...counts.values()].reduce((total, count) => total + count, 0))
  const lossOrder = []
  while (lossOrder.length < hard + rolled[role].option && [...counts.values()].some((count) => count > 0)) {
    for (const id of ordered) {
      if (lossOrder.length === hard + rolled[role].option) break
      if (counts.get(id) > 0) { lossOrder.push(id); counts.set(id, counts.get(id) - 1) }
    }
  }
  await send('command', { action: { type: 'resolve-combat', lossOrder, optionLosses: lossOrder.length - hard, retreats: [] } })
  await drainPending()
}

/** 正规战斗七步；返回是否找到合法战斗并开打。 */
async function runRegularCombat(side) {
  const chosen = pickCombatant(await latestState(), side)
  if (!chosen) return false
  const { unitId, unit, dumpId, target } = chosen
  await send('command', { action: { type: 'declare-combat', target, attackers: [unitId],
    payments: [{ unitId, dumpId, tokens: remainingSteps(unit) }] } })
  await drainPending()
  await send('command', { action: { type: 'defend-combat', payments: [], internalUnitIds: [] } })
  await drainPending()
  await send('command', { action: { type: 'select-combat-rating', unitId } })
  const defender = (await latestState()).combat.defenders[0]
  await send('command', { action: { type: 'select-combat-rating', unitId: defender } })
  const terrain = data.assets.map.hexes.get(target).terrains[0]
  await send('command', { action: { type: 'choose-combat-terrain', terrain, attackingTerrain: { [unit.hex]: terrain } } })
  await drainPending()
  await resolveCombatSide('attacker')
  await resolveCombatSide('defender')
  const after = await latestState()
  if (after.combat?.step === 'advance') {
    await send('command', { action: { type: 'advance-after-combat', unitIds: [] } })
    await drainPending()
  }
  return true
}

async function driveReinforcement() {
  while (has('place-arrival')) { await apply('place-arrival'); await drainPending() }
  let state = await latestState()
  if (state.window?.fixedTokens) {
    const dest = state.window.fixedDestinations[0]
    await send('command', { action: { type: 'place-supply', target: { kind: 'hex', id: dest }, tokens: state.window.fixedTokens } })
    await drainPending()
  }
  await apply('finish-scheduled-arrivals')
  await drainPending()
  state = await latestState()
  const rules = data.board.reinforcements(state)
  if (state.window?.variableTokens) {
    const side = state.cursor.phasing
    const id = [...rules.supplySources[side]].find((hex) => rules.controlOf(hex) !== side) ?? [...rules.supplySources[side]][0]
    await send('command', { action: { type: 'place-supply', target: { kind: 'hex', id }, tokens: state.window.variableTokens } })
    await drainPending()
  }
  if (state.window?.pendingAlert) {
    const dest = [...rules.alertDestinations(state.window.pendingAlert)].sort()[0]
    if (dest) await send('command', { action: { type: 'place-alert', hex: dest } })
    else await send('command', { action: { type: 'pass-alert' } })
    await drainPending()
  }
  await apply('complete-reinforcement')
}

async function driveMovement() {
  const state = await latestState()
  const side = state.cursor.phasing
  const map = data.assets.map
  const mover = Object.entries(state.units).find(([id, unit]) => unit.side === side && unit.combat && !unit.reserve &&
    unit.mobility === 'leg' && unit.allowance > 0 && !state.moved.includes(id))
  if (mover) {
    const [unitId, unit] = mover
    const dest = map.neighbors(unit.hex).find((hex) => {
      if (map.edge(unit.hex, hex)?.river) return false
      if (Object.values(state.units).some((e) => e.side !== side && e.combat && e.hex === hex)) return false
      return scorpionStepCost(map, unit.hex, hex, 'leg', state.turn.weather.ground) !== null
    })
    if (dest) {
      await send('command', { action: { type: 'ground-move', unitId, path: [dest] } })
      await drainPending()
    }
  }
  await apply('complete-movement')
}

async function driveSupply() {
  while (has('choose-formation-trace')) await apply('choose-formation-trace')
  await apply('check-attrition')
  while (has('assign-attrition')) await apply('assign-attrition')
  await apply('complete-supply')
}

async function driveInitiative() {
  for (;;) {
    const state = await latestState()
    const kind = state.turn.step.kind
    if (kind === 'player-turn') return
    if (kind === 'retention') {
      const responder = state.turn.step.responder
      const dumpId = Object.keys(state.dumps).find((id) => state.dumps[id].side === responder &&
        state.dumps[id].location === 'on-map' && state.dumps[id].tokens >= 4)
      if (dumpId) await send('command', { action: { type: 'retain-initiative', dumpId } })
      else await send('command', { action: { type: 'roll-initiative' } })
    } else if (kind === 'roll') {
      await send('command', { action: { type: 'roll-initiative' } })
    } else if (kind === 'choose-order') {
      await send('command', { action: { type: 'choose-first', first: state.turn.step.responder } })
    }
    await drainPending()
  }
}

async function driveExtended() {
  // 苏军第 1 回合：战斗段 → 进击段 → 清理段
  await runRegularCombat('soviet')
  await apply('complete-combat')
  await apply('complete-exploitation')
  await apply('complete-cleanup')
  // 轴心第 1 回合：整备 → 增援 → 地面移动 → 补给 → 反应 → 战斗 → 进击 → 清理
  await apply('complete-refit')
  await driveReinforcement()
  await driveMovement()
  await driveSupply()
  await apply('complete-reaction')
  await apply('complete-combat')
  await apply('complete-exploitation')
  await apply('complete-cleanup')
  // 回合换手：主动权应答
  await driveInitiative()
  // 第 2 回合：整备 → 增援 → 地面移动 → 补给 → 反应 → 战斗
  await apply('complete-refit')
  await driveReinforcement()
  await driveMovement()
  await driveSupply()
  await apply('complete-reaction')
  const state = await latestState()
  if (state.cursor.phase === 'combat' && (await runRegularCombat(state.cursor.phasing))) {
    await apply('complete-combat')
    await apply('complete-exploitation')
    await apply('complete-cleanup')
  }
}

try {
  match = await openLocalScorpion(data, savePath, seed)
  const bootstrap = await capture(match.view())
  const [first, ...remaining] = opening.started.receipts
  const aircraft = first.action
  assert.equal(aircraft.type, 'base-aircraft')
  assert.equal(aircraft.base.kind, 'hex')
  await send('select-unit', { unitId: aircraft.id })
  await click('board-left', aircraft.base.hex)
  assert.equal(match.view().revision, first.revision)
  for (const { side, action, revision } of remaining) {
    assert.equal(match.view().actor, side)
    await send('command', { action })
    assert.equal(match.view().revision, revision)
  }
  assert.deepEqual((await readLocalJson(savePath)).record.state, JSON.parse(JSON.stringify(opening.started.state)))

  await apply('complete-refit')
  while (has('place-arrival')) await apply('place-arrival')
  for (const action of ['place-supply', 'finish-scheduled-arrivals', 'complete-reinforcement']) await apply(action)

  const rifle = match.view().roster.find(({ label }) => label.includes('Sov 58 Rifle Div'))
  assert.equal(rifle?.hex, 's1.11')
  await click('board-left', rifle.hex, { unitId: rifle.id })
  const menu = await click('board-menu', rifle.hex, { unitId: rifle.id })
  const changeMode = menu.menu.find(({ actions }) => actions[0].type === 'set-ground-mode')
  assert.ok(changeMode)
  const route = await click('board-left', 's1.12')
  assert.deepEqual(route.route, ['s1.12'])
  await send('apply', { key: changeMode.key }, /这项操作已不可用/)
  await click('board-left', 's1.12', { confirm: true })
  assert.equal(match.view().roster.find(({ id }) => id === rifle.id)?.hex, 's1.12')
  await send('apply', { key: changeMode.key, revision: route.revision }, /局面已更新/)

  const beforeReload = match.view().revision
  await match.close()
  match = await openLocalScorpion(data, savePath, seed)
  assert.equal(match.view().revision, beforeReload)
  assert.equal(match.view().roster.find(({ id }) => id === rifle.id)?.hex, 's1.12')
  steps.push({ reload: true, view: await capture(match.view()) })

  await apply('complete-movement')
  while (has('choose-formation-trace')) await apply('choose-formation-trace')
  await apply('check-attrition')
  while (has('assign-attrition')) await apply('assign-attrition')
  await apply('complete-supply')
  assert.equal(match.view().actor, 'axis')
  await apply('complete-reaction')
  assert.equal(match.view().actor, 'soviet')

  if (extended) await driveExtended()

  const { map, imageDirectory, aid, cards, ...model } = data.model
  const asset = ({ path, ...rest }) => ({ ...rest, path: basename(path) })
  const vector = {
    version: 1, scenarioId: '08-korsun-pocket', seed, fingerprint: data.fingerprint,
    model: { ...model, map: basename(map), aid: asset(aid), cards: cards.map(asset) }, bootstrap, steps, records,
  }
  await mkdir(dirname(resolve(output)), { recursive: true })
  await writeFile(resolve(output), JSON.stringify(vector) + '\n')
  console.log(`已导出 08 TypeScript 对照 · ${steps.length} 步 · ${match.view().revision} 个修订 · ${resolve(output)}`)
} finally {
  await match?.close()
  await rm(savePath, { force: true })
  await rmdir(directory)
}
