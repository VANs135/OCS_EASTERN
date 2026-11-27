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

const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))
const [root, output = join(dist, 'godot', '08-scorpion.json'), tables = dist] = process.argv.slice(2)
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
