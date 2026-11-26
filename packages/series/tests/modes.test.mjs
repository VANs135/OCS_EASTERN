import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canEngineer, canFlipOrientation, canMoveInPhase, canReleaseReserve, canStackWithHedgehog, canSwitchMode,
  canUseTransport, clearReleased, effectiveMode, exertsZoc, flipOrientation, groundModeEffect,
  isMobileUnit, markersAfterDg, modeUnitClass, mustEndMoveInSupply, resolveModeStats, validateModeState,
} from '../src/modes.ts'

// 通规 5.0–5.10 模式合法性层（移植自斯摩棱斯克，作品/剧本中立；专规闸门注入）。
const combat = { face: 'combat' }
const move = { face: 'move' }
const reserve = { face: 'combat', marker: 'reserve' }
const strat = { face: 'move', marker: 'strat' }
const dg = { face: 'combat', marker: 'dg' }
const exploit = { face: 'combat', marker: 'exploit' }

test('mode switch legality follows 5.4/5.5/5.6/5.7/5.8 and unit-class gates', () => {
  const base = { to: 'reserve', orientation: 'combat', inEnemyZoc: false, unitClass: 'combat', side: 'soviet', phase: 'movement' }
  assert.equal(canSwitchMode(base).ok, true)
  assert.equal(canSwitchMode({ ...base, phase: 'reaction' }).ok, false) // 5.4
  assert.equal(canSwitchMode({ ...base, to: 'strat', orientation: 'combat' }).ok, false) // 5.8
  assert.equal(canSwitchMode({ ...base, inEnemyZoc: true }).ok, false) // 5.7c
  assert.equal(canSwitchMode({ ...base, to: 'strat', orientation: 'move', inEnemyZoc: true }).ok, false) // 5.8a
  assert.equal(canSwitchMode({ ...base, unitClass: 'transportPoint' }).ok, false) // 5.7f
  assert.equal(canSwitchMode({ ...base, unitClass: 'organicTruck' }).ok, true) // 5.7f 例外
  assert.equal(canSwitchMode({ ...base, to: 'combat', unitClass: 'repl' }).ok, false) // 5.5c
  assert.equal(canSwitchMode({ ...base, unitClass: 'facility' }).ok, false) // 6.1b
  assert.equal(canSwitchMode({ ...base, adjacentEnemyAttackCapable: true }).ok, false) // IV-B
})

test('work-specific operational limit is injected, not built in', () => {
  const base = { to: 'strat', orientation: 'move', inEnemyZoc: false, unitClass: 'combat', side: 'soviet', phase: 'movement' }
  assert.equal(canSwitchMode(base).ok, true) // 缺省无专规闸门
  const gated = canSwitchMode({ ...base, operationalLimit: (r) => r.side === 'soviet' ? { ok: false, rule: 'TTW', reason: '限制' } : null })
  assert.equal(gated.ok, false)
  assert.equal(gated.rule, 'TTW')
})

test('reserve release and phase movability (5.7b/6.0/6.3a/7.0a/11.0a)', () => {
  const rel = canReleaseReserve({ state: reserve, side: 'soviet', activeSide: 'axis', phase: 'reaction' })
  assert.equal(rel.ok, true)
  assert.equal(rel.state.released, true)
  assert.equal(rel.maMult, 0.5) // 5.7b-B
  assert.equal(canReleaseReserve({ state: reserve, side: 'axis', activeSide: 'axis', phase: 'reaction' }).ok, false)
  assert.equal(canReleaseReserve({ state: reserve, side: 'soviet', activeSide: 'soviet', phase: 'movement' }).ok, false)
  const exploitRel = canReleaseReserve({ state: reserve, side: 'axis', activeSide: 'axis', phase: 'exploitation' })
  assert.equal(exploitRel.maMult, 1) // 5.7b-A
  assert.equal(canMoveInPhase({ state: combat, side: 'axis', activeSide: 'axis' }, 'movement').ok, true)
  assert.equal(canMoveInPhase({ state: combat, side: 'soviet', activeSide: 'axis' }, 'movement').ok, false)
  assert.equal(canMoveInPhase({ state: reserve, side: 'soviet', activeSide: 'axis' }, 'reaction').ok, false) // 未释放
  assert.equal(canMoveInPhase({ state: rel.state, side: 'soviet', activeSide: 'axis' }, 'reaction').ok, true)
  assert.equal(canMoveInPhase({ state: exploit, side: 'axis', activeSide: 'axis' }, 'exploitation').ok, true)
  assert.equal(canMoveInPhase({ state: combat, side: 'axis', activeSide: 'axis' }, 'exploitation').ok, false)
  assert.deepEqual(clearReleased(rel.state).released, false)
})

test('released reserve reverts to its facing (5.7b) and derivations follow the matrix', () => {
  const released = { face: 'combat', marker: 'reserve', released: true }
  assert.equal(effectiveMode(released), 'combat')
  assert.equal(groundModeEffect(released).canAttack, true)
  assert.equal(groundModeEffect(reserve).canAttack, false)
  assert.equal(exertsZoc(combat), true)
  assert.equal(exertsZoc(exploit), true) // 5.9c
  assert.equal(exertsZoc(dg), false)
  assert.equal(exertsZoc(reserve), false)
  assert.equal(canUseTransport(move), true)
  assert.equal(canUseTransport(combat), false)
  assert.equal(canUseTransport(dg), false)
  assert.equal(canEngineer(combat), true)
  assert.equal(canEngineer(dg), true) // 5.10e 朝向战斗面
  assert.equal(canEngineer({ face: 'move', marker: 'dg' }), false)
  assert.equal(canStackWithHedgehog(reserve), false) // 5.7g
  assert.equal(canStackWithHedgehog(combat), true)
  assert.equal(mustEndMoveInSupply(strat), true) // 5.8b
})

test('orientation flip, mode stats and invariants', () => {
  assert.equal(canFlipOrientation({ state: dg, phase: 'movement' }).ok, true)
  assert.equal(canFlipOrientation({ state: reserve, phase: 'movement', enteredReserveThisTurn: true }).ok, false)
  assert.equal(canFlipOrientation({ state: strat, phase: 'movement' }).ok, false)
  assert.equal(flipOrientation(dg).face, 'move')
  const stratStats = resolveModeStats({ attack: 6, ar: 3, ma: 4, barrage: 2 }, strat, 'movement')
  assert.equal(stratStats.attack, 0)
  assert.equal(stratStats.ar, 0)
  assert.equal(stratStats.ma, 8)
  assert.equal(stratStats.barrage, undefined)
  const dgStats = resolveModeStats({ attack: 6, ar: 3, ma: 4 }, dg, 'movement')
  assert.equal(dgStats.attack, 3)
  assert.equal(dgStats.ar, 2)
  assert.equal(dgStats.ma, 2)
  assert.equal(dgStats.canOverrun, false)
  assert.deepEqual(validateModeState({ face: 'combat', marker: 'strat' }), ['stratMustFaceMove'])
  assert.deepEqual(validateModeState(dg, 'transportPoint'), ['transportPointInDg'])
  assert.equal(markersAfterDg({ unitClass: 'transportPoint', state: reserve }), 'loseReserveMarkerOnly')
  assert.equal(markersAfterDg({ unitClass: 'combat', state: reserve }), 'dgOnly')
  assert.equal(modeUnitClass({ noncombatKind: 'organic_truck' }), 'organicTruck')
  assert.equal(isMobileUnit({ noncombatKind: 'sp', ma: 0 }), false)
})