import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { scorpionHexLayout } from '../../src/view/scorpion-grid-layout.ts'
import { applyScorpionCombatLosses } from '../../src/match/scorpion-combat-losses.ts'
import { openLocalScorpion, projectLocalScorpion } from './controller.mjs'
import { localScorpionEnvelope, readLocalJson, replaceLocalJson } from './store.mjs'

export async function testAuxiliaryCards(data, folder, opening) {
  await testReservePool(data, join(folder, 'reserves.json'), opening)
  await testKesselBox(data, join(folder, 'kessel.json'), opening)
  console.log('Auxiliary cards passed reserve stock, Kessel placement, removal, combat loss and return after three turns.')
}

async function testReservePool(data, file, opening) {
  await replaceLocalJson(file, localScorpionEnvelope(opening, data.fingerprint))
  const game = await openLocalScorpion(data, file)
  try {
    const { state } = opening
    const plain = Object.entries(state.units).filter(([, unit]) => unit.side === 'soviet' &&
      unit.combat && unit.mobility === 'leg' && !unit.reserve)
    let pair
    for (const group of Map.groupBy(plain, ([, unit]) => unit.hex).values()) {
      if (group.length < 2) continue
      const [[id, { hex }], [other]] = group
      const view = await click(game, 'board-menu', { ...scorpionHexLayout(hex), unitId: id })
      if (view.menu.some(({ actions: [action] }) => action.type === 'mark-reserve') &&
        (await click(game, 'board-menu', { ...scorpionHexLayout(hex), unitId: other }))
          .menu.some(({ actions: [action] }) => action.type === 'mark-reserve')) {
        pair = { hex, ids: [id, other] }
        break
      }
    }
    assert.ok(pair, 'A Soviet stack must support the two-counter reserve test')
    const rows = [
      ['mark-reserve', pair.ids[0], 5, 1],
      ['mark-reserve', pair.ids[1], 5, 1],
      ['leave-reserve', pair.ids[0], 5, 1],
      ['leave-reserve', pair.ids[1], 6, 0],
    ]
    checkReserveView(game.view(), pair.hex, 6, 0)
    for (const [type, unitId, stock, active] of rows) {
      const { menu } = await click(game, 'board-menu', { ...scorpionHexLayout(pair.hex), unitId })
      const choice = menu.find(({ actions: [action] }) => action.type === type)
      assert.ok(choice, type)
      const view = await click(game, 'apply', { key: choice.key })
      checkReserveView(view, pair.hex, stock, active)
    }
  } finally {
    await game.close()
    await rm(file, { force: true })
  }
}

function checkReserveView(view, hex, stock, active) {
  const { auxiliaryCards, mapStacks } = view.frame
  const { counters } = auxiliaryCards['soviet-off-map']
  assert.equal(counters.filter(({ id }) => id.startsWith('reserve:soviet:')).length, stock)
  assert.equal(counters.find(({ id }) => id === 'reserve-count:soviet').badges[0].text, String(stock))
  const onMap = mapStacks.find((stack) => stack.hex === hex).pages.flat().flatMap(({ badges }) => badges ?? [])
  assert.equal(onMap.filter(({ asset, label }) => asset && label === '预备').length, active)
}

async function testKesselBox(data, file, opening) {
  const definition = 'hq:id:4151'
  const counterId = `kessel-box:${definition}`
  const reinforcements = { ...opening, state: { ...opening.state,
    cursor: { ...opening.state.cursor, phasing: 'axis', phase: 'reinforcement' },
    window: { stage: 'variable', variableTokens: 0, pendingAlert: null },
  } }
  const saved = (record) => localScorpionEnvelope(record, data.fingerprint)
  const hasReady = (view) => view.frame.auxiliaryCards['axis-off-map'].counters.some(({ id }) => id === counterId)
  await replaceLocalJson(file, saved(reinforcements))
  let game
  try {
    game = await openLocalScorpion(data, file)
    assert.ok(hasReady(game.view()))
    assert.ok(!game.view().frame.auxiliaryCards['axis-off-map'].counters.some(({ id }) => id === 'kessel-box:hq:id:4150'))
    const selection = await click(game, 'aid-left', { counterId })
    const [hex] = selection.aidTargets
    assert.ok(hex)
    const draft = await click(game, 'board-left', scorpionHexLayout(hex))
    const order = draft.actions.find(({ actions: [action] }) => action.type === 'place-kessel-hq')
    assert.ok(order)
    assert.ok(projectLocalScorpion(draft).actions.some(({ key }) => key === order.key))
    const deployed = await click(game, 'apply', { key: order.key })
    assert.ok(!hasReady(deployed))
    const unitId = `kessel:${definition}`
    assert.ok(deployed.frame.mapStacks.find((stack) => stack.hex === hex).pages.flat().some(({ id }) => id === unitId))
    const onMap = (await readLocalJson(file)).record
    const defeated = applyScorpionCombatLosses(onMap.state, new Map([[unitId, 1]]), data.assets)
    assert.ok(!defeated.pieces.some(({ id }) => id === unitId))
    assert.equal(defeated.kesselReturns[definition], 4)
    const { menu } = await click(game, 'board-menu', { ...scorpionHexLayout(hex), unitId })
    const remove = menu.find(({ actions: [action] }) => action.type === 'remove-kessel-hq')
    assert.ok(remove)
    const cooling = await click(game, 'apply', { key: remove.key })
    assert.ok(!hasReady(cooling))
    const returnId = `kessel-return:${definition}`
    const track = cooling.frame.auxiliaryCards['turn-weather'].counters
    assert.match(track.find(({ id }) => id === returnId).label, /第 4 回合可用/)
    const checkpoint = (await readLocalJson(file)).record
    await game.close()
    game = await openLocalScorpion(data, file)
    assert.deepEqual(game.view().frame.auxiliaryCards['turn-weather'].counters, track)
    await assert.rejects(click(game, 'command', { action: order.actions[0] }), /available Kessel HQ/)
    await game.close()
    const state = { ...checkpoint.state, turn: { ...checkpoint.state.turn, number: 4 },
      cursor: { ...checkpoint.state.cursor, turn: 4 } }
    await replaceLocalJson(file, saved({ ...checkpoint, state }))
    game = await openLocalScorpion(data, file)
    assert.ok(hasReady(game.view()))
    assert.ok(!game.view().frame.auxiliaryCards['turn-weather'].counters.some(({ id }) => id === returnId))
    assert.ok(!state.units[unitId])
  } finally {
    await game?.close()
    await rm(file, { force: true })
  }
}

function click(game, kind, fields) {
  return game.dispatch({ kind, revision: game.view().revision, ...fields })
}
