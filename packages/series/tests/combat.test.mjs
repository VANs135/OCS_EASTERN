import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  chooseOptionSplit, combatLossAllocation, combatResultObligations, defensiveCombatSupplyCost,
  exploitMarkerEligibility, planOptionSplits, retreatStepEffects,
} from '../src/combat.ts'

test('the AR leader takes the first loss and losses spread one per unit per round (OCS 9.11c)', () => {
  const remaining = new Map([['a', 2], ['b', 2], ['c', 1]])
  assert.deepEqual([...combatLossAllocation(remaining, 'a', ['a', 'b', 'c', 'a'], 4)], [['a', 2], ['b', 1], ['c', 1]])
  assert.deepEqual([...combatLossAllocation(remaining, 'b', ['b'], 1)], [['b', 1]])
  assert.deepEqual([...combatLossAllocation(remaining, 'a', [], 0)], [])
})

test('loss allocation rejects a wrong leader, length, capacity or round order (OCS 9.11c)', () => {
  const remaining = new Map([['a', 2], ['b', 2]])
  assert.throws(() => combatLossAllocation(remaining, 'a', ['b', 'a'], 2), /starting with the Action Rating unit/)
  assert.throws(() => combatLossAllocation(remaining, 'a', ['a'], 2), /starting with the Action Rating unit/)
  assert.throws(() => combatLossAllocation(remaining, 'a', ['a', 'a', 'b'], 3), /one loss before a surviving unit takes another/)
  assert.throws(() => combatLossAllocation(remaining, 'a', ['a', 'b', 'a', 'a'], 4), /one loss before a surviving unit takes another/)
  assert.throws(() => combatLossAllocation(remaining, 'a', ['a', 'x'], 2), /one loss before a surviving unit takes another/)
})

test('mandatory losses truncate to remaining steps and unmet options become retreat distance (OCS 9.10/9.11b/9.12)', () => {
  assert.deepEqual(combatResultObligations({ loss: 1, option: 2 }, 5, { optionLosses: 1 }),
    { mandatoryLosses: 1, availableOptions: 2, optionLosses: 1, totalLosses: 2, unmetOptions: 1, retreatDistance: 1 })
  assert.deepEqual(combatResultObligations({ loss: 1, option: 2 }, 5, { optionLosses: 2 }),
    { mandatoryLosses: 1, availableOptions: 2, optionLosses: 2, totalLosses: 3, unmetOptions: 0, retreatDistance: 0 })
  assert.deepEqual(combatResultObligations({ loss: 3, option: 2 }, 1, { optionLosses: 0 }),
    { mandatoryLosses: 1, availableOptions: 2, optionLosses: 0, totalLosses: 1, unmetOptions: 2, retreatDistance: 0 })
  const ignored = combatResultObligations({ loss: 1, option: 2 }, 5, { ignoreOption: true, optionLosses: 0 })
  assert.equal(ignored.availableOptions, 0)
  assert.equal(ignored.retreatDistance, 0)
})

test('option loss allocation rejects over-capacity, negative or fractional choices (OCS 9.10)', () => {
  assert.throws(() => combatResultObligations({ loss: 1, option: 2 }, 5, { optionLosses: 3 }), /Invalid combat option loss allocation/)
  assert.throws(() => combatResultObligations({ loss: 1, option: 2 }, 2, { optionLosses: 2 }), /Invalid combat option loss allocation/)
  assert.throws(() => combatResultObligations({ loss: 1, option: 2 }, 5, { optionLosses: -1 }), /Invalid combat option loss allocation/)
  assert.throws(() => combatResultObligations({ loss: 1, option: 2 }, 5, { optionLosses: 0.5 }), /Invalid combat option loss allocation/)
  assert.throws(() => combatResultObligations({ loss: 1, option: 2 }, 5, { ignoreOption: true, optionLosses: 1 }), /Invalid combat option loss allocation/)
})

const attackers = [
  { id: 'a', rating: 3, disorganized: false },
  { id: 'b', rating: 2, disorganized: false },
  { id: 'c', rating: 4, disorganized: true },
]
const exploitInput = (patch = {}) => ({
  threshold: 3, overrun: false, combatPhase: true, unmetOptions: 0,
  origins: ['A'], adjacent: () => true, attackers, ...patch,
})

test('exploit markers go to non-DG attackers meeting the e# threshold (OCS 9.13/9.13b-A)', () => {
  assert.deepEqual(exploitMarkerEligibility(exploitInput()), ['a'])
  assert.deepEqual(exploitMarkerEligibility(exploitInput({ threshold: 5 })), [])
})

test('exploit results are ignored for overruns, other phases, unmet options and distant stacks (OCS 9.10d/9.13b-B-C)', () => {
  assert.deepEqual(exploitMarkerEligibility(exploitInput({ threshold: null })), [])
  assert.deepEqual(exploitMarkerEligibility(exploitInput({ overrun: true })), [])
  assert.deepEqual(exploitMarkerEligibility(exploitInput({ combatPhase: false })), [])
  assert.deepEqual(exploitMarkerEligibility(exploitInput({ unmetOptions: 1 })), [])
  assert.deepEqual(exploitMarkerEligibility(exploitInput({ origins: ['A', 'B', 'C'] })), [])
  assert.deepEqual(exploitMarkerEligibility(exploitInput({ origins: ['A', 'B'], adjacent: () => false })), [])
  assert.deepEqual(exploitMarkerEligibility(exploitInput({ origins: ['A', 'B'], adjacent: (a, b) => a === 'A' && b === 'B' })), ['a'])
})

test('defending combat supply costs 1T up to 1 RE and 2T beyond, per stack (OCS 12.4)', () => {
  assert.equal(defensiveCombatSupplyCost(0), 1)
  assert.equal(defensiveCombatSupplyCost(1), 1)
  assert.equal(defensiveCombatSupplyCost(2), 2)
  assert.equal(defensiveCombatSupplyCost(7), 2)
})

const ladder = [
  { distance: 1, units: [], allSafe: true, allHaveLanding: true },
  { distance: 2, units: [], allSafe: true, allHaveLanding: true },
  { distance: 3, units: [], allSafe: false, allHaveLanding: true },
]

test('option splits prefer the longest safe retreat, then all losses, then doomed retreats (OCS 9.10a)', () => {
  assert.deepEqual(planOptionSplits({ options: 3, capacity: 5, ladder }),
    [{ retreatHexes: 2, lossPoints: 1 }, { retreatHexes: 1, lossPoints: 2 }, { retreatHexes: 0, lossPoints: 3 }, { retreatHexes: 3, lossPoints: 0 }])
  assert.deepEqual(planOptionSplits({ options: 0, capacity: 0, ladder }), [{ retreatHexes: 0, lossPoints: 0 }])
})

test('option splits respect the loss capacity and deduplicate distances (OCS 9.10a/9.11)', () => {
  assert.deepEqual(planOptionSplits({ options: 3, capacity: 1, ladder }),
    [{ retreatHexes: 2, lossPoints: 1 }, { retreatHexes: 3, lossPoints: 0 }])
  const duplicated = [...ladder, { distance: 2, units: [], allSafe: false, allHaveLanding: true }]
  assert.deepEqual(planOptionSplits({ options: 2, capacity: 0, ladder: duplicated }), [{ retreatHexes: 2, lossPoints: 0 }])
  assert.deepEqual(chooseOptionSplit({ options: 2, capacity: 0, ladder: [] }), { retreatHexes: 0, lossPoints: 2 })
})

test('entering an enemy ZOC disorganizes the hex and forces a loss on an already-DG unit (OCS 9.12e)', () => {
  const units = [
    { id: 'a', combat: true, disorganized: true },
    { id: 'b', combat: true, disorganized: false },
    { id: 't', combat: false, disorganized: false },
  ]
  assert.deepEqual(retreatStepEffects({ enteredRawEnemyZoc: true, secondRetreatHex: false, units }),
    { disorganizeHex: true, zocLossCandidates: ['a'] })
  assert.deepEqual(retreatStepEffects({ enteredRawEnemyZoc: true, secondRetreatHex: false, units: [units[1]] }),
    { disorganizeHex: true, zocLossCandidates: [] })
})

test('the second retreat hex disorganizes without ZOC; trucks alone trigger nothing (OCS 9.12a)', () => {
  const units = [{ id: 'a', combat: true, disorganized: false }]
  assert.deepEqual(retreatStepEffects({ enteredRawEnemyZoc: false, secondRetreatHex: true, units }),
    { disorganizeHex: true, zocLossCandidates: [] })
  assert.deepEqual(retreatStepEffects({ enteredRawEnemyZoc: false, secondRetreatHex: false, units }),
    { disorganizeHex: false, zocLossCandidates: [] })
  const trucks = [{ id: 't', combat: false, disorganized: true }]
  assert.deepEqual(retreatStepEffects({ enteredRawEnemyZoc: true, secondRetreatHex: true, units: trucks }),
    { disorganizeHex: false, zocLossCandidates: [] })
})