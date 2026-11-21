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
  await testGroundStacking(data, join(folder, 'stacking.json'), opening)
  await testEngineeringMenu(data, join(folder, 'engineering.json'), opening)
  console.log('Auxiliary cards passed reserve stock, Kessel placement, removal, return and ground stacking settlement.')
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

async function testGroundStacking(data, file, opening) {
  const hex = 's10.02'
  const definition = 'hq:id:4151'
  const { state } = opening
  const group = []
  let re = 0
  for (const [id, unit] of Object.entries(state.units)) {
    if (unit.side !== 'axis' || !unit.combat || unit.headquarters?.kessel) continue
    const remaining = unit.printedRe - unit.stepsLost
    if (re + remaining > 10) continue
    group.push([id, { ...unit, hex }])
    re += remaining
    if (re === 10) break
  }
  assert.equal(re, 10)
  const reinforcements = { ...opening, state: { ...state, units: Object.fromEntries(group),
    cursor: { ...state.cursor, phasing: 'axis', phase: 'reinforcement' },
    window: { stage: 'variable', variableTokens: 0, pendingAlert: null } } }
  await replaceLocalJson(file, localScorpionEnvelope(reinforcements, data.fingerprint))
  const game = await openLocalScorpion(data, file)
  const applyType = (view, type) => {
    const action = view.actions.find(({ actionTypes }) => actionTypes.includes(type))
    assert.ok(action, type)
    return click(game, 'apply', { key: action.key })
  }
  try {
    const selected = await click(game, 'aid-left', { counterId: `kessel-box:${definition}` })
    assert.deepEqual(selected.aidTargets, [hex])
    const picked = await click(game, 'board-left', scorpionHexLayout(hex))
    const deployed = await applyType(projectLocalScorpion(picked), 'place-kessel-hq')
    assert.deepEqual(deployed.stacking, [], 'Reinforcement ignores stacking')
    const moved = await applyType(projectLocalScorpion(deployed), 'complete-reinforcement')
    let view = projectLocalScorpion(moved)
    assert.equal(view.protocolVersion, 1)
    assert.equal(view.phaseId, 'movement')
    assert.equal(view.phasingSide, 'axis')
    assert.deepEqual(view.stacking.map(({ hex, re, limit }) => [hex, re, limit]), [['s10.02', 11, 10]])
    assert.ok(!view.actions.some(({ actionTypes }) => actionTypes.includes('complete-movement')))
    await assert.rejects(click(game, 'command', { action: { type: 'complete-movement' } }), /stacking limit/)
    await assert.rejects(click(game, 'command', { action: { type: 'settle-stacking', hex, unitIds: ['missing'] } }), /whole combat units/)
    const [[id]] = group
    view = projectLocalScorpion(await click(game, 'board-left', { ...scorpionHexLayout(hex), unitId: id }))
    const pending = view.actions.find(({ actionTypes }) => actionTypes.includes('settle-stacking'))
    assert.ok(pending)
    await click(game, 'clear-selection', {})
    await assert.rejects(click(game, 'apply', { key: pending.key }), /这项操作已不可用/)
    view = projectLocalScorpion(await click(game, 'board-left', { ...scorpionHexLayout(hex), unitId: id }))
    const settled = await applyType(view, 'settle-stacking')
    assert.deepEqual(settled.stacking, [])
    assert.ok(settled.frame.auxiliaryCards['axis-dead'].counters.some((counter) => counter.id === id))
    const supply = await applyType(projectLocalScorpion(settled), 'complete-movement')
    assert.equal(supply.phaseId, 'supply')
  } finally {
    await game.close()
    await rm(file, { force: true })
  }
}

function click(game, kind, fields) {
  return game.dispatch({ kind, revision: game.view().revision, ...fields })
}

async function testEngineeringMenu(data, file, opening) {
  const { state } = opening
  const hex = 's10.02'
  const dumpId = `axis:hex:${hex}`
  const axis = Object.values(state.units).filter((unit) => unit.side === 'axis')
  const infantry = axis.find((unit) => unit.combat && unit.attackCapable && unit.mobility === 'leg' && unit.allowance > 0)
  const engineer = axis.find((unit) => unit.headquarters && !unit.headquarters.kessel && !unit.moveMode)
  const kessel = axis.find((unit) => unit.headquarters?.kessel)
  assert.ok(infantry && engineer && kessel, 'The opening has an Axis infantry unit and both types of HQ')
  const units = { infantry: { ...infantry, hex }, engineer: { ...engineer, hex }, kessel: { ...kessel, hex } }
  const staged = { ...state, units, airBases: [], pieces: [], moved: [], groundActivity: undefined, phaseOccupancy: undefined,
    cursor: { ...state.cursor, phase: 'movement', phasing: 'axis' },
    dumps: { [dumpId]: { side: 'axis', location: 'on-map', tokens: 4 } } }
  await replaceLocalJson(file, localScorpionEnvelope({ ...opening, state: staged }, data.fingerprint))
  const game = await openLocalScorpion(data, file)
  const menuAt = (at, unitId) => click(game, 'board-menu', { ...scorpionHexLayout(at), unitId })
  const pick = (unitId) => click(game, 'board-left', { ...scorpionHexLayout(hex), unitId })
  try {
    await pick('infantry')
    let move
    for (const target of data.assets.map.neighbors(hex)) {
      const { menu } = await menuAt(target)
      move = menu.find(({ actions: [action] }) => action.type === 'kessel-move')
      if (move) break
    }
    assert.ok(move, 'The destination menu offers a legal Kessel move')
    const [target] = move.actions[0].path
    const moved = await click(game, 'apply', { key: move.key })
    assert.ok(moved.frame.mapStacks.find((stack) => stack.hex === target).pages.flat().some(({ id }) => id === 'infantry'))

    const stock = (view) => view.frame.auxiliaryCards['axis-off-map'].counters.filter(({ id }) => id.startsWith('airstrip:'))
    const before = stock(moved)
    assert.equal(before.length, 6)
    const { menu } = await menuAt(hex, 'engineer')
    const build = menu.find(({ actions: [action] }) => action.type === 'work-airfield' && action.operation === 'build-strip')
    assert.ok(build, 'The engineer menu offers construction')
    const built = await click(game, 'apply', { key: build.key })
    assert.equal(stock(built).length, before.length - 1)
    const stripId = before.find(({ id }) => !stock(built).some((counter) => counter.id === id)).id
    assert.ok(built.frame.mapStacks.find((stack) => stack.hex === hex).pages.flat().some(({ id }) => id === stripId))
    assert.equal((await readLocalJson(file)).record.state.dumps[dumpId].tokens, 3)
    console.log('Engineering menus passed Kessel movement, runway construction, payment and stock-to-map projection.')
  } finally {
    await game.close()
    await rm(file, { force: true })
  }
}
