import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCombatResult } from '@ocs-eastern/series/tables/ground-combat'
import { remainingSteps } from '../../src/match/scorpion-losses.ts'
import { scorpionHexLayout } from '../../src/view/scorpion-grid-layout.ts'
import { openLocalScorpion } from './controller.mjs'
import { localScorpionEnvelope, readLocalJson, replaceLocalJson } from './store.mjs'

export async function testLocalCombatReview(data, folder, opening, nativeArgs) {
  const { state } = opening
  const [attacker, attackerUnit] = Object.entries(state.units).find(([, unit]) => unit.side === 'axis' && unit.attackCapable)
  const defenders = Object.entries(state.units).filter(([, unit]) =>
    unit.side === 'soviet' && unit.attackCapable && unit.mobility === 'leg' && remainingSteps(unit) >= 2).slice(0, 2)
  assert.equal(defenders.length, 2)
  const [leader, wing] = defenders.map(([id]) => id)
  const start = 's13.10'
  const airfield = 's13.11'
  const end = 's13.12'
  const attackerHex = 's13.09'
  const code = 'A DL2o2'
  const combat = { target: start, attacker: 'axis', attackers: [attacker], defenders: [leader, wing],
    attackerLeader: attacker, defenderLeader: leader, heldAtStart: { axis: [attackerHex], soviet: [start] },
    hedgehog: 0, roll: { code, ...parseCombatResult(code) }, step: 'defender-result' }
  const record = { ...opening, state: { ...state, combat, cursor: { ...state.cursor, phase: 'combat', phasing: 'axis' },
    units: { [attacker]: { ...attackerUnit, hex: attackerHex }, ...Object.fromEntries(defenders.map(([id, unit]) =>
      [id, { ...unit, hex: start, disorganized: false }])) } } }
  const file = join(folder, 'combat-review.json')
  const envelope = localScorpionEnvelope(record, data.fingerprint)
  let client
  const send = (kind, fields = {}) => client.dispatch({ kind, revision: client.view().revision, ...fields })
  const left = (hex, fields) => send('board-left', { ...scorpionHexLayout(hex), ...fields })
  const choose = (label) => send('apply', { key: client.view().actions.find((entry) => entry.label === label).key })
  const checkpoint = async () => (await readLocalJson(file)).record
  function checkResult(result) {
    assert.equal(result.revision, record.revision + 1)
    assert.equal(result.state.units[leader].hex, end)
    assert.equal(result.state.units[wing].hex, end)
    assert.equal(result.state.units[leader].stepsLost, state.units[leader].stepsLost + 1)
    assert.equal(result.state.units[wing].stepsLost, state.units[wing].stepsLost + 1)
    assert.equal(result.state.airBases.find(({ hex }) => hex === airfield).side, 'soviet')
    assert.deepEqual(result.state.captureHistory.map(({ hex }) => hex), [airfield])
    assert.equal(result.state.capture, null)
  }

  try {
    await replaceLocalJson(file, envelope)
    client = await openLocalScorpion(data, file)
    await choose('撤退 2 格')
    assert.deepEqual(client.view().actions.flatMap(({ mapUnit }) => mapUnit ? [mapUnit] : []), [leader])
    await left(start, { unitId: wing })
    assert.match(client.view().combatPrompt, /0\/2 步/)
    await left(start, { unitId: leader })
    assert.deepEqual(client.view().actions.flatMap(({ mapUnit }) => mapUnit ? [mapUnit] : []), [wing])
    await left(start, { unitId: wing })
    await left(airfield)
    await left(end)
    assert.equal((await checkpoint()).revision, record.revision)
    await choose('确认战果')
    checkResult(await checkpoint())
    await client.close()
    client = undefined
    if (nativeArgs) {
      await replaceLocalJson(file, envelope)
      const launcher = fileURLToPath(new URL('./start.mjs', import.meta.url))
      const run = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning',
        launcher, ...nativeArgs, '--smoke', `--save=${file}`], { stdio: 'inherit' })
      if (run.error) throw run.error
      assert.equal(run.status, 0)
      checkResult(await checkpoint())
    }
    console.log('Desktop combat review passed leader-first losses, two clicked retreat hexes and automatic airbase capture.')
  } finally {
    if (client) await client.close()
    await rm(file, { force: true })
  }
}
