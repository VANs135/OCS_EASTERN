import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { join, resolve } from 'node:path'
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { scorpionHexLayout } from '../../src/view/scorpion-grid-layout.ts'
import { playScorpionToEnd } from '../../scripts/scorpion-playthrough.mjs'
import { sampleScorpionOpening } from '../../scripts/scorpion-sample-opening.mjs'
import { openLocalScorpion, projectLocalScorpion } from './controller.mjs'
import { loadLocalScorpion } from './data.mjs'
import { readLocalJson } from './store.mjs'

const options = process.argv.slice(2)
const [root, unitRoot] = options.filter((value) => !value.startsWith('--'))
if (!root) throw new Error('Pass the Third Winter data directory')
const dist = fileURLToPath(new URL('../../../../dist/', import.meta.url))
const data = await loadLocalScorpion(resolve(root), dist, unitRoot && resolve(unitRoot))
const seed = 19440126
const { started } = sampleScorpionOpening(data.setup, data.assets, seed)
const arrivals = data.board.reinforcements(started.state).catalog
let expected
const result = playScorpionToEnd(data.setup, data.assets, arrivals, { seed, withdraw: true,
  onComplete: (record) => { expected = record } })
const folder = await mkdtemp(join(tmpdir(), 'scorpion-local-playthrough-'))
const file = resolve(folder, 'match.json')
const cueFile = join(folder, 'window-steps.json')
const nativeSave = join(folder, 'native-match.json')
const windowSteps = options.includes('--native') ? [] : null
let game
let restarts = 0

try {
  game = await openLocalScorpion(data, file, seed)
  for (const receipt of expected.receipts) {
    const { action, side, revision } = receipt
    assert.equal(game.view().actor, side, `Seat at revision ${revision}`)
    try { await perform(action) }
    catch (error) {
      const choices = projectLocalScorpion(game.view()).actions.map(({ label }) => label).slice(0, 8)
      throw new Error(`Revision ${revision} · ${game.view().headline} · ${JSON.stringify(action)} · visible: ${choices.join(' / ')}`, { cause: error })
    }
    assert.equal(game.view().revision, revision, `One accepted command at revision ${revision}`)
    if (action.type === 'complete-cleanup') {
      const { frame, actor, headline } = game.view()
      await game.close()
      game = await openLocalScorpion(data, file)
      assert.deepEqual([game.view().frame, game.view().actor, game.view().headline], [frame, actor, headline])
      restarts++
    }
  }
  const finished = game.view()
  const saved = (await readLocalJson(file)).record
  assert.ok(finished.ended)
  assert.equal(projectLocalScorpion(finished).actions.length, 0)
  assert.deepEqual(saved.state, expected.state)
  assert.deepEqual(finished.frame.trackers.map(({ id }) => id), ['turn', 'ground', 'flight', 'vp'])
  assert.match(finished.headline, /第 8 回合 · 平局/)
  console.log(`Desktop playthrough passed · ${finished.headline} · VP ${result.vp} · ${saved.revision} actions · ${restarts} reloads.`)
  if (windowSteps) await replayInWindow()
} finally {
  await game?.close()
  await Promise.all([file, cueFile, nativeSave].map((path) => rm(path, { force: true })))
  await rmdir(folder)
}

async function dispatch(kind, fields, control) {
  const view = await game.dispatch({ kind, revision: game.view().revision, ...fields })
  windowSteps?.push({ kind, ...fields, control, expectedRevision: view.revision, expectedHeadline: view.headline })
  return view
}

async function select(id) {
  if (game.view().unitId !== id) {
    const row = game.view().roster.find((unit) => unit.id === id)
    assert.ok(row, `Missing roster item ${id}`)
    const stack = game.view().frame.mapStacks.find(({ hex }) => hex === row.hex)
    if (stack?.pages.some((page) => page.some((counter) => counter.id === id))) {
      const { x, y } = scorpionHexLayout(row.hex)
      await dispatch('board-left', { x, y, hex: row.hex, unitId: id })
    }
    else await dispatch('select-unit', { unitId: id })
  }
}

async function perform(action) {
  const { type } = action
  if (type === 'ground-move') {
    await select(action.unitId)
    for (const hex of action.path) {
      const { x, y } = scorpionHexLayout(hex)
      await dispatch('board-left', { x, y })
    }
    if (action.fuelDumpId || action.fuelHeadquartersId) {
      const { x, y } = scorpionHexLayout(action.path.at(-1))
      const menu = await dispatch('board-menu', { x, y })
      return applyVisible(menu.menu, projectLocalScorpion(menu).menu, action)
    }
  }
  if (['place-setup-alert', 'base-aircraft', 'choose-setup-loss'].includes(type)) await select(action.id)
  if (type === 'place-arrival') await select(action.arrivalId)
  if (type === 'feed-units') await select(action.payments[0].portions[0].unitId)
  const view = game.view()
  return applyVisible(view.actions, projectLocalScorpion(view).actions, action)
}

async function replayInWindow() {
  const nativeOpening = await openLocalScorpion(data, nativeSave, seed)
  await nativeOpening.close()
  await writeFile(cueFile, JSON.stringify({ steps: windowSteps }), 'utf8')
  const launcher = fileURLToPath(new URL('./start.mjs', import.meta.url))
  const paths = [root, unitRoot].filter(Boolean)
  const child = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning',
    launcher, ...paths, '--smoke', `--tables=${dist}`, `--save=${nativeSave}`, `--smoke-replay=${cueFile}`],
  { windowsHide: true, stdio: 'inherit' })
  await new Promise((done, fail) => {
    child.once('error', fail)
    child.once('exit', (code) => code === 0 ? done() : fail(new Error(`Native playthrough exited with code ${code}`)))
  })
  const saved = (await readLocalJson(nativeSave)).record
  assert.equal(saved.revision, expected.revision)
  assert.deepEqual(saved.state, expected.state)
}

function applyVisible(candidates, visible, action) {
  const controls = new Map(visible.map((control) => [control.key, control]))
  const next = candidates.find(({ key, actions }) => controls.has(key) && actions.length === 1 &&
    isDeepStrictEqual(JSON.parse(JSON.stringify(actions[0])), JSON.parse(JSON.stringify(action))))
  assert.ok(next, 'No matching visible control')
  const { label, group } = controls.get(next.key)
  return dispatch('apply', { key: next.key }, { label, group })
}
