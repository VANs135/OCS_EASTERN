import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createRngState } from '@ocs-eastern/series/rng'
import { deployScorpionGroundCounter } from '../../src/import/scorpion-deployment.ts'
import { submitScorpionSession } from '../../src/match/scorpion-session.ts'
import { scorpionHexLayout } from '../../src/view/scorpion-grid-layout.ts'
import { openLocalScorpion } from './controller.mjs'
import { localScorpionEnvelope, readLocalJson, replaceLocalJson } from './store.mjs'

export async function testLocalCapture(data, directory, opening) {
  const from = 's13.10'
  const target = 's13.11'
  const next = 's13.12'
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
  const checkpoint = () => readLocalJson(file).then((save) => save.record)
  const send = (kind, fields = {}) => client.dispatch({ kind, revision: client.view().revision, ...fields })
  const left = (hex, options) => send('board-left', { ...scorpionHexLayout(hex), ...options })
  try {
    await replaceLocalJson(file, localScorpionEnvelope(record, data.fingerprint))
    client = await openLocalScorpion(data, file)
    await left(from, { unitId: attackerId })
    await left(target)
    await left(next)
    await left(next, { confirm: true })
    const settled = await checkpoint()
    assert.equal(settled.state.capture, null)
    assert.equal(settled.state.units[attackerId].hex, next)
    assert.equal(client.view().actor, 'soviet')
    assert.match(client.view().captureNotice, /s13.11 自动夺取/)
    const [report] = settled.state.captureHistory
    assert.equal(settled.state.captureHistory.length, 1)
    assert.deepEqual(report.transports.map(({ die, points, tokens }) => [die, points, tokens]), [[3, 1, 1]])
    assert.ok(report.transportAllocation.every(({ displacedTo }) => displacedTo && displacedTo !== next))
    assert.equal(settled.state.dumps[`soviet:hex:${target}`].tokens, 1)
    assert.ok(settled.state.pieces.every((plane) => plane.location.hex === airDestination && !plane.active))
    assert.ok(client.view().frame.mapStacks.find(({ hex }) => hex === airDestination).pages.flat().some(({ id }) => id === planes[0].id))
    await client.close()
    client = await openLocalScorpion(data, file)
    assert.deepEqual(await checkpoint(), settled)
    await client.close()
    client = undefined

    const legacy = submitScorpionSession(record, 'soviet', { id: 'legacy-capture', expectedRevision: record.revision,
      action: { type: 'ground-move', unitId: attackerId, path: [target] } }, data.assets,
    { ...data.board, captureResolution: 'manual' }).record
    assert.equal(legacy.state.capture.owner, 'axis')
    await replaceLocalJson(file, localScorpionEnvelope(legacy, data.fingerprint))
    client = await openLocalScorpion(data, file)
    const migrated = await checkpoint()
    assert.equal(migrated.state.capture, null)
    assert.equal(migrated.state.rng.drawCount, legacy.state.rng.drawCount)
    assert.equal(migrated.state.captureHistory.length, 1)
    assert.equal(client.view().actor, 'soviet')
    await left(target, { unitId: attackerId })
    await left(next, { confirm: true })
    assert.equal((await checkpoint()).state.units[attackerId].hex, next)
    console.log('Local capture passed automatic settlement on the route, nearby airbase selection and reopening a legacy pause.')
  } finally {
    if (client) await client.close()
    await rm(file, { force: true })
  }
}
