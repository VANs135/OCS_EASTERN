import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRngState } from '@ocs-eastern/series/rng'
import { deployScorpionGroundCounter } from '../../src/import/scorpion-deployment.ts'
import { scorpionHexLayout } from '../../src/view/scorpion-grid-layout.ts'
import { openLocalScorpion } from './controller.mjs'
import { localScorpionEnvelope, readLocalJson, replaceLocalJson } from './store.mjs'

export async function testLocalCapture(data, directory, opening, nativeArgs) {
  const from = 's13.10'
  const target = 's13.11'
  const truckDestination = 's13.12'
  const airDestination = 's18.07'
  const large = 'capture-smoke:large'
  const loaded = 'capture-smoke:loaded'
  const { state } = opening
  const [attackerId, attacker] = Object.entries(state.units).find(([, unit]) =>
    unit.side === 'soviet' && unit.attackCapable && unit.mobility === 'leg' && unit.allowance >= 3)
  const planes = state.pieces.filter((piece) => piece.side === 'axis' && piece.kind === 'aircraft').slice(0, 2)
  assert.equal(planes.length, 2)
  const unit = (ref, tokens) => ({ ...deployScorpionGroundCounter(data.assets.catalog.aliases.get(ref)[0], target, 0),
    transportCargoTokens: tokens })
  const record = { ...opening, state: { ...state, rng: createRngState(12), moved: [], dumps: {}, groundActivity: undefined,
    cursor: { ...state.cursor, phase: 'movement', phasing: 'soviet' }, combat: null,
    units: { [attackerId]: { ...attacker, hex: from }, [large]: unit('Ge Truck 2/45', 0), [loaded]: unit('Ge Truck', 4) },
    pieces: planes.map((plane) => ({ ...plane, location: { kind: 'hex', hex: target }, active: true, reduced: false })),
    airBases: [{ side: 'axis', level: 2, hex: target }, { side: 'axis', level: 2, hex: airDestination }],
  } }
  const file = join(directory, 'capture.json')
  let client
  const checkpoint = (path = file) => readLocalJson(path).then((save) => save.record)
  const send = (kind, fields = {}) => client.dispatch({ kind, revision: client.view().revision, ...fields })
  const left = (hex, options) => send('board-left', { ...scorpionHexLayout(hex), ...options })
  const focus = (id) => send('capture-focus', { id })
  const edit = (id, field, value) => send('capture-edit', { id, field, value })
  try {
    await replaceLocalJson(file, localScorpionEnvelope(record, data.fingerprint))
    client = await openLocalScorpion(data, file)
    await left(from, { unitId: attackerId })
    await left(target)
    await left(target, { confirm: true })
    const pending = await checkpoint()
    assert.equal(client.view().actor, 'axis')
    assert.equal(pending.state.capture.aircraft.length, 2)
    assert.deepEqual(client.view().capture.groups.map(({ die, points, tokens }) => [die, points, tokens]), [[3, 1, 1]])
    await assert.rejects(send('capture-confirm'), /分配完/)
    await client.close()
    client = await openLocalScorpion(data, file)
    assert.equal(client.view().revision, pending.revision)
    assert.equal(client.view().actor, 'axis')
    await edit(large, 'takenPoints', 1)
    await left(truckDestination)
    await edit(loaded, 'takenPoints', 1)
    await edit(loaded, 'takenTokens', 1)
    await left(truckDestination)
    await focus(planes[0].id)
    await left(airDestination)
    await focus(planes[1].id)
    assert.equal(client.view().frame.captureAirBox, 20)
    await send('board-left', { cell: 20 })
    assert.equal(client.view().capture.ready, false)
    await assert.rejects(send('capture-confirm'), /分配完/)
    await edit(large, 'takenPoints', 0)
    await assert.rejects(left('s1.01'), /有效数量或位移落点/)
    assert.equal(client.view().capture.ready, true)
    assert.deepEqual(await checkpoint(), pending)
    await send('capture-confirm')
    const settled = await checkpoint()
    assert.equal(client.view().capture, null)
    assert.equal(client.view().actor, 'soviet')
    assert.equal(settled.state.rng.drawCount, pending.state.rng.drawCount)
    assert.equal(settled.state.captureHistory.length, pending.state.captureHistory.length)
    assert.equal(settled.state.units[large].hex, truckDestination)
    assert.equal(settled.state.dumps[`axis:hex:${truckDestination}`].tokens, 3)
    const captured = Object.values(settled.state.units).find((unit) => unit.side === 'soviet' && !unit.combat)
    assert.equal(captured.transportCargoTokens, 1)
    assert.equal(settled.state.pieces[0].location.hex, airDestination)
    assert.equal(settled.state.pieces[1].location.kind, 'off-map-air')
    assert.ok(client.view().frame.mapStacks.find(({ hex }) => hex === airDestination).pages.flat().some(({ id }) => id === planes[0].id))
    await left(target, { unitId: attackerId })
    await left(from, { confirm: true })
    assert.equal((await checkpoint()).state.units[attackerId].hex, from)
    console.log('Local capture passed original-owner handoff, independent cargo and aircraft choices, reopening and continued movement.')
    if (nativeArgs) {
      const nativeFile = join(directory, 'capture-window.json')
      try {
        await replaceLocalJson(nativeFile, localScorpionEnvelope(pending, data.fingerprint))
        const launcher = fileURLToPath(new URL('./start.mjs', import.meta.url))
        const result = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning',
          launcher, ...nativeArgs, '--smoke', `--save=${nativeFile}`], { stdio: 'inherit' })
        if (result.error) throw result.error
        assert.equal(result.status, 0)
        assert.equal((await checkpoint(nativeFile)).state.capture, null)
      } finally { await rm(nativeFile, { force: true }) }
    }
  } finally {
    if (client) await client.close()
    await rm(file, { force: true })
  }
}
