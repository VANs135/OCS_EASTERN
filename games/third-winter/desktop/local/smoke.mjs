import assert from 'node:assert/strict'
import { mkdtemp, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scorpionHexLayout } from '../../src/view/scorpion-grid-layout.ts'
import { openLocalScorpion, projectLocalScorpion } from './controller.mjs'
import { loadLocalScorpion } from './data.mjs'
import { localScorpionEnvelope, readLocalJson, replaceLocalJson } from './store.mjs'
import { testLocalCapture } from './capture-smoke.mjs'
import { testLocalCombatReview } from './combat-review-smoke.mjs'
import { sampleScorpionFrontBarrage } from '../../scripts/scorpion-front-barrage-example.mjs'

const args = process.argv.slice(2)
const [root, unitRoot] = args.filter((value) => !value.startsWith('--'))
if (!root) throw new Error('Pass the Third Winter data directory')
const dist = fileURLToPath(new URL('../../../../dist/', import.meta.url))
const data = await loadLocalScorpion(resolve(root), dist, unitRoot && resolve(unitRoot))
const folder = await mkdtemp(join(tmpdir(), 'scorpion-local-check-'))
const file = join(folder, 'match.json')
let client = await openLocalScorpion(data, file, 19440126)

async function send(kind, options = {}) {
  return client.dispatch({ kind, revision: client.view().revision, ...options })
}
async function apply(type, matches = () => true, preferBatch = false) {
  const { actions, headline } = client.view()
  const candidates = actions.filter(({ actions }) => actions.some((action) => action.type === type && matches(action)))
  if (preferBatch) candidates.sort((a, b) => b.actions.length - a.actions.length)
  const [action] = candidates
  assert.ok(action, `Missing ${type} at ${headline}`)
  return send('apply', { key: action.key })
}
const left = (id, options = {}) => send('board-left', { ...scorpionHexLayout(id), ...options })
const right = (id, options = {}) => send('board-menu', { ...scorpionHexLayout(id), ...options })
const phase = (headline) => assert.match(client.view().headline, headline)

try {
  await assert.rejects(openLocalScorpion(data, file), /存档正在使用/)
  for (const side of ['axis', 'soviet']) {
    assert.equal(client.view().actor, side)
    const air = client.view().roster.find(({ label }) => label.includes('待部署'))
    if (client.view().unitId !== air.id) await send('select-unit', { unitId: air.id })
    const base = client.view().actions.flatMap(({ actions }) => actions).find((action) => action.type === 'base-aircraft' && action.base.kind === 'hex').base.hex
    const before = client.view().revision
    await left(base)
    assert.equal(client.view().revision, before + 1)
    assert.equal(client.view().roster.find(({ id }) => id === air.id).hex, base)
    await apply('base-aircraft', (action) => action.base.kind === 'off-map-air', true)
    if (side === 'axis') for (const at of ['s1.09', 's2.09']) {
      const alert = client.view().unitId
      const position = await left(at)
      assert.ok(position.frame.mapStacks.find(({ hex }) => hex === at).pages.flat().some(({ id }) => id === alert))
    }
    else for (let count = 0; count < 3; count++) await apply('choose-setup-loss')
    await apply('confirm-setup')
  }
  phase(/第 1 回合 · 苏军 · 飞机整备/)
  await apply('complete-refit')
  while (client.view().actions.some(({ actions }) => actions.some(({ type }) => type === 'place-arrival'))) await apply('place-arrival')
  await apply('place-supply')
  await apply('finish-scheduled-arrivals')
  await apply('complete-reinforcement')
  const captureOpening = (await readLocalJson(file)).record
  const rifle = client.view().roster.find(({ label }) => label.includes('Sov 58 Rifle Div'))
  assert.equal(rifle.hex, 's1.11')
  const stack = await left(rifle.hex)
  assert.ok(stack.stack.some(({ id }) => id === rifle.id))
  await left(rifle.hex, { unitId: rifle.id })
  assert.deepEqual(client.view().unitIds, [rifle.id])
  const second = client.view().roster.find(({ id, hex, label }) => id !== rifle.id && hex && label.includes('Rifle Div'))
  assert.deepEqual((await left(second.hex, { unitId: second.id })).unitIds, [rifle.id, second.id])
  assert.deepEqual((await left(second.hex, { unitId: second.id })).unitIds, [rifle.id])
  const cleared = await left(rifle.hex, { unitId: rifle.id })
  assert.deepEqual(cleared.frame.selectedUnits, [])
  assert.equal(cleared.unitId, null)
  assert.equal(cleared.revision, captureOpening.revision)
  await left(rifle.hex, { unitId: rifle.id })
  const beforeMenu = await readLocalJson(file)
  const context = await right(rifle.hex, { unitId: rifle.id })
  assert.ok(context.menu.some(({ group, actions }) => group === '模式' && actions[0].unitId === rifle.id))
  assert.ok(!context.menu.some(({ group }) => group === '预备队'), 'An adjacent enemy prevents the 58th Rifle Division from entering Reserve')
  assert.ok(!context.menu.some(({ group }) => group === '运输' || group === '空军'))
  assert.deepEqual(await readLocalJson(file), beforeMenu)
  assert.ok(projectLocalScorpion(context).actions.every(({ label }) => !label.includes('切换到')))
  const mode = context.menu.find(({ actions }) => actions[0].type === 'set-ground-mode')
  const route = await left('s1.12')
  assert.deepEqual(route.route, ['s1.12'])
  await assert.rejects(send('apply', { key: mode.key }), /这项操作已不可用/)
  const moveRevision = route.revision
  await left('s1.12', { confirm: true })
  assert.equal(client.view().roster.find(({ id }) => id === rifle.id).hex, 's1.12')
  assert.ok(client.view().frame.mapStacks.find(({ hex }) => hex === 's1.12').pages.flat().some(({ id }) => id === rifle.id))
  await assert.rejects(client.dispatch({ kind: 'apply', revision: moveRevision, key: '0' }), /局面已更新/)
  const checkpoint = await readLocalJson(file)
  await client.close()
  client = await openLocalScorpion(data, file)
  assert.equal(client.view().revision, checkpoint.record.revision)
  assert.equal(client.view().roster.find(({ id }) => id === rifle.id).hex, 's1.12')

  await apply('complete-movement')
  while (client.view().actions.some(({ actions }) => actions.some(({ type }) => type === 'choose-formation-trace'))) await apply('choose-formation-trace')
  await apply('check-attrition')
  while (client.view().actions.some(({ actions }) => actions.some(({ type }) => type === 'assign-attrition'))) await apply('assign-attrition')
  await apply('complete-supply')
  assert.equal(client.view().actor, 'axis')
  await apply('complete-reaction')
  const attacking = client.view().roster.find(({ hex, label }) => hex === 's2.11' && label.includes('Rifle Div'))
  await left(attacking.hex, { unitId: attacking.id })
  const target = 's2.10'
  const enemy = client.view().frame.mapStacks.find(({ hex }) => hex === target).pages.flat()
    .find(({ id }) => !client.view().roster.some((unit) => unit.id === id))
  const battleMenu = await right(target, { unitId: enemy.id })
  assert.ok(battleMenu.menu.every(({ group }) => group !== '模式'))
  const attack = battleMenu.menu.find(({ actions }) => actions[0].type === 'declare-combat')
  assert.ok(attack)
  await send('apply', { key: attack.key })
  assert.equal(client.view().actor, 'axis')
  await apply('defend-combat', (action) => !action.payments.length && !action.internalUnitIds?.length)
  await apply('select-combat-rating')
  await apply('select-combat-rating')
  await apply('choose-combat-terrain')
  phase(/重掷应答/)
  await apply('resolve-reroll', (action) => action.decision === 'reroll')
  assert.equal(client.view().actor, 'axis')
  const pending = structuredClone(client.view().frame.reroll)
  await client.close()
  client = await openLocalScorpion(data, file)
  assert.deepEqual(client.view().frame.reroll, pending)
  while (client.view().phase === '重掷应答') await apply('resolve-reroll', (action) => action.decision === 'keep')
  phase(/战斗应答/)
  for (let count = 0; count < 2; count++) {
    while (!client.view().actions.some(({ actions }) => actions[0]?.type === 'resolve-combat')) {
      const picks = client.view().actions.filter((entry) => entry.mapUnit || entry.mapHex ||
        /^承担 \d+ 步选项损失$|^忽略守方选项$|^结算战果$/.test(entry.label))
      assert.ok(picks.length, client.view().combatPrompt)
      const step = picks.find((entry) => entry.label === '忽略守方选项') ?? picks.at(-1)
      await send('apply', { key: step.key })
    }
    await apply('resolve-combat')
  }
  if (client.view().actions.some(({ actions }) => actions.some(({ type }) => type === 'advance-after-combat'))) {
    await apply('advance-after-combat', (action) => !action.unitIds.length)
  }
  console.log(`Local match passed map deployment, exact counter/context selection, double-click movement, combat and a saved reroll at revision ${client.view().revision}.`)
  await testLocalCapture(data, folder, captureOpening)
  await checkAidCard(captureOpening)
  const nativeArgs = args.includes('--native-review') ?
    [root, unitRoot, args.find((value) => value.startsWith('--smoke-image='))].filter(Boolean) : undefined
  await testLocalCombatReview(data, folder, captureOpening, nativeArgs)
} finally {
  await client.close()
  await unlink(file)
  await rmdir(folder)
}

async function checkAidCard(opening) {
  const example = sampleScorpionFrontBarrage(opening, data.assets, data.board)
  const file = join(folder, 'aid-card.json')
  const saved = localScorpionEnvelope(opening, data.fingerprint)
  await replaceLocalJson(file, saved)
  let game
  try {
    game = await openLocalScorpion(data, file)
    const dispatch = (kind, fields) => game.dispatch({ kind, revision: game.view().revision, ...fields })
    const counterId = `artillery:${example.front}`
    const selected = await dispatch('aid-left', { counterId })
    assert.equal(selected.frame.selectedAidCounter, counterId)
    assert.ok(selected.aidTargets.includes(example.center))
    const draft = await dispatch('board-left', scorpionHexLayout(example.center))
    const action = draft.actions.find(({ actions }) => actions[0]?.type === 'declare-front-barrage')
    assert.ok(action, draft.aidPrompt)
    assert.ok(projectLocalScorpion(draft).actions.some(({ key }) => key === action.key))
    assert.deepEqual(await readLocalJson(file), saved)
    const placed = await dispatch('apply', { key: action.key })
    assert.equal(placed.revision, opening.revision + 1)
    assert.equal(placed.actor, 'axis')
    assert.ok(placed.frame.mapStacks.find(({ hex }) => hex === example.center).pages.flat().some(({ id }) => id === counterId))
    assert.ok(!placed.frame.aidCounters.some(({ id }) => id === counterId))
    assert.equal((await readLocalJson(file)).record.state.frontBarrage.front, example.front)
    console.log('Aid card passed marker selection, map placement and saved handoff to the defender.')
  } finally {
    await game?.close()
    await unlink(file)
  }
}
