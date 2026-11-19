import assert from 'node:assert/strict'
import { mkdtemp, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scorpionHexLayout } from '../../src/view/scorpion-grid-layout.ts'
import { openLocalScorpion } from './controller.mjs'
import { loadLocalScorpion } from './data.mjs'
import { readLocalJson } from './store.mjs'

const root = process.argv[2]
if (!root) throw new Error('Pass the Third Winter data directory')
const dist = fileURLToPath(new URL('../../../../dist/', import.meta.url))
const data = await loadLocalScorpion(resolve(root), dist, process.argv[3] && resolve(process.argv[3]))
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
const point = (id) => send('select-hex', scorpionHexLayout(id))
const phase = (headline) => assert.match(client.view().headline, headline)

try {
  await assert.rejects(openLocalScorpion(data, file), /存档正在使用/)
  for (const side of ['axis', 'soviet']) {
    assert.equal(client.view().actor, side)
    const air = client.view().roster.find(({ label }) => label.includes('待部署'))
    await send('select-unit', { unitId: air.id })
    await apply('base-aircraft', (action) => action.base.kind === 'hex')
    await apply('base-aircraft', (action) => action.base.kind === 'off-map-air', true)
    if (side === 'axis') for (const at of ['s1.09', 's2.09']) {
      await point(at)
      await apply('place-setup-alert', (action) => action.hex === at)
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
  const rifle = client.view().roster.find(({ label }) => label.includes('Sov 58 Rifle Div'))
  assert.equal(rifle.hex, 's1.11')
  await send('select-unit', { unitId: rifle.id })
  const route = await point('s1.12')
  assert.deepEqual(route.route, ['s1.12'])
  const moveRevision = route.revision
  await apply('ground-move')
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
  await send('select-unit', { unitId: attacking.id })
  await point('s2.10')
  await apply('declare-combat')
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
  for (let count = 0; count < 2; count++) await apply('resolve-combat')
  if (client.view().actions.some(({ actions }) => actions.some(({ type }) => type === 'advance-after-combat'))) {
    await apply('advance-after-combat', (action) => !action.unitIds.length)
  }
  console.log(`Local match passed deployment, map movement, reopening, combat handoffs and a saved reroll at revision ${client.view().revision}.`)
} finally {
  await client.close()
  await unlink(file)
  await rmdir(folder)
}
