import assert from 'node:assert/strict'
import test from 'node:test'
import { campaignHqClass, axisLossHqKind, axisHqRail, axisHqRailOnly, axisHqDestroyedOnRetreat, isTankArmyHq, hqRailOnly, hqRailFacts } from '../src/ttw/hq-classify.ts'

test('hq_kind maps to the campaign HQ class for every value printed in units_hq.json', () => {
  assert.equal(campaignHqClass('army'), 'army')
  assert.equal(campaignHqClass('pz_army'), 'army')
  assert.equal(campaignHqClass('ags'), 'army-group')
  for (const k of ['corps', 'pz_corps', 'ss_pz_corps']) assert.equal(campaignHqClass(k), 'corps')
  assert.equal(campaignHqClass('kessel'), 'kessel')
  assert.equal(campaignHqClass('front'), 'front')
  for (const k of ['tank_army', 'guard_tank_army']) assert.equal(campaignHqClass(k), 'tank-army')
  for (const k of ['guard_army', 'shock_army']) assert.equal(campaignHqClass(k), 'soviet-army')
  // air HQ split kinds classify by catalog kind
  assert.equal(campaignHqClass(undefined, 'luftflotte-hq'), 'luftflotte')
  assert.equal(campaignHqClass(undefined, 'air-army-hq'), 'air-army')
  // unlisted classes are not invented
  assert.equal(campaignHqClass(undefined), undefined)
  assert.equal(campaignHqClass('something_new'), undefined)
})

test('Axis HQ hooks derive from the class; Soviet HQs give no Axis VP/rebuild', () => {
  assert.equal(axisLossHqKind(campaignHqClass('army')), 'army')
  assert.equal(axisLossHqKind(campaignHqClass('ags')), 'army-group')
  assert.equal(axisLossHqKind(campaignHqClass('pz_corps')), 'corps')
  assert.equal(axisLossHqKind(campaignHqClass('kessel')), undefined)
  assert.equal(axisLossHqKind(campaignHqClass('tank_army')), undefined)
  assert.equal(axisLossHqKind(campaignHqClass('front')), undefined)
  // rail-only / 1 RE / detrainable waiver
  assert.deepEqual(axisHqRail(campaignHqClass('army')), { railRe: 1, waiveDetrainable: true })
  assert.deepEqual(axisHqRail(campaignHqClass('ags')), { railRe: 1, waiveDetrainable: false })
  assert.equal(axisHqRail(campaignHqClass('corps')), undefined)
  assert.equal(axisHqRailOnly(campaignHqClass('pz_army')), true)
  assert.equal(axisHqRailOnly(campaignHqClass('corps')), false)
  // forced-retreat destroy
  assert.equal(axisHqDestroyedOnRetreat(campaignHqClass('army')), true)
  assert.equal(axisHqDestroyedOnRetreat(campaignHqClass('ags')), true)
  assert.equal(axisHqDestroyedOnRetreat(campaignHqClass('corps')), false)
  // RVGK tank army HQ
  assert.equal(isTankArmyHq(campaignHqClass('guard_tank_army')), true)
  assert.equal(isTankArmyHq(campaignHqClass('guard_army')), false)
})

test('rail-only gate and rail facts are data-driven from the v2 rail_only flag', () => {
  // German/Romanian Army HQ, Pz Army, Army Group: rail_only in the database.
  const armyHq = { railOnly: true, railCapRe: 1 }
  const ags = { railOnly: true, railCapRe: 1, mustBeCity: true }
  assert.equal(hqRailOnly(armyHq), true)
  assert.deepEqual(hqRailFacts(armyHq), { railRe: 1, waiveDetrainable: true })   // §2.3b waives detrainable
  assert.deepEqual(hqRailFacts(ags), { railRe: 1, waiveDetrainable: false })     // §2.3c must be in a city
  // Corps HQ and Soviet Army HQ have a wheeled movement face, no rail_only flag.
  assert.equal(hqRailOnly({}), false)
  assert.equal(hqRailOnly(undefined), false)
  assert.equal(hqRailFacts({}), undefined)
  // rail_cap_RE defaults to 1 when the flag is set without an explicit RE.
  assert.deepEqual(hqRailFacts({ railOnly: true }), { railRe: 1, waiveDetrainable: true })
})